/**
 * Night 1 Information Role ZDD builder.
 *
 * Given a concrete seat assignment, builds a ZDD representing all valid
 * combinations of Night 1 information outputs. The Storyteller has choices
 * (which players to show the Washerwoman, etc.) and the ZDD encodes all
 * valid choices consistent with the game state.
 *
 * Five Night 1 info roles are modeled:
 * - Washerwoman: "Player A or Player B is the [Townsfolk]"
 * - Librarian: "Player A or Player B is the [Outsider]" (or "No Outsiders")
 * - Investigator: "Player A or Player B is the [Minion]"
 * - Chef: Number of adjacent evil pairs
 * - Empath: Number of evil living neighbors
 *
 * All info roles are assumed to be functioning (truthful) by default.
 * The `malfunctioningSeats` config option is provided for future use
 * (poisoner/drunk) but not yet implemented.
 */

import { ZDD, BOTTOM, TOP, type NodeId } from "./zdd.js";
import { type Seat, type Observation } from "./types.js";
import { RoleType, type Script } from "./botc.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface NightInfoConfig {
  /** Number of players in the game. */
  numPlayers: number;
  /** Concrete seat-to-role mapping from the resolved seat assignment. */
  seatRoles: Map<Seat, string>;
  /** The role names selected for this game, indexed 0..N-1. */
  selectedRoles: string[];
  /** The script being played (needed for role type lookups). */
  script: Script;
  /**
   * Seats whose info roles are malfunctioning (poisoned/drunk).
   * Malfunctioning roles can receive arbitrary info (not constrained to truth).
   * Default: empty set (all roles function correctly).
   */
  malfunctioningSeats?: Set<Seat>;
}

// ---------------------------------------------------------------------------
// Variable descriptors
// ---------------------------------------------------------------------------

/** Describes what a night info variable represents. */
export interface NightInfoVariable {
  /** Variable ID within the night info phase (0-based). */
  id: number;
  /** The info role this variable belongs to. */
  infoRole: string;
  /** Detailed description of the info output. */
  description: string;
}

/** Describes a "pair + role" info output (Washerwoman, Librarian, Investigator). */
export interface PairInfoOutput {
  playerA: Seat;
  playerB: Seat;
  namedRole: string;
}

/** Describes a count-based info output (Chef, Empath). */
export interface CountInfoOutput {
  count: number;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface NightInfoResult {
  /** Root of the night info ZDD. */
  root: NodeId;
  /** Total number of variables in this phase. */
  variableCount: number;
  /** Descriptors for each variable. */
  variables: NightInfoVariable[];
  /** Variable ID ranges per info role. */
  roleVariableRanges: Map<string, { start: number; count: number }>;
  /** For pair-based roles: variable ID → output. */
  pairOutputs: Map<number, PairInfoOutput>;
  /** For count-based roles: variable ID → count. */
  countOutputs: Map<number, CountInfoOutput>;
}

// ---------------------------------------------------------------------------
// Night 1 info role processing order
// ---------------------------------------------------------------------------

const NIGHT_1_INFO_ROLES: Array<{
  name: string;
  kind: "pair";
  targetType: RoleType;
} | {
  name: string;
  kind: "chef" | "empath";
}> = [
  { name: "Washerwoman", kind: "pair", targetType: RoleType.Townsfolk },
  { name: "Librarian", kind: "pair", targetType: RoleType.Outsider },
  { name: "Investigator", kind: "pair", targetType: RoleType.Minion },
  { name: "Chef", kind: "chef" },
  { name: "Empath", kind: "empath" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a ZDD family of exactly-one-of-N singletons: { {v1}, {v2}, …, {vN} }.
 * Variables must be provided in any order; they are sorted internally.
 */
function exactlyOne(zdd: ZDD, vars: number[]): NodeId {
  if (vars.length === 0) return BOTTOM;
  const sorted = [...vars].sort((a, b) => a - b);
  let result: NodeId = BOTTOM;
  for (let i = sorted.length - 1; i >= 0; i--) {
    result = zdd.getNode(sorted[i], result, TOP);
  }
  return result;
}

/** Check whether a seat's info role is functioning (not poisoned/drunk). */
function isFunctioning(seat: Seat, config: NightInfoConfig): boolean {
  return !(config.malfunctioningSeats?.has(seat) ?? false);
}

function findSeatByRole(
  seatRoles: Map<Seat, string>,
  roleName: string,
): Seat | undefined {
  for (const [seat, role] of seatRoles) {
    if (role === roleName) return seat;
  }
  return undefined;
}

function getRoleType(
  roleName: string,
  script: Script,
): RoleType | undefined {
  return script.roles.find((r) => r.name === roleName)?.type;
}

function isEvil(
  seat: Seat,
  seatRoles: Map<Seat, string>,
  script: Script,
): boolean {
  const role = seatRoles.get(seat);
  if (!role) return false;
  const rType = getRoleType(role, script);
  return rType === RoleType.Minion || rType === RoleType.Demon;
}

// ---------------------------------------------------------------------------
// Internal result type for per-role builders
// ---------------------------------------------------------------------------

interface RoleInfoResult {
  root: NodeId;
  variables: NightInfoVariable[];
  pairOutputs: Map<number, PairInfoOutput>;
  countOutputs: Map<number, CountInfoOutput>;
  varCount: number;
}

function emptyResult(): RoleInfoResult {
  return {
    root: TOP,
    variables: [],
    pairOutputs: new Map(),
    countOutputs: new Map(),
    varCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Pair-based info roles (Washerwoman, Librarian, Investigator)
// ---------------------------------------------------------------------------

/**
 * Build info variables for a pair-based role (Washerwoman, Librarian, Investigator).
 *
 * The Storyteller shows two players and names a role of the target type.
 * One of the shown players must actually have that role. Neither shown
 * player is the info role holder.
 */
function buildPairRoleInfo(
  zdd: ZDD,
  config: NightInfoConfig,
  infoRoleName: string,
  targetType: RoleType,
  nextVarId: number,
): RoleInfoResult {
  const { numPlayers, seatRoles, script } = config;

  const infoSeat = findSeatByRole(seatRoles, infoRoleName);
  if (infoSeat === undefined) return emptyResult();
  if (!isFunctioning(infoSeat, config)) return emptyResult();

  // Find all roles of the target type in play, excluding the info role's own seat
  const targets: Array<{ seat: Seat; roleName: string }> = [];
  for (const [seat, role] of seatRoles) {
    if (seat === infoSeat) continue;
    if (getRoleType(role, script) === targetType) {
      targets.push({ seat, roleName: role });
    }
  }

  // Librarian special case: no outsiders in play
  if (targets.length === 0 && infoRoleName === "Librarian") {
    const vid = nextVarId;
    const variables: NightInfoVariable[] = [
      {
        id: vid,
        infoRole: infoRoleName,
        description: "No Outsiders in play",
      },
    ];
    const root = exactlyOne(zdd, [vid]);
    return {
      root,
      variables,
      pairOutputs: new Map(),
      countOutputs: new Map(),
      varCount: 1,
    };
  }

  if (targets.length === 0) return emptyResult();

  const variables: NightInfoVariable[] = [];
  const pairOutputs = new Map<number, PairInfoOutput>();
  const varIds: number[] = [];
  let vid = nextVarId;

  // Sort targets by seat for deterministic variable ordering
  const sortedTargets = [...targets].sort((a, b) => a.seat - b.seat);

  for (const { seat: targetSeat, roleName } of sortedTargets) {
    // Pair the true target with each possible decoy
    for (let decoy = 0; decoy < numPlayers; decoy++) {
      if (decoy === targetSeat || decoy === infoSeat) continue;

      const playerA = Math.min(targetSeat, decoy);
      const playerB = Math.max(targetSeat, decoy);

      variables.push({
        id: vid,
        infoRole: infoRoleName,
        description: `Players ${playerA},${playerB} — ${roleName}`,
      });
      pairOutputs.set(vid, { playerA, playerB, namedRole: roleName });
      varIds.push(vid);
      vid++;
    }
  }

  const root = exactlyOne(zdd, varIds);
  return {
    root,
    variables,
    pairOutputs,
    countOutputs: new Map(),
    varCount: vid - nextVarId,
  };
}

// ---------------------------------------------------------------------------
// Chef
// ---------------------------------------------------------------------------

/**
 * Build info variables for the Chef.
 *
 * The Chef learns how many pairs of evil players sit adjacent to each other
 * in the seating circle. Given a concrete assignment, this is fully determined.
 * Variables are created for all possible count values (0..numPlayers) so that
 * observations can be checked for consistency.
 */
function buildChefInfo(
  zdd: ZDD,
  config: NightInfoConfig,
  nextVarId: number,
): RoleInfoResult {
  const { numPlayers, seatRoles, script } = config;

  const chefSeat = findSeatByRole(seatRoles, "Chef");
  if (chefSeat === undefined) return emptyResult();
  if (!isFunctioning(chefSeat, config)) return emptyResult();

  // Count adjacent evil pairs in the seating circle
  let pairCount = 0;
  for (let s = 0; s < numPlayers; s++) {
    const next = (s + 1) % numPlayers;
    if (isEvil(s, seatRoles, script) && isEvil(next, seatRoles, script)) {
      pairCount++;
    }
  }

  // Create variables for all possible counts (0..numPlayers)
  const maxCount = numPlayers;
  const variables: NightInfoVariable[] = [];
  const countOutputs = new Map<number, CountInfoOutput>();

  for (let c = 0; c <= maxCount; c++) {
    const vid = nextVarId + c;
    variables.push({
      id: vid,
      infoRole: "Chef",
      description: `Chef count: ${c}`,
    });
    countOutputs.set(vid, { count: c });
  }

  // Only the true count is valid
  const root = exactlyOne(zdd, [nextVarId + pairCount]);
  return {
    root,
    variables,
    pairOutputs: new Map(),
    countOutputs,
    varCount: maxCount + 1,
  };
}

// ---------------------------------------------------------------------------
// Empath
// ---------------------------------------------------------------------------

/**
 * Build info variables for the Empath.
 *
 * The Empath learns how many of their two nearest living neighbors are evil.
 * On Night 1 everyone is alive, so neighbors are the two adjacent seats.
 * Given a concrete assignment, this is fully determined.
 */
function buildEmpathInfo(
  zdd: ZDD,
  config: NightInfoConfig,
  nextVarId: number,
): RoleInfoResult {
  const { numPlayers, seatRoles, script } = config;

  const empathSeat = findSeatByRole(seatRoles, "Empath");
  if (empathSeat === undefined) return emptyResult();
  if (!isFunctioning(empathSeat, config)) return emptyResult();

  // On Night 1, all players are alive. Neighbors are adjacent seats.
  const left = (empathSeat - 1 + numPlayers) % numPlayers;
  const right = (empathSeat + 1) % numPlayers;

  let evilCount = 0;
  if (isEvil(left, seatRoles, script)) evilCount++;
  if (isEvil(right, seatRoles, script)) evilCount++;

  // Variables for counts 0, 1, 2
  const variables: NightInfoVariable[] = [];
  const countOutputs = new Map<number, CountInfoOutput>();

  for (let c = 0; c <= 2; c++) {
    const vid = nextVarId + c;
    variables.push({
      id: vid,
      infoRole: "Empath",
      description: `Empath count: ${c}`,
    });
    countOutputs.set(vid, { count: c });
  }

  const root = exactlyOne(zdd, [nextVarId + evilCount]);
  return {
    root,
    variables,
    pairOutputs: new Map(),
    countOutputs,
    varCount: 3,
  };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build the Night 1 information ZDD for a concrete seat assignment.
 *
 * Returns a ZDD whose worlds represent all valid combinations of
 * Storyteller info-role output choices. The world count equals the product
 * of valid choices per info role in play.
 */
export function buildNightInfoZDD(
  zdd: ZDD,
  config: NightInfoConfig,
): NightInfoResult {
  const allVariables: NightInfoVariable[] = [];
  const allPairOutputs = new Map<number, PairInfoOutput>();
  const allCountOutputs = new Map<number, CountInfoOutput>();
  const roleRanges = new Map<string, { start: number; count: number }>();

  let nextVarId = 0;
  let combinedRoot: NodeId = TOP; // Identity for cross-product

  for (const roleSpec of NIGHT_1_INFO_ROLES) {
    // Skip roles not in play
    if (findSeatByRole(config.seatRoles, roleSpec.name) === undefined) continue;

    let result: RoleInfoResult;

    if (roleSpec.kind === "pair") {
      result = buildPairRoleInfo(
        zdd, config, roleSpec.name, roleSpec.targetType, nextVarId,
      );
    } else if (roleSpec.kind === "chef") {
      result = buildChefInfo(zdd, config, nextVarId);
    } else {
      result = buildEmpathInfo(zdd, config, nextVarId);
    }

    if (result.varCount > 0) {
      roleRanges.set(roleSpec.name, {
        start: nextVarId,
        count: result.varCount,
      });

      allVariables.push(...result.variables);
      for (const [k, v] of result.pairOutputs) allPairOutputs.set(k, v);
      for (const [k, v] of result.countOutputs) allCountOutputs.set(k, v);

      nextVarId += result.varCount;

      // Cross-product: each role's choices are independent
      combinedRoot = zdd.product(combinedRoot, result.root);
    }
  }

  return {
    root: combinedRoot,
    variableCount: nextVarId,
    variables: allVariables,
    roleVariableRanges: roleRanges,
    pairOutputs: allPairOutputs,
    countOutputs: allCountOutputs,
  };
}

// ---------------------------------------------------------------------------
// Observation handler for NightInfo phase
// ---------------------------------------------------------------------------

/**
 * Apply an observation to a night info ZDD.
 *
 * Only `require-variable` and `exclude-variable` observations are supported.
 * Seat-specific observations (seat-has-role, etc.) are not meaningful in the
 * night info context.
 */
export function applyNightInfoObservation(
  zdd: ZDD,
  root: NodeId,
  obs: Observation,
): NodeId {
  switch (obs.kind) {
    case "require-variable":
      return zdd.require(root, obs.variable);
    case "exclude-variable":
      return zdd.offset(root, obs.variable);
    default:
      throw new Error(
        `Observation kind "${obs.kind}" not supported for NightInfo phase`,
      );
  }
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Find the variable ID for a specific pair-based info output.
 *
 * @param result - The NightInfoResult from buildNightInfoZDD
 * @param infoRole - The info role name (e.g., "Washerwoman")
 * @param playerA - First shown player (order doesn't matter)
 * @param playerB - Second shown player (order doesn't matter)
 * @param namedRole - The role that was named
 * @returns The variable ID, or undefined if no such output exists
 */
export function findPairInfoVariable(
  result: NightInfoResult,
  infoRole: string,
  playerA: Seat,
  playerB: Seat,
  namedRole: string,
): number | undefined {
  const range = result.roleVariableRanges.get(infoRole);
  if (!range) return undefined;

  const a = Math.min(playerA, playerB);
  const b = Math.max(playerA, playerB);

  for (const [varId, output] of result.pairOutputs) {
    if (
      varId >= range.start &&
      varId < range.start + range.count &&
      output.playerA === a &&
      output.playerB === b &&
      output.namedRole === namedRole
    ) {
      return varId;
    }
  }
  return undefined;
}

/**
 * Find the variable ID for a specific count-based info output.
 *
 * @param result - The NightInfoResult from buildNightInfoZDD
 * @param infoRole - The info role name (e.g., "Chef" or "Empath")
 * @param count - The count value
 * @returns The variable ID, or undefined if no such output exists
 */
export function findCountInfoVariable(
  result: NightInfoResult,
  infoRole: string,
  count: number,
): number | undefined {
  const range = result.roleVariableRanges.get(infoRole);
  if (!range) return undefined;

  for (const [varId, output] of result.countOutputs) {
    if (
      varId >= range.start &&
      varId < range.start + range.count &&
      output.count === count
    ) {
      return varId;
    }
  }
  return undefined;
}
