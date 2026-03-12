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
 * When the Poisoner is in play, poisoner target variables are added before
 * info role variables. The valid info outputs DEPEND on which seat is
 * poisoned: a poisoned info role gets unconstrained outputs (any valid
 * output for its type). Separate ZDD branches are built for each poisoner
 * target and unioned together.
 *
 * The `malfunctioningSeats` config option supports the Drunk and similar
 * permanently-malfunctioning roles. Seats in this set are always treated
 * as malfunctioning regardless of poisoner target.
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

/** Describes a poisoner target variable. */
export interface PoisonerTargetOutput {
  targetSeat: Seat;
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
  /** Variable ID ranges per info role (and "Poisoner" for target vars). */
  roleVariableRanges: Map<string, { start: number; count: number }>;
  /** For pair-based roles: variable ID → output. */
  pairOutputs: Map<number, PairInfoOutput>;
  /** For count-based roles: variable ID → count. */
  countOutputs: Map<number, CountInfoOutput>;
  /** For poisoner target variables: variable ID → target. */
  poisonerTargetOutputs: Map<number, PoisonerTargetOutput>;
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

/** Check whether a seat is malfunctioning in a given malfunctioning set. */
function isSeatMalfunctioning(seat: Seat, malfunctioningSeats: Set<Seat>): boolean {
  return malfunctioningSeats.has(seat);
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

/** Get all role names of a given type from the script. */
function getRolesOfType(script: Script, type: RoleType): string[] {
  return script.roles.filter((r) => r.type === type).map((r) => r.name);
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
 * When functioning: the Storyteller shows two players and names a role of the
 * target type. One of the shown players must actually have that role. Neither
 * shown player is the info role holder.
 *
 * When malfunctioning: the Storyteller can show any pair of other players and
 * name any role of the target type from the script (not just roles in play).
 */
function buildPairRoleInfo(
  zdd: ZDD,
  config: NightInfoConfig,
  infoRoleName: string,
  targetType: RoleType,
  nextVarId: number,
  malfunctioningSeats: Set<Seat>,
): RoleInfoResult {
  const { numPlayers, seatRoles, script } = config;

  const infoSeat = findSeatByRole(seatRoles, infoRoleName);
  if (infoSeat === undefined) return emptyResult();

  const malfunctioning = isSeatMalfunctioning(infoSeat, malfunctioningSeats);

  if (malfunctioning) {
    return buildMalfunctioningPairRoleInfo(
      zdd, config, infoRoleName, targetType, nextVarId, infoSeat,
    );
  }

  // --- Functioning path (original logic) ---

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

/**
 * Build malfunctioning pair info: any pair of other players + any role of
 * the target type from the script.
 *
 * For Librarian, also include the "No Outsiders" option.
 */
function buildMalfunctioningPairRoleInfo(
  zdd: ZDD,
  config: NightInfoConfig,
  infoRoleName: string,
  targetType: RoleType,
  nextVarId: number,
  infoSeat: Seat,
): RoleInfoResult {
  const { numPlayers, script } = config;

  const allTargetRoles = getRolesOfType(script, targetType);

  const variables: NightInfoVariable[] = [];
  const pairOutputs = new Map<number, PairInfoOutput>();
  const varIds: number[] = [];
  let vid = nextVarId;

  // Librarian special case: "No Outsiders" is always a valid lie
  if (infoRoleName === "Librarian") {
    variables.push({
      id: vid,
      infoRole: infoRoleName,
      description: "No Outsiders in play",
    });
    varIds.push(vid);
    vid++;
  }

  // All pairs of other players × all roles of the target type from the script
  for (let a = 0; a < numPlayers; a++) {
    if (a === infoSeat) continue;
    for (let b = a + 1; b < numPlayers; b++) {
      if (b === infoSeat) continue;
      for (const roleName of allTargetRoles) {
        variables.push({
          id: vid,
          infoRole: infoRoleName,
          description: `Players ${a},${b} — ${roleName}`,
        });
        pairOutputs.set(vid, { playerA: a, playerB: b, namedRole: roleName });
        varIds.push(vid);
        vid++;
      }
    }
  }

  if (varIds.length === 0) return emptyResult();

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
 * When functioning: the Chef learns the true count of adjacent evil pairs.
 * When malfunctioning: the Chef can be told any count 0..numPlayers.
 */
function buildChefInfo(
  zdd: ZDD,
  config: NightInfoConfig,
  nextVarId: number,
  malfunctioningSeats: Set<Seat>,
): RoleInfoResult {
  const { numPlayers, seatRoles, script } = config;

  const chefSeat = findSeatByRole(seatRoles, "Chef");
  if (chefSeat === undefined) return emptyResult();

  const malfunctioning = isSeatMalfunctioning(chefSeat, malfunctioningSeats);

  // Count adjacent evil pairs in the seating circle (needed even for
  // variable creation since we always create all count variables)
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
  const allVarIds: number[] = [];

  for (let c = 0; c <= maxCount; c++) {
    const vid = nextVarId + c;
    variables.push({
      id: vid,
      infoRole: "Chef",
      description: `Chef count: ${c}`,
    });
    countOutputs.set(vid, { count: c });
    allVarIds.push(vid);
  }

  // When malfunctioning, any count is valid; when functioning, only the true count
  const validVarIds = malfunctioning ? allVarIds : [nextVarId + pairCount];
  const root = exactlyOne(zdd, validVarIds);

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
 * When functioning: the Empath learns the true count of evil living neighbors.
 * When malfunctioning: the Empath can be told 0, 1, or 2.
 */
function buildEmpathInfo(
  zdd: ZDD,
  config: NightInfoConfig,
  nextVarId: number,
  malfunctioningSeats: Set<Seat>,
): RoleInfoResult {
  const { numPlayers, seatRoles, script } = config;

  const empathSeat = findSeatByRole(seatRoles, "Empath");
  if (empathSeat === undefined) return emptyResult();

  const malfunctioning = isSeatMalfunctioning(empathSeat, malfunctioningSeats);

  // On Night 1, all players are alive. Neighbors are adjacent seats.
  const left = (empathSeat - 1 + numPlayers) % numPlayers;
  const right = (empathSeat + 1) % numPlayers;

  let evilCount = 0;
  if (isEvil(left, seatRoles, script)) evilCount++;
  if (isEvil(right, seatRoles, script)) evilCount++;

  // Variables for counts 0, 1, 2
  const variables: NightInfoVariable[] = [];
  const countOutputs = new Map<number, CountInfoOutput>();
  const allVarIds: number[] = [];

  for (let c = 0; c <= 2; c++) {
    const vid = nextVarId + c;
    variables.push({
      id: vid,
      infoRole: "Empath",
      description: `Empath count: ${c}`,
    });
    countOutputs.set(vid, { count: c });
    allVarIds.push(vid);
  }

  const validVarIds = malfunctioning ? allVarIds : [nextVarId + evilCount];
  const root = exactlyOne(zdd, validVarIds);

  return {
    root,
    variables,
    pairOutputs: new Map(),
    countOutputs,
    varCount: 3,
  };
}

// ---------------------------------------------------------------------------
// Info role builder (dispatches to specific builders)
// ---------------------------------------------------------------------------

/**
 * Build all info role variables for a given set of malfunctioning seats.
 * Returns the combined ZDD and metadata, starting variable IDs at nextVarId.
 */
function buildAllInfoRoles(
  zdd: ZDD,
  config: NightInfoConfig,
  nextVarId: number,
  malfunctioningSeats: Set<Seat>,
): {
  root: NodeId;
  variables: NightInfoVariable[];
  pairOutputs: Map<number, PairInfoOutput>;
  countOutputs: Map<number, CountInfoOutput>;
  roleRanges: Map<string, { start: number; count: number }>;
  totalVarCount: number;
} {
  const allVariables: NightInfoVariable[] = [];
  const allPairOutputs = new Map<number, PairInfoOutput>();
  const allCountOutputs = new Map<number, CountInfoOutput>();
  const roleRanges = new Map<string, { start: number; count: number }>();

  let vid = nextVarId;
  let combinedRoot: NodeId = TOP;

  for (const roleSpec of NIGHT_1_INFO_ROLES) {
    if (findSeatByRole(config.seatRoles, roleSpec.name) === undefined) continue;

    let result: RoleInfoResult;

    if (roleSpec.kind === "pair") {
      result = buildPairRoleInfo(
        zdd, config, roleSpec.name, roleSpec.targetType, vid, malfunctioningSeats,
      );
    } else if (roleSpec.kind === "chef") {
      result = buildChefInfo(zdd, config, vid, malfunctioningSeats);
    } else {
      result = buildEmpathInfo(zdd, config, vid, malfunctioningSeats);
    }

    if (result.varCount > 0) {
      roleRanges.set(roleSpec.name, { start: vid, count: result.varCount });
      allVariables.push(...result.variables);
      for (const [k, v] of result.pairOutputs) allPairOutputs.set(k, v);
      for (const [k, v] of result.countOutputs) allCountOutputs.set(k, v);
      vid += result.varCount;
      combinedRoot = zdd.product(combinedRoot, result.root);
    }
  }

  return {
    root: combinedRoot,
    variables: allVariables,
    pairOutputs: allPairOutputs,
    countOutputs: allCountOutputs,
    roleRanges,
    totalVarCount: vid - nextVarId,
  };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build the Night 1 information ZDD for a concrete seat assignment.
 *
 * If the Poisoner is in play, adds poisoner target variables (one per
 * possible target seat) before info role variables. For each possible
 * poisoner target, builds the info role ZDD with that seat malfunctioning,
 * then unions all branches.
 *
 * If there is no Poisoner, this behaves like the original builder:
 * cross-product of independent info role choices.
 */
export function buildNightInfoZDD(
  zdd: ZDD,
  config: NightInfoConfig,
): NightInfoResult {
  const { numPlayers, seatRoles } = config;
  const baseMalfunctioning = config.malfunctioningSeats ?? new Set<Seat>();

  // Check if Poisoner is in play
  const poisonerSeat = findSeatByRole(seatRoles, "Poisoner");

  if (poisonerSeat === undefined) {
    // No Poisoner — build directly with base malfunctioning seats
    return buildWithoutPoisoner(zdd, config, baseMalfunctioning);
  }

  // --- Poisoner is in play ---
  return buildWithPoisoner(zdd, config, poisonerSeat, baseMalfunctioning);
}

/**
 * Build night info without a Poisoner (simple cross-product).
 */
function buildWithoutPoisoner(
  zdd: ZDD,
  config: NightInfoConfig,
  malfunctioningSeats: Set<Seat>,
): NightInfoResult {
  const infoResult = buildAllInfoRoles(zdd, config, 0, malfunctioningSeats);

  return {
    root: infoResult.root,
    variableCount: infoResult.totalVarCount,
    variables: infoResult.variables,
    roleVariableRanges: infoResult.roleRanges,
    pairOutputs: infoResult.pairOutputs,
    countOutputs: infoResult.countOutputs,
    poisonerTargetOutputs: new Map(),
  };
}

/**
 * Build night info with a Poisoner. Creates poisoner target variables,
 * then for each target builds a separate info-role ZDD branch and unions
 * them together.
 *
 * Variable layout: [poisoner targets] [info role outputs]
 * The info role variables use the SAME variable IDs across all branches.
 */
function buildWithPoisoner(
  zdd: ZDD,
  config: NightInfoConfig,
  poisonerSeat: Seat,
  baseMalfunctioning: Set<Seat>,
): NightInfoResult {
  const { numPlayers } = config;

  // --- Step 1: Allocate poisoner target variables ---
  const poisonerTargetOutputs = new Map<number, PoisonerTargetOutput>();
  const poisonerVariables: NightInfoVariable[] = [];
  const poisonerVarIds: number[] = [];

  let vid = 0;
  for (let target = 0; target < numPlayers; target++) {
    if (target === poisonerSeat) continue;
    poisonerVariables.push({
      id: vid,
      infoRole: "Poisoner",
      description: `Poisoner targets seat ${target}`,
    });
    poisonerTargetOutputs.set(vid, { targetSeat: target });
    poisonerVarIds.push(vid);
    vid++;
  }
  const poisonerVarCount = vid;
  const infoVarStart = poisonerVarCount;

  // --- Step 2: Build one info-role branch per poisoner target ---
  // We need all branches to use the SAME variable IDs for info roles.
  // First, do a "template" build to determine the variable layout.
  // Use base malfunctioning (no extra poisoning) to get the variable structure.
  // All branches will share the same variable IDs.

  // We need to ensure all branches produce the same variable set.
  // The key insight: malfunctioning only changes which ZDD nodes are valid,
  // not which variables exist. For pair roles, malfunctioning adds MORE
  // variables (all possible outputs vs. only truthful ones). We need the
  // union of all possible variables across all branches.
  //
  // Strategy: build with ALL seats malfunctioning to get the maximal variable
  // set, then for each branch, build the ZDD over those same variables but
  // constrained appropriately.

  // Build the maximal variable set (all info roles malfunctioning)
  const allSeats = new Set<Seat>();
  for (let s = 0; s < numPlayers; s++) allSeats.add(s);
  const maximalResult = buildAllInfoRoles(zdd, config, infoVarStart, allSeats);

  // Now for each poisoner target, build the constrained info ZDD
  let combinedRoot: NodeId = BOTTOM;

  for (let targetIdx = 0; targetIdx < poisonerVarIds.length; targetIdx++) {
    const targetVarId = poisonerVarIds[targetIdx];
    const targetSeat = poisonerTargetOutputs.get(targetVarId)!.targetSeat;

    // This branch's malfunctioning seats = base + the poisoner's target
    const branchMalfunctioning = new Set(baseMalfunctioning);
    branchMalfunctioning.add(targetSeat);

    // Build info roles for this branch using the SAME variable IDs
    const branchInfo = buildAllInfoRolesConstrained(
      zdd, config, infoVarStart, branchMalfunctioning, maximalResult,
    );

    // Combine: poisoner target singleton × info role ZDD
    const poisonerSingleton = zdd.singleSet([targetVarId]);
    const branchZDD = zdd.product(poisonerSingleton, branchInfo);

    combinedRoot = zdd.union(combinedRoot, branchZDD);
  }

  // --- Step 3: Assemble result ---
  const allVariables = [...poisonerVariables, ...maximalResult.variables];
  const roleRanges = new Map<string, { start: number; count: number }>();
  roleRanges.set("Poisoner", { start: 0, count: poisonerVarCount });
  for (const [role, range] of maximalResult.roleRanges) {
    roleRanges.set(role, range);
  }

  return {
    root: combinedRoot,
    variableCount: poisonerVarCount + maximalResult.totalVarCount,
    variables: allVariables,
    roleVariableRanges: roleRanges,
    pairOutputs: maximalResult.pairOutputs,
    countOutputs: maximalResult.countOutputs,
    poisonerTargetOutputs,
  };
}

/**
 * Build info role ZDD for a specific branch, using the same variable layout
 * as the maximal result. For each info role, either use the maximal
 * (unconstrained) output or the functioning (truth-constrained) output.
 */
function buildAllInfoRolesConstrained(
  zdd: ZDD,
  config: NightInfoConfig,
  infoVarStart: number,
  malfunctioningSeats: Set<Seat>,
  maximalResult: {
    roleRanges: Map<string, { start: number; count: number }>;
    pairOutputs: Map<number, PairInfoOutput>;
    countOutputs: Map<number, CountInfoOutput>;
    totalVarCount: number;
  },
): NodeId {
  let combinedRoot: NodeId = TOP;

  for (const roleSpec of NIGHT_1_INFO_ROLES) {
    const infoSeat = findSeatByRole(config.seatRoles, roleSpec.name);
    if (infoSeat === undefined) continue;

    const range = maximalResult.roleRanges.get(roleSpec.name);
    if (!range) continue;

    const malfunctioning = isSeatMalfunctioning(infoSeat, malfunctioningSeats);

    if (malfunctioning) {
      // Unconstrained: exactlyOne over ALL variables in this role's range
      const allVarIds: number[] = [];
      for (let v = range.start; v < range.start + range.count; v++) {
        allVarIds.push(v);
      }
      const roleRoot = exactlyOne(zdd, allVarIds);
      combinedRoot = zdd.product(combinedRoot, roleRoot);
    } else {
      // Functioning: build the truth-constrained ZDD
      const roleRoot = buildFunctioningRoleConstrained(
        zdd, config, roleSpec, range, maximalResult,
      );
      combinedRoot = zdd.product(combinedRoot, roleRoot);
    }
  }

  return combinedRoot;
}

/**
 * Build a functioning (truth-constrained) ZDD for a role, using variables
 * from the maximal layout. Returns exactlyOne over only the truthful
 * variable IDs within the given range.
 */
function buildFunctioningRoleConstrained(
  zdd: ZDD,
  config: NightInfoConfig,
  roleSpec: typeof NIGHT_1_INFO_ROLES[number],
  range: { start: number; count: number },
  maximalResult: {
    pairOutputs: Map<number, PairInfoOutput>;
    countOutputs: Map<number, CountInfoOutput>;
  },
): NodeId {
  const { numPlayers, seatRoles, script } = config;
  const truthfulVarIds: number[] = [];

  if (roleSpec.kind === "pair") {
    const infoSeat = findSeatByRole(seatRoles, roleSpec.name)!;

    // Find truthful targets
    const targets: Array<{ seat: Seat; roleName: string }> = [];
    for (const [seat, role] of seatRoles) {
      if (seat === infoSeat) continue;
      if (getRoleType(role, script) === roleSpec.targetType) {
        targets.push({ seat, roleName: role });
      }
    }

    if (targets.length === 0 && roleSpec.name === "Librarian") {
      // "No Outsiders" is the truthful output
      // Find the "No Outsiders" variable in the maximal range
      for (let v = range.start; v < range.start + range.count; v++) {
        if (!maximalResult.pairOutputs.has(v)) {
          // This is the "No Outsiders" variable
          truthfulVarIds.push(v);
          break;
        }
      }
    } else if (targets.length === 0) {
      // No targets and not Librarian — shouldn't happen if role is in play
      // but return BOTTOM to be safe
      return BOTTOM;
    } else {
      // Match truthful outputs against maximal variables
      for (let v = range.start; v < range.start + range.count; v++) {
        const output = maximalResult.pairOutputs.get(v);
        if (!output) continue;

        // Check if this output is truthful: one of the shown players
        // must actually have the named role
        let isTruthful = false;
        for (const { seat: targetSeat, roleName } of targets) {
          if (output.namedRole === roleName &&
            (output.playerA === targetSeat || output.playerB === targetSeat)) {
            isTruthful = true;
            break;
          }
        }
        if (isTruthful) truthfulVarIds.push(v);
      }
    }
  } else if (roleSpec.kind === "chef") {
    // Compute true Chef count
    let pairCount = 0;
    for (let s = 0; s < numPlayers; s++) {
      const next = (s + 1) % numPlayers;
      if (isEvil(s, seatRoles, script) && isEvil(next, seatRoles, script)) {
        pairCount++;
      }
    }
    // Find the variable for the true count
    for (let v = range.start; v < range.start + range.count; v++) {
      const output = maximalResult.countOutputs.get(v);
      if (output && output.count === pairCount) {
        truthfulVarIds.push(v);
        break;
      }
    }
  } else {
    // Empath
    const empathSeat = findSeatByRole(seatRoles, "Empath")!;
    const left = (empathSeat - 1 + numPlayers) % numPlayers;
    const right = (empathSeat + 1) % numPlayers;
    let evilCount = 0;
    if (isEvil(left, seatRoles, script)) evilCount++;
    if (isEvil(right, seatRoles, script)) evilCount++;

    for (let v = range.start; v < range.start + range.count; v++) {
      const output = maximalResult.countOutputs.get(v);
      if (output && output.count === evilCount) {
        truthfulVarIds.push(v);
        break;
      }
    }
  }

  if (truthfulVarIds.length === 0) return BOTTOM;
  return exactlyOne(zdd, truthfulVarIds);
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

/**
 * Find the variable ID for a specific poisoner target.
 *
 * @param result - The NightInfoResult from buildNightInfoZDD
 * @param targetSeat - The seat the poisoner targets
 * @returns The variable ID, or undefined if no such target exists
 */
export function findPoisonerTargetVariable(
  result: NightInfoResult,
  targetSeat: Seat,
): number | undefined {
  for (const [varId, output] of result.poisonerTargetOutputs) {
    if (output.targetSeat === targetSeat) {
      return varId;
    }
  }
  return undefined;
}
