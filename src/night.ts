/**
 * Night 1 Information Role ZDD builder.
 *
 * Given a concrete seat assignment, builds a ZDD representing all valid
 * combinations of Night 1 information outputs. The Storyteller has choices
 * (which players to show the Washerwoman, etc.) and the ZDD encodes all
 * valid choices consistent with the game state.
 *
 * Six Night 1 info roles are modeled:
 * - Washerwoman: "Player A or Player B is the [Townsfolk]"
 * - Librarian: "Player A or Player B is the [Outsider]" (or "No Outsiders")
 * - Investigator: "Player A or Player B is the [Minion]"
 * - Chef: Number of adjacent evil pairs
 * - Empath: Number of evil living neighbors
 * - Fortune Teller: "Yes" or "No" — is one of two chosen players the Demon?
 *
 * Spy/Recluse registration: roles with `registersAs` metadata can register
 * as different role types and/or alignments to info roles. The Spy can
 * register as Townsfolk/Outsider/Minion and Good/Evil. The Recluse can
 * register as Outsider/Minion/Demon and Good/Evil.
 *
 * When the Poisoner is in play, poisoner target variables are added before
 * info role variables. The valid info outputs DEPEND on which seat is
 * poisoned.
 *
 * When the Fortune Teller is in play, red herring designation variables are
 * added. The FT's outputs depend on which player is the red herring, creating
 * additional branching layered on top of Poisoner branching.
 *
 * The `malfunctioningSeats` config option supports the Drunk and similar
 * permanently-malfunctioning roles.
 */

import { ZDD, BOTTOM, TOP, type NodeId } from "./zdd.js";
import { type Seat, type Observation } from "./types.js";
import { RoleType, type Script, type Role } from "./botc.js";

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

/** Describes a red herring designation variable. */
export interface RedHerringOutput {
  targetSeat: Seat;
}

/** Describes a Fortune Teller output variable. */
export interface FortuneTellerOutput {
  playerA: Seat;
  playerB: Seat;
  answer: "Yes" | "No";
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
  /** Variable ID ranges per info role (and "Poisoner"/"RedHerring" for special vars). */
  roleVariableRanges: Map<string, { start: number; count: number }>;
  /** For pair-based roles: variable ID → output. */
  pairOutputs: Map<number, PairInfoOutput>;
  /** For count-based roles: variable ID → count. */
  countOutputs: Map<number, CountInfoOutput>;
  /** For poisoner target variables: variable ID → target. */
  poisonerTargetOutputs: Map<number, PoisonerTargetOutput>;
  /** For red herring designation variables: variable ID → target. */
  redHerringOutputs: Map<number, RedHerringOutput>;
  /** For Fortune Teller output variables: variable ID → output. */
  fortuneTellerOutputs: Map<number, FortuneTellerOutput>;
}

// ---------------------------------------------------------------------------
// Night 1 info role processing order (non-FT roles)
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

function getRoleObj(
  roleName: string,
  script: Script,
): Role | undefined {
  return script.roles.find((r) => r.name === roleName);
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
// Registration helpers
// ---------------------------------------------------------------------------

/**
 * Find valid reference targets for a pair-based info role, accounting for
 * Spy/Recluse registration. Returns each valid seat with the set of role
 * names the ST can show for that seat.
 */
function findPairTargets(
  config: NightInfoConfig,
  infoSeat: Seat,
  targetType: RoleType,
): Array<{ seat: Seat; roleNames: string[] }> {
  const { seatRoles, script } = config;
  const allRolesOfType = getRolesOfType(script, targetType);
  const result: Array<{ seat: Seat; roleNames: string[] }> = [];

  for (const [seat, role] of seatRoles) {
    if (seat === infoSeat) continue;
    const roleObj = getRoleObj(role, script);
    if (!roleObj) continue;

    const roleNames = new Set<string>();

    // Actual role type match → can show actual role name
    if (roleObj.type === targetType) {
      roleNames.add(role);
    }

    // Registration capability → can show ANY role of the target type
    if (roleObj.registersAs?.roleTypes.includes(targetType)) {
      for (const r of allRolesOfType) {
        roleNames.add(r);
      }
    }

    if (roleNames.size > 0) {
      result.push({ seat, roleNames: [...roleNames].sort() });
    }
  }

  return result.sort((a, b) => a.seat - b.seat);
}

/**
 * Get alignment registration options for a seat.
 * Returns whether the seat can register as evil and/or good.
 */
function getAlignmentOptions(
  seat: Seat,
  seatRoles: Map<Seat, string>,
  script: Script,
): { canBeEvil: boolean; canBeGood: boolean } {
  const role = seatRoles.get(seat);
  if (!role) return { canBeEvil: false, canBeGood: false };
  const roleObj = getRoleObj(role, script);
  if (!roleObj) return { canBeEvil: false, canBeGood: false };

  if (roleObj.registersAs) {
    return {
      canBeEvil: roleObj.registersAs.alignments.includes("Evil"),
      canBeGood: roleObj.registersAs.alignments.includes("Good"),
    };
  }

  const isNaturallyEvil = roleObj.type === RoleType.Minion || roleObj.type === RoleType.Demon;
  return {
    canBeEvil: isNaturallyEvil,
    canBeGood: !isNaturallyEvil,
  };
}

/**
 * Compute all achievable Chef counts considering alignment registration.
 * Returns a sorted array of distinct valid counts.
 */
function computeChefCounts(config: NightInfoConfig): number[] {
  const { numPlayers, seatRoles, script } = config;

  // Find seats with flexible alignment registration
  const flexibleSeats: Seat[] = [];
  for (const [seat] of seatRoles) {
    const opts = getAlignmentOptions(seat, seatRoles, script);
    if (opts.canBeEvil && opts.canBeGood) {
      flexibleSeats.push(seat);
    }
  }

  if (flexibleSeats.length === 0) {
    // No flexible seats — single deterministic count
    let pairCount = 0;
    for (let s = 0; s < numPlayers; s++) {
      const next = (s + 1) % numPlayers;
      if (isEvil(s, seatRoles, script) && isEvil(next, seatRoles, script)) {
        pairCount++;
      }
    }
    return [pairCount];
  }

  // Enumerate all 2^K combinations of flexible seat registrations
  const counts = new Set<number>();
  const numFlex = flexibleSeats.length;

  for (let mask = 0; mask < (1 << numFlex); mask++) {
    const effectiveEvil = new Set<Seat>();

    for (const [seat] of seatRoles) {
      const flexIdx = flexibleSeats.indexOf(seat);
      if (flexIdx >= 0) {
        // Flexible: evil if bit is set
        if (mask & (1 << flexIdx)) {
          effectiveEvil.add(seat);
        }
      } else {
        if (isEvil(seat, seatRoles, script)) {
          effectiveEvil.add(seat);
        }
      }
    }

    let pairCount = 0;
    for (let s = 0; s < numPlayers; s++) {
      const next = (s + 1) % numPlayers;
      if (effectiveEvil.has(s) && effectiveEvil.has(next)) {
        pairCount++;
      }
    }
    counts.add(pairCount);
  }

  return [...counts].sort((a, b) => a - b);
}

/**
 * Compute all achievable Empath counts considering alignment registration.
 * Returns a sorted array of distinct valid counts.
 */
function computeEmpathCounts(config: NightInfoConfig, empathSeat: Seat): number[] {
  const { numPlayers, seatRoles, script } = config;

  const left = (empathSeat - 1 + numPlayers) % numPlayers;
  const right = (empathSeat + 1) % numPlayers;

  const leftOpts = getAlignmentOptions(left, seatRoles, script);
  const rightOpts = getAlignmentOptions(right, seatRoles, script);

  const leftFlexible = leftOpts.canBeEvil && leftOpts.canBeGood;
  const rightFlexible = rightOpts.canBeEvil && rightOpts.canBeGood;

  if (!leftFlexible && !rightFlexible) {
    let count = 0;
    if (leftOpts.canBeEvil) count++;
    if (rightOpts.canBeEvil) count++;
    return [count];
  }

  const counts = new Set<number>();
  const leftOptions = leftFlexible ? [false, true] : [leftOpts.canBeEvil];
  const rightOptions = rightFlexible ? [false, true] : [rightOpts.canBeEvil];

  for (const leftEvil of leftOptions) {
    for (const rightEvil of rightOptions) {
      let count = 0;
      if (leftEvil) count++;
      if (rightEvil) count++;
      counts.add(count);
    }
  }

  return [...counts].sort((a, b) => a - b);
}

/**
 * Check if a seat can "ping" for the Fortune Teller (register as Demon).
 */
function canPingAsDemon(
  seat: Seat,
  seatRoles: Map<Seat, string>,
  script: Script,
): boolean {
  const role = seatRoles.get(seat);
  if (!role) return false;
  const roleObj = getRoleObj(role, script);
  if (!roleObj) return false;
  return roleObj.registersAs?.roleTypes.includes(RoleType.Demon) === true;
}

/**
 * Check if a seat is eligible to be the Fortune Teller's red herring.
 *
 * Per BotC rules the red herring cannot be the Demon and must be a player
 * who CAN register as Good. Townsfolk and Outsiders are naturally good.
 * Minions/Demons are naturally evil, but a role with
 * registersAs.alignments including "Good" (e.g. the Spy) is also eligible.
 */
function canBeRedHerring(
  seat: Seat,
  demonSeat: Seat,
  seatRoles: Map<Seat, string>,
  script: Script,
): boolean {
  if (seat === demonSeat) return false;
  const opts = getAlignmentOptions(seat, seatRoles, script);
  return opts.canBeGood;
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
 * Build info variables for a pair-based role.
 *
 * When functioning: accounts for Spy/Recluse registration capabilities.
 * When malfunctioning: any pair × any role of the target type from the script.
 */
function buildPairRoleInfo(
  zdd: ZDD,
  config: NightInfoConfig,
  infoRoleName: string,
  targetType: RoleType,
  nextVarId: number,
  malfunctioningSeats: Set<Seat>,
): RoleInfoResult {
  const infoSeat = findSeatByRole(config.seatRoles, infoRoleName);
  if (infoSeat === undefined) return emptyResult();

  const malfunctioning = isSeatMalfunctioning(infoSeat, malfunctioningSeats);

  if (malfunctioning) {
    return buildMalfunctioningPairRoleInfo(
      zdd, config, infoRoleName, targetType, nextVarId, infoSeat,
    );
  }

  // --- Functioning path ---
  const targets = findPairTargets(config, infoSeat, targetType);

  // Librarian special case: no valid targets at all
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

  const { numPlayers } = config;
  const variables: NightInfoVariable[] = [];
  const pairOutputs = new Map<number, PairInfoOutput>();
  const varIds: number[] = [];
  let vid = nextVarId;

  // Use a Set to deduplicate (playerA, playerB, roleName) triples
  const seen = new Set<string>();

  for (const { seat: targetSeat, roleNames } of targets) {
    for (const roleName of roleNames) {
      for (let decoy = 0; decoy < numPlayers; decoy++) {
        if (decoy === targetSeat || decoy === infoSeat) continue;

        const playerA = Math.min(targetSeat, decoy);
        const playerB = Math.max(targetSeat, decoy);
        const key = `${playerA},${playerB},${roleName}`;
        if (seen.has(key)) continue;
        seen.add(key);

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
 * When functioning: considers Spy/Recluse alignment registration to compute
 * all achievable counts. When malfunctioning: any count 0..numPlayers.
 */
function buildChefInfo(
  zdd: ZDD,
  config: NightInfoConfig,
  nextVarId: number,
  malfunctioningSeats: Set<Seat>,
): RoleInfoResult {
  const { numPlayers, seatRoles } = config;

  const chefSeat = findSeatByRole(seatRoles, "Chef");
  if (chefSeat === undefined) return emptyResult();

  const malfunctioning = isSeatMalfunctioning(chefSeat, malfunctioningSeats);

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

  let validVarIds: number[];
  if (malfunctioning) {
    validVarIds = allVarIds;
  } else {
    const validCounts = computeChefCounts(config);
    validVarIds = validCounts.map((c) => nextVarId + c);
  }

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
 * When functioning: considers Spy/Recluse alignment registration to compute
 * all achievable counts. When malfunctioning: 0, 1, or 2.
 */
function buildEmpathInfo(
  zdd: ZDD,
  config: NightInfoConfig,
  nextVarId: number,
  malfunctioningSeats: Set<Seat>,
): RoleInfoResult {
  const { seatRoles } = config;

  const empathSeat = findSeatByRole(seatRoles, "Empath");
  if (empathSeat === undefined) return emptyResult();

  const malfunctioning = isSeatMalfunctioning(empathSeat, malfunctioningSeats);

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

  let validVarIds: number[];
  if (malfunctioning) {
    validVarIds = allVarIds;
  } else {
    const validCounts = computeEmpathCounts(config, empathSeat);
    validVarIds = validCounts.map((c) => nextVarId + c);
  }

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
// Fortune Teller output builder
// ---------------------------------------------------------------------------

interface FTInfoResult {
  root: NodeId;
  variables: NightInfoVariable[];
  fortuneTellerOutputs: Map<number, FortuneTellerOutput>;
  varCount: number;
}

function emptyFTResult(): FTInfoResult {
  return {
    root: TOP,
    variables: [],
    fortuneTellerOutputs: new Map(),
    varCount: 0,
  };
}

/**
 * Build the maximal set of Fortune Teller output variables.
 * All pairs × both answers (Yes/No).
 */
function buildFTMaximalVariables(
  config: NightInfoConfig,
  ftSeat: Seat,
  nextVarId: number,
): {
  variables: NightInfoVariable[];
  fortuneTellerOutputs: Map<number, FortuneTellerOutput>;
  varCount: number;
} {
  const { numPlayers } = config;
  const variables: NightInfoVariable[] = [];
  const fortuneTellerOutputs = new Map<number, FortuneTellerOutput>();
  let vid = nextVarId;

  for (let a = 0; a < numPlayers; a++) {
    if (a === ftSeat) continue;
    for (let b = a + 1; b < numPlayers; b++) {
      if (b === ftSeat) continue;
      for (const answer of ["Yes", "No"] as const) {
        variables.push({
          id: vid,
          infoRole: "Fortune Teller",
          description: `FT picks ${a},${b} — ${answer}`,
        });
        fortuneTellerOutputs.set(vid, { playerA: a, playerB: b, answer });
        vid++;
      }
    }
  }

  return {
    variables,
    fortuneTellerOutputs,
    varCount: vid - nextVarId,
  };
}

/**
 * Build Fortune Teller ZDD for a specific red herring seat (functioning).
 *
 * For each pair (a, b), determine valid answers:
 * - "mustPing": seat is Demon or red herring → always Yes
 * - "canPing": seat has registersAs including Demon → Yes or No
 * - otherwise → No
 */
function buildFTConstrained(
  zdd: ZDD,
  config: NightInfoConfig,
  ftSeat: Seat,
  demonSeat: Seat,
  redHerringSeat: Seat,
  ftMaximal: {
    fortuneTellerOutputs: Map<number, FortuneTellerOutput>;
    varCount: number;
  },
  ftVarStart: number,
): NodeId {
  const { seatRoles, script } = config;
  const validVarIds: number[] = [];

  for (let v = ftVarStart; v < ftVarStart + ftMaximal.varCount; v++) {
    const output = ftMaximal.fortuneTellerOutputs.get(v);
    if (!output) continue;

    const aMustPing = output.playerA === demonSeat || output.playerA === redHerringSeat;
    const bMustPing = output.playerB === demonSeat || output.playerB === redHerringSeat;
    const aCanPing = !aMustPing && canPingAsDemon(output.playerA, seatRoles, script);
    const bCanPing = !bMustPing && canPingAsDemon(output.playerB, seatRoles, script);

    if (aMustPing || bMustPing) {
      // At least one must ping → only Yes is valid
      if (output.answer === "Yes") validVarIds.push(v);
    } else if (aCanPing || bCanPing) {
      // Neither must ping, but one can → both Yes and No are valid
      validVarIds.push(v);
    } else {
      // Neither pings → only No is valid
      if (output.answer === "No") validVarIds.push(v);
    }
  }

  if (validVarIds.length === 0) return BOTTOM;
  return exactlyOne(zdd, validVarIds);
}

// ---------------------------------------------------------------------------
// Info role builder (dispatches to specific builders) — non-FT roles only
// ---------------------------------------------------------------------------

/**
 * Build all non-FT info role variables for a given set of malfunctioning seats.
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
// Constrained builder (for Poisoner branching)
// ---------------------------------------------------------------------------

/**
 * Build info role ZDD for a specific branch, using the same variable layout
 * as the maximal result.
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
 * from the maximal layout.
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
  const truthfulVarIds: number[] = [];

  if (roleSpec.kind === "pair") {
    const infoSeat = findSeatByRole(config.seatRoles, roleSpec.name)!;
    const targets = findPairTargets(config, infoSeat, roleSpec.targetType);

    if (targets.length === 0 && roleSpec.name === "Librarian") {
      // "No Outsiders" is the truthful output
      for (let v = range.start; v < range.start + range.count; v++) {
        if (!maximalResult.pairOutputs.has(v)) {
          truthfulVarIds.push(v);
          break;
        }
      }
    } else if (targets.length === 0) {
      return BOTTOM;
    } else {
      // Match truthful outputs against maximal variables
      // Use a Set for fast lookup of valid (seat, roleName) combos
      const validCombos = new Set<string>();
      for (const { seat, roleNames } of targets) {
        for (const rn of roleNames) {
          validCombos.add(`${seat},${rn}`);
        }
      }

      for (let v = range.start; v < range.start + range.count; v++) {
        const output = maximalResult.pairOutputs.get(v);
        if (!output) continue;

        // Check if either shown player is a valid reference for the named role
        const aValid = validCombos.has(`${output.playerA},${output.namedRole}`);
        const bValid = validCombos.has(`${output.playerB},${output.namedRole}`);
        if (aValid || bValid) truthfulVarIds.push(v);
      }
    }
  } else if (roleSpec.kind === "chef") {
    const validCounts = computeChefCounts(config);
    for (let v = range.start; v < range.start + range.count; v++) {
      const output = maximalResult.countOutputs.get(v);
      if (output && validCounts.includes(output.count)) {
        truthfulVarIds.push(v);
      }
    }
  } else {
    // Empath
    const empathSeat = findSeatByRole(config.seatRoles, "Empath")!;
    const validCounts = computeEmpathCounts(config, empathSeat);
    for (let v = range.start; v < range.start + range.count; v++) {
      const output = maximalResult.countOutputs.get(v);
      if (output && validCounts.includes(output.count)) {
        truthfulVarIds.push(v);
      }
    }
  }

  if (truthfulVarIds.length === 0) return BOTTOM;
  return exactlyOne(zdd, truthfulVarIds);
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build the Night 1 information ZDD for a concrete seat assignment.
 *
 * Handles Poisoner branching, Fortune Teller red herring branching,
 * and Spy/Recluse registration effects.
 */
export function buildNightInfoZDD(
  zdd: ZDD,
  config: NightInfoConfig,
): NightInfoResult {
  const { numPlayers, seatRoles } = config;
  const baseMalfunctioning = config.malfunctioningSeats ?? new Set<Seat>();

  const poisonerSeat = findSeatByRole(seatRoles, "Poisoner");
  const ftSeat = findSeatByRole(seatRoles, "Fortune Teller");

  // Find the Demon seat (for red herring eligibility)
  let demonSeat: Seat | undefined;
  for (const [seat, role] of seatRoles) {
    if (getRoleType(role, config.script) === RoleType.Demon) {
      demonSeat = seat;
      break;
    }
  }

  const hasPoisoner = poisonerSeat !== undefined;
  const hasFT = ftSeat !== undefined && demonSeat !== undefined;

  if (!hasPoisoner && !hasFT) {
    return buildSimple(zdd, config, baseMalfunctioning);
  }
  if (!hasPoisoner && hasFT) {
    return buildWithFTOnly(zdd, config, baseMalfunctioning, ftSeat!, demonSeat!);
  }
  if (hasPoisoner && !hasFT) {
    return buildWithPoisonerOnly(zdd, config, poisonerSeat!, baseMalfunctioning);
  }
  // Both Poisoner and FT
  return buildWithPoisonerAndFT(
    zdd, config, poisonerSeat!, baseMalfunctioning, ftSeat!, demonSeat!,
  );
}

// ---------------------------------------------------------------------------
// Build paths
// ---------------------------------------------------------------------------

/** No Poisoner, no FT — simple cross-product. */
function buildSimple(
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
    redHerringOutputs: new Map(),
    fortuneTellerOutputs: new Map(),
  };
}

/** FT in play, no Poisoner. Red herring branching only. */
function buildWithFTOnly(
  zdd: ZDD,
  config: NightInfoConfig,
  baseMalfunctioning: Set<Seat>,
  ftSeat: Seat,
  demonSeat: Seat,
): NightInfoResult {
  const { numPlayers } = config;

  // --- Step 1: Allocate red herring designation variables ---
  const redHerringOutputs = new Map<number, RedHerringOutput>();
  const rhVariables: NightInfoVariable[] = [];
  const rhVarIds: number[] = [];
  let vid = 0;

  for (let seat = 0; seat < numPlayers; seat++) {
    if (!canBeRedHerring(seat, demonSeat, config.seatRoles, config.script)) continue;
    rhVariables.push({
      id: vid,
      infoRole: "RedHerring",
      description: `Red herring: seat ${seat}`,
    });
    redHerringOutputs.set(vid, { targetSeat: seat });
    rhVarIds.push(vid);
    vid++;
  }
  const rhVarCount = vid;
  const infoVarStart = rhVarCount;

  // --- Step 2: Build non-FT info roles (independent of red herring) ---
  const nonFTResult = buildAllInfoRoles(zdd, config, infoVarStart, baseMalfunctioning);
  const ftVarStart = infoVarStart + nonFTResult.totalVarCount;

  // --- Step 3: Build FT maximal variables ---
  const ftMaximal = buildFTMaximalVariables(config, ftSeat, ftVarStart);
  const ftMalfunctioning = isSeatMalfunctioning(ftSeat, baseMalfunctioning);

  // --- Step 4: Build FT branches per red herring candidate ---
  let ftRhCombined: NodeId = BOTTOM;

  for (let rhIdx = 0; rhIdx < rhVarIds.length; rhIdx++) {
    const rhVarId = rhVarIds[rhIdx];
    const rhSeat = redHerringOutputs.get(rhVarId)!.targetSeat;

    let ftRoot: NodeId;
    if (ftMalfunctioning) {
      // FT unconstrained: all vars valid
      const allFTVarIds: number[] = [];
      for (let v = ftVarStart; v < ftVarStart + ftMaximal.varCount; v++) {
        allFTVarIds.push(v);
      }
      ftRoot = exactlyOne(zdd, allFTVarIds);
    } else {
      ftRoot = buildFTConstrained(
        zdd, config, ftSeat, demonSeat, rhSeat, ftMaximal, ftVarStart,
      );
    }

    const rhSingleton = zdd.singleSet([rhVarId]);
    const branch = zdd.product(rhSingleton, ftRoot);
    ftRhCombined = zdd.union(ftRhCombined, branch);
  }

  // --- Step 5: Combine non-FT × (RH + FT) ---
  const combinedRoot = zdd.product(nonFTResult.root, ftRhCombined);

  // --- Assemble result ---
  const allVariables = [...rhVariables, ...nonFTResult.variables, ...ftMaximal.variables];
  const roleRanges = new Map<string, { start: number; count: number }>();
  roleRanges.set("RedHerring", { start: 0, count: rhVarCount });
  for (const [role, range] of nonFTResult.roleRanges) {
    roleRanges.set(role, range);
  }
  if (ftMaximal.varCount > 0) {
    roleRanges.set("Fortune Teller", { start: ftVarStart, count: ftMaximal.varCount });
  }

  return {
    root: combinedRoot,
    variableCount: rhVarCount + nonFTResult.totalVarCount + ftMaximal.varCount,
    variables: allVariables,
    roleVariableRanges: roleRanges,
    pairOutputs: nonFTResult.pairOutputs,
    countOutputs: nonFTResult.countOutputs,
    poisonerTargetOutputs: new Map(),
    redHerringOutputs,
    fortuneTellerOutputs: ftMaximal.fortuneTellerOutputs,
  };
}

/** Poisoner in play, no FT. Poisoner branching only. */
function buildWithPoisonerOnly(
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

  // --- Step 2: Build maximal (all malfunctioning) for variable layout ---
  const allSeats = new Set<Seat>();
  for (let s = 0; s < numPlayers; s++) allSeats.add(s);
  const maximalResult = buildAllInfoRoles(zdd, config, infoVarStart, allSeats);

  // --- Step 3: Per-poisoner-target branches ---
  let combinedRoot: NodeId = BOTTOM;

  for (let targetIdx = 0; targetIdx < poisonerVarIds.length; targetIdx++) {
    const targetVarId = poisonerVarIds[targetIdx];
    const targetSeat = poisonerTargetOutputs.get(targetVarId)!.targetSeat;

    const branchMalfunctioning = new Set(baseMalfunctioning);
    branchMalfunctioning.add(targetSeat);

    const branchInfo = buildAllInfoRolesConstrained(
      zdd, config, infoVarStart, branchMalfunctioning, maximalResult,
    );

    const poisonerSingleton = zdd.singleSet([targetVarId]);
    const branchZDD = zdd.product(poisonerSingleton, branchInfo);
    combinedRoot = zdd.union(combinedRoot, branchZDD);
  }

  // --- Assemble result ---
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
    redHerringOutputs: new Map(),
    fortuneTellerOutputs: new Map(),
  };
}

/** Both Poisoner and FT in play. Nested branching. */
function buildWithPoisonerAndFT(
  zdd: ZDD,
  config: NightInfoConfig,
  poisonerSeat: Seat,
  baseMalfunctioning: Set<Seat>,
  ftSeat: Seat,
  demonSeat: Seat,
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

  // --- Step 2: Allocate red herring designation variables ---
  const redHerringOutputs = new Map<number, RedHerringOutput>();
  const rhVariables: NightInfoVariable[] = [];
  const rhVarIds: number[] = [];

  for (let seat = 0; seat < numPlayers; seat++) {
    if (!canBeRedHerring(seat, demonSeat, config.seatRoles, config.script)) continue;
    rhVariables.push({
      id: vid,
      infoRole: "RedHerring",
      description: `Red herring: seat ${seat}`,
    });
    redHerringOutputs.set(vid, { targetSeat: seat });
    rhVarIds.push(vid);
    vid++;
  }
  const rhVarCount = rhVarIds.length;
  const infoVarStart = vid;

  // --- Step 3: Build maximal non-FT info roles ---
  const allSeats = new Set<Seat>();
  for (let s = 0; s < numPlayers; s++) allSeats.add(s);
  const maximalNonFT = buildAllInfoRoles(zdd, config, infoVarStart, allSeats);
  const ftVarStart = infoVarStart + maximalNonFT.totalVarCount;

  // --- Step 4: Build FT maximal variables ---
  const ftMaximal = buildFTMaximalVariables(config, ftSeat, ftVarStart);

  // --- Step 5: Per-poisoner-target branches ---
  let combinedRoot: NodeId = BOTTOM;

  for (let targetIdx = 0; targetIdx < poisonerVarIds.length; targetIdx++) {
    const targetVarId = poisonerVarIds[targetIdx];
    const targetSeat = poisonerTargetOutputs.get(targetVarId)!.targetSeat;

    const branchMalfunctioning = new Set(baseMalfunctioning);
    branchMalfunctioning.add(targetSeat);

    // Build non-FT info for this branch
    const nonFTRoot = buildAllInfoRolesConstrained(
      zdd, config, infoVarStart, branchMalfunctioning, maximalNonFT,
    );

    // Build FT + RH for this branch
    const ftIsMalfunctioning = isSeatMalfunctioning(ftSeat, branchMalfunctioning);

    let ftRhCombined: NodeId = BOTTOM;

    for (let rhIdx = 0; rhIdx < rhVarIds.length; rhIdx++) {
      const rhVarId = rhVarIds[rhIdx];
      const rhSeat = redHerringOutputs.get(rhVarId)!.targetSeat;

      let ftRoot: NodeId;
      if (ftIsMalfunctioning) {
        const allFTVarIds: number[] = [];
        for (let v = ftVarStart; v < ftVarStart + ftMaximal.varCount; v++) {
          allFTVarIds.push(v);
        }
        ftRoot = exactlyOne(zdd, allFTVarIds);
      } else {
        ftRoot = buildFTConstrained(
          zdd, config, ftSeat, demonSeat, rhSeat, ftMaximal, ftVarStart,
        );
      }

      const rhSingleton = zdd.singleSet([rhVarId]);
      const branch = zdd.product(rhSingleton, ftRoot);
      ftRhCombined = zdd.union(ftRhCombined, branch);
    }

    // Combine: poisoner × nonFT × (RH + FT)
    const poisonerSingleton = zdd.singleSet([targetVarId]);
    const branchZDD = zdd.product(poisonerSingleton, zdd.product(nonFTRoot, ftRhCombined));
    combinedRoot = zdd.union(combinedRoot, branchZDD);
  }

  // --- Assemble result ---
  const allVariables = [
    ...poisonerVariables,
    ...rhVariables,
    ...maximalNonFT.variables,
    ...ftMaximal.variables,
  ];
  const roleRanges = new Map<string, { start: number; count: number }>();
  roleRanges.set("Poisoner", { start: 0, count: poisonerVarCount });
  roleRanges.set("RedHerring", { start: poisonerVarCount, count: rhVarCount });
  for (const [role, range] of maximalNonFT.roleRanges) {
    roleRanges.set(role, range);
  }
  if (ftMaximal.varCount > 0) {
    roleRanges.set("Fortune Teller", { start: ftVarStart, count: ftMaximal.varCount });
  }

  return {
    root: combinedRoot,
    variableCount: poisonerVarCount + rhVarCount + maximalNonFT.totalVarCount + ftMaximal.varCount,
    variables: allVariables,
    roleVariableRanges: roleRanges,
    pairOutputs: maximalNonFT.pairOutputs,
    countOutputs: maximalNonFT.countOutputs,
    poisonerTargetOutputs,
    redHerringOutputs,
    fortuneTellerOutputs: ftMaximal.fortuneTellerOutputs,
  };
}

// ---------------------------------------------------------------------------
// Observation handler for NightInfo phase
// ---------------------------------------------------------------------------

/**
 * Apply an observation to a night info ZDD.
 *
 * Only `require-variable` and `exclude-variable` observations are supported.
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

/**
 * Find the variable ID for a specific red herring designation.
 */
export function findRedHerringVariable(
  result: NightInfoResult,
  targetSeat: Seat,
): number | undefined {
  for (const [varId, output] of result.redHerringOutputs) {
    if (output.targetSeat === targetSeat) {
      return varId;
    }
  }
  return undefined;
}

/**
 * Find the variable ID for a specific Fortune Teller output.
 */
export function findFortuneTellerVariable(
  result: NightInfoResult,
  playerA: Seat,
  playerB: Seat,
  answer: "Yes" | "No",
): number | undefined {
  const range = result.roleVariableRanges.get("Fortune Teller");
  if (!range) return undefined;

  const a = Math.min(playerA, playerB);
  const b = Math.max(playerA, playerB);

  for (const [varId, output] of result.fortuneTellerOutputs) {
    if (
      varId >= range.start &&
      varId < range.start + range.count &&
      output.playerA === a &&
      output.playerB === b &&
      output.answer === answer
    ) {
      return varId;
    }
  }
  return undefined;
}
