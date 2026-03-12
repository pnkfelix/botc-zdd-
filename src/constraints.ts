/**
 * Constraint application engine.
 *
 * Provides a general mechanism to apply observations to a ZDD,
 * narrowing the family of possible worlds. Each observation type
 * maps to specific ZDD operations (require, offset, intersection).
 */

import { ZDD, BOTTOM, type NodeId } from "./zdd.js";
import {
  type Observation,
  type Query,
  type QueryResult,
  seatRoleVar,
} from "./types.js";

// ---------------------------------------------------------------------------
// Applying observations
// ---------------------------------------------------------------------------

/**
 * Apply a single observation to a ZDD, returning the narrowed family.
 *
 * @param zdd  - The shared ZDD instance
 * @param root - Current ZDD root
 * @param obs  - The observation to apply
 * @param numPlayers - Number of players (needed for variable encoding)
 * @returns New root after constraining
 */
export function applyObservation(
  zdd: ZDD,
  root: NodeId,
  obs: Observation,
  numPlayers: number,
): NodeId {
  switch (obs.kind) {
    case "seat-has-role":
    case "role-in-seat": {
      // Require that seat S has role R: the variable must be in every surviving set.
      const v = seatRoleVar(obs.seat, obs.roleIndex, numPlayers);
      return requireVariable(zdd, root, v, numPlayers);
    }
    case "seat-not-role":
    case "role-not-in-seat": {
      // Exclude seat S having role R: remove all sets containing this variable.
      const v = seatRoleVar(obs.seat, obs.roleIndex, numPlayers);
      return zdd.offset(root, v);
    }
    case "require-variable":
      return requireVariable(zdd, root, obs.variable, numPlayers);
    case "exclude-variable":
      return zdd.offset(root, obs.variable);
  }
}

/**
 * Apply multiple observations sequentially.
 */
export function applyObservations(
  zdd: ZDD,
  root: NodeId,
  observations: Observation[],
  numPlayers: number,
): NodeId {
  let result = root;
  for (const obs of observations) {
    result = applyObservation(zdd, result, obs, numPlayers);
    if (result === BOTTOM) return BOTTOM; // No worlds remain
  }
  return result;
}

/**
 * Require a variable: keep only sets containing it.
 *
 * For a seat assignment ZDD, requiring variable V (seat S has role R)
 * also means excluding all other roles for seat S and all other seats
 * for role R — since it's a perfect matching.
 *
 * This function does the "smart" version: require V, then exclude
 * conflicting variables in the same seat and same role column.
 */
function requireVariable(
  zdd: ZDD,
  root: NodeId,
  variable: number,
  numPlayers: number,
): NodeId {
  // First, require the variable itself
  let result = zdd.require(root, variable);
  if (result === BOTTOM) return BOTTOM;

  const seat = Math.floor(variable / numPlayers);
  const roleIdx = variable % numPlayers;

  // Exclude other roles for this seat
  for (let r = 0; r < numPlayers; r++) {
    if (r === roleIdx) continue;
    const otherVar = seatRoleVar(seat, r, numPlayers);
    result = zdd.offset(result, otherVar);
    if (result === BOTTOM) return BOTTOM;
  }

  // Exclude this role in other seats
  for (let s = 0; s < numPlayers; s++) {
    if (s === seat) continue;
    const otherVar = seatRoleVar(s, roleIdx, numPlayers);
    result = zdd.offset(result, otherVar);
    if (result === BOTTOM) return BOTTOM;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Execute a query against a ZDD.
 *
 * @param zdd  - The shared ZDD instance
 * @param root - Current ZDD root
 * @param query - The query to execute
 * @param numPlayers - Number of players
 * @returns Query result
 */
export function executeQuery(
  zdd: ZDD,
  root: NodeId,
  query: Query,
  numPlayers: number,
): QueryResult {
  switch (query.kind) {
    case "count-worlds":
      return { kind: "count", value: zdd.count(root) };

    case "count-with-seat-role": {
      const v = seatRoleVar(query.seat, query.roleIndex, numPlayers);
      const constrained = zdd.require(root, v);
      return { kind: "count", value: zdd.count(constrained) };
    }

    case "seat-probabilities": {
      const total = zdd.count(root);
      const values = new Map<number, number>();
      for (let r = 0; r < numPlayers; r++) {
        const v = seatRoleVar(query.seat, r, numPlayers);
        const constrained = zdd.require(root, v);
        const count = zdd.count(constrained);
        if (count > 0) {
          values.set(r, count / total);
        }
      }
      return { kind: "probabilities", values };
    }
  }
}
