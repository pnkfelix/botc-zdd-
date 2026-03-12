/**
 * Phase 2: Seat Assignment ZDD builder.
 *
 * Given a set of N roles selected from Phase 1 (role distribution),
 * builds a ZDD representing all valid assignments of those roles to
 * N seats (players). This is a perfect matching / permutation problem.
 *
 * Variable encoding:
 *   For N players, variable for (seat s, role index r) = s * N + r.
 *   Variables are grouped by seat so seat 0's options (vars 0..N-1)
 *   come before seat 1's (vars N..2N-1), etc.
 *   This ordering keeps per-seat "exactly one" constraints local.
 *
 * Each valid assignment (permutation) has exactly N variables set to
 * true — one per seat, one per role. For N players there are N!
 * permutations. The ZDD compresses these via structural sharing.
 */

import { ZDD, BOTTOM, TOP, type NodeId } from "./zdd.js";
import { seatRoleVar } from "./types.js";

/**
 * Build a ZDD of all valid seat-role assignments (perfect matchings)
 * for `numPlayers` seats and `numPlayers` distinct roles.
 *
 * @param zdd       - The shared ZDD instance
 * @param numPlayers - Number of players (= number of roles to assign)
 * @returns Root node of the seat assignment ZDD
 *
 * The returned ZDD family contains one set per valid permutation.
 * Each set has exactly `numPlayers` elements, where element
 * `seatRoleVar(s, r, numPlayers)` means "seat s has role r".
 */
export function buildSeatAssignmentZDD(
  zdd: ZDD,
  numPlayers: number,
): NodeId {
  if (numPlayers === 0) return TOP;
  if (numPlayers === 1) {
    // One seat, one role: variable 0
    return zdd.getNode(seatRoleVar(0, 0, 1), BOTTOM, TOP);
  }

  // We build the permutation ZDD recursively: for each seat (processed
  // in order 0, 1, ..., N-1), pick one role from the available set.
  //
  // Memoize on (seat, availableMask) where availableMask is a bitmask
  // of which role indices are still unassigned.
  const memo = new Map<string, NodeId>();

  function go(seat: number, availableMask: number): NodeId {
    if (seat === numPlayers) return TOP;

    const key = `${seat},${availableMask}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    // Try assigning each available role to this seat.
    // We process roles in descending order so we can build the union
    // incrementally — the last role tried becomes the "base" lo branch.
    let result: NodeId = BOTTOM;

    for (let r = 0; r < numPlayers; r++) {
      if (!(availableMask & (1 << r))) continue;

      const variable = seatRoleVar(seat, r, numPlayers);
      const sub = go(seat + 1, availableMask & ~(1 << r));

      if (sub === BOTTOM) continue;

      // This assignment: variable is true, rest of this seat's vars are false.
      // The ZDD node says: hi -> sub (if we pick this role), lo -> BOTTOM.
      // We union this choice with previous choices for this seat.
      const choice = zdd.getNode(variable, BOTTOM, sub);
      result = zdd.union(result, choice);
    }

    memo.set(key, result);
    return result;
  }

  const allRoles = (1 << numPlayers) - 1;
  return go(0, allRoles);
}

/**
 * Resolve a seat assignment (set of variable IDs) to a human-readable
 * mapping of seat -> role name.
 *
 * @param variables  - The set of true variables from one enumerated assignment
 * @param numPlayers - Number of players
 * @param roleNames  - The names of the selected roles (indexed 0..N-1)
 * @returns Map from seat index to role name
 */
export function resolveSeatAssignment(
  variables: number[],
  numPlayers: number,
  roleNames: string[],
): Map<number, string> {
  const result = new Map<number, string>();
  for (const v of variables) {
    const seat = Math.floor(v / numPlayers);
    const roleIdx = v % numPlayers;
    result.set(seat, roleNames[roleIdx]);
  }
  return result;
}
