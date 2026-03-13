/**
 * Night 2+ Action Phase ZDD builder.
 *
 * Given a concrete seat assignment and Night 1 info result, builds a ZDD
 * representing all valid Storyteller + player choice combinations for Night 2.
 *
 * Night 2 action roles modeled (in order):
 * 1. Poisoner (re-targets for Night 2)
 * 2. Monk (chooses player to protect from demon kill — cannot protect self)
 * 3. Imp (chooses kill target — can self-target for starpass)
 * 4. Kill resolution (depends on Monk protection, Poisoner status)
 * 5. Empath (re-queries with updated death state)
 * 6. Fortune Teller (re-queries with updated death state)
 * 7. Undertaker (learns executed player's role from preceding day)
 *
 * 8. Ravenkeeper (death-triggered: if killed by Imp, choose a player to learn their role)
 *
 * Out of scope: Butler.
 */

import { ZDD, BOTTOM, TOP, type NodeId } from "./zdd.js";
import { type Seat } from "./types.js";
import { RoleType, type Script, type Role } from "./botc.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface NightActionConfig {
  /** Number of players in the game. */
  numPlayers: number;
  /** Concrete seat-to-role mapping from Phase 2. */
  seatRoles: Map<Seat, string>;
  /** The role names selected for this game. */
  selectedRoles: string[];
  /** The script being played. */
  script: Script;
  /**
   * Seats that are permanently malfunctioning (e.g., the Drunk).
   * These seats malfunction regardless of Poisoner target.
   */
  malfunctioningSeats?: Set<Seat>;
  /**
   * The red herring seat (carried forward from Night 1).
   * Required if Fortune Teller is in the game.
   */
  redHerringSeat?: Seat;
  /**
   * Seats that are already dead at the start of this night.
   * Dead actors are skipped; dead seats are excluded from targets.
   */
  deadSeats?: Set<Seat>;
  /**
   * The role of the player executed in the preceding day (null if no execution).
   * Used by the Undertaker to learn who was executed.
   */
  executedRole?: string | null;
}

// ---------------------------------------------------------------------------
// Variable descriptors
// ---------------------------------------------------------------------------

/** Describes what a night action variable represents. */
export interface NightActionVariable {
  /** Variable ID within the night action phase (0-based). */
  id: number;
  /** The role/category this variable belongs to. */
  category: string;
  /** Detailed description. */
  description: string;
}

/** Describes a Poisoner Night 2 target variable. */
export interface PoisonerN2TargetOutput {
  targetSeat: Seat;
}

/** Describes a Monk target variable. */
export interface MonkTargetOutput {
  targetSeat: Seat;
}

/** Describes an Imp target variable. */
export interface ImpTargetOutput {
  targetSeat: Seat;
}

/** Describes a starpass recipient variable. */
export interface StarpassRecipientOutput {
  recipientSeat: Seat;
}

/** Describes an Empath Night 2 output variable. */
export interface EmpathN2Output {
  count: number;
}

/** Describes a Fortune Teller Night 2 output variable. */
export interface FortuneTellerN2Output {
  playerA: Seat;
  playerB: Seat;
  answer: "Yes" | "No";
}

/** Describes an Undertaker Night 2 output variable. */
export interface UndertakerOutput {
  /** The role name shown to the Undertaker. */
  roleName: string;
  /** Index of the role in the selected role set. */
  roleIndex: number;
}

/** Describes a Ravenkeeper target choice variable. */
export interface RavenkeeperTargetOutput {
  targetSeat: Seat;
}

/** Describes a Ravenkeeper role-learned output variable. */
export interface RavenkeeperRoleOutput {
  /** The role name shown to the Ravenkeeper. */
  roleName: string;
  /** Index of the role in the selected role set. */
  roleIndex: number;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface NightActionResult {
  /** Root of the night action ZDD. */
  root: NodeId;
  /** Total number of variables in this phase. */
  variableCount: number;
  /** Descriptors for each variable. */
  variables: NightActionVariable[];
  /** Variable ID ranges per category. */
  categoryVariableRanges: Map<string, { start: number; count: number }>;
  /** Poisoner Night 2 target outputs. */
  poisonerN2TargetOutputs: Map<number, PoisonerN2TargetOutput>;
  /** Monk target outputs. */
  monkTargetOutputs: Map<number, MonkTargetOutput>;
  /** Imp target outputs. */
  impTargetOutputs: Map<number, ImpTargetOutput>;
  /** Starpass recipient outputs. */
  starpassRecipientOutputs: Map<number, StarpassRecipientOutput>;
  /** Empath Night 2 outputs. */
  empathN2Outputs: Map<number, EmpathN2Output>;
  /** Fortune Teller Night 2 outputs. */
  fortuneTellerN2Outputs: Map<number, FortuneTellerN2Output>;
  /** Undertaker Night 2 outputs. */
  undertakerOutputs: Map<number, UndertakerOutput>;
  /** Ravenkeeper target outputs. */
  ravenkeeperTargetOutputs: Map<number, RavenkeeperTargetOutput>;
  /** Ravenkeeper role-learned outputs. */
  ravenkeeperRoleOutputs: Map<number, RavenkeeperRoleOutput>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/**
 * Build a ZDD family of exactly-one-of-N singletons: { {v1}, {v2}, …, {vN} }.
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

/**
 * Get alignment registration options for a seat.
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
 * Compute Empath counts for Night 2, considering who died.
 * Dead players are skipped when finding living neighbors.
 * allDeadSeats includes both pre-dead seats and the night death.
 */
function computeEmpathN2Counts(
  config: NightActionConfig,
  empathSeat: Seat,
  allDeadSeats: Set<Seat>,
): number[] {
  const { numPlayers, seatRoles, script } = config;

  // Find left and right living neighbors, skipping dead players
  function findLivingNeighbor(start: Seat, direction: 1 | -1): Seat | null {
    for (let i = 1; i < numPlayers; i++) {
      const candidate = ((start + direction * i) % numPlayers + numPlayers) % numPlayers;
      if (!allDeadSeats.has(candidate)) return candidate;
    }
    return null; // all dead (shouldn't happen in practice)
  }

  const left = findLivingNeighbor(empathSeat, -1);
  const right = findLivingNeighbor(empathSeat, 1);

  if (left === null || right === null) return [0];

  // If left === right (only 2 alive), count once
  if (left === right) {
    const opts = getAlignmentOptions(left, seatRoles, script);
    const flexible = opts.canBeEvil && opts.canBeGood;
    if (flexible) return [0, 1];
    return opts.canBeEvil ? [1] : [0];
  }

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

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build the Night 2 action ZDD for a concrete seat assignment.
 *
 * The variable layout is:
 * [Poisoner N2 targets] [Monk targets] [Imp targets] [Starpass recipients]
 * [Empath N2 outputs] [Fortune Teller N2 outputs]
 *
 * Each combination of choices flows through a cascade:
 * Poisoner → Monk → Imp → Kill resolution → Info roles
 */
export function buildNightActionZDD(
  zdd: ZDD,
  config: NightActionConfig,
): NightActionResult {
  const { numPlayers, seatRoles, script } = config;
  const baseMalfunctioning = config.malfunctioningSeats ?? new Set<Seat>();
  const preDeadSeats = config.deadSeats ?? new Set<Seat>();

  const poisonerSeat = findSeatByRole(seatRoles, "Poisoner");
  const monkSeat = findSeatByRole(seatRoles, "Monk");
  const impSeat = findSeatByRole(seatRoles, "Imp");
  const soldierSeat = findSeatByRole(seatRoles, "Soldier");
  const empathSeat = findSeatByRole(seatRoles, "Empath");
  const ftSeat = findSeatByRole(seatRoles, "Fortune Teller");
  const undertakerSeat = findSeatByRole(seatRoles, "Undertaker");
  const ravenkeeperSeat = findSeatByRole(seatRoles, "Ravenkeeper");

  let demonSeat: Seat | undefined;
  for (const [seat, role] of seatRoles) {
    if (getRoleType(role, script) === RoleType.Demon) {
      demonSeat = seat;
      break;
    }
  }

  // Skip dead actors
  const poisonerAlive = poisonerSeat !== undefined && !preDeadSeats.has(poisonerSeat);
  const monkAlive = monkSeat !== undefined && !preDeadSeats.has(monkSeat);
  const impAlive = impSeat !== undefined && !preDeadSeats.has(impSeat);

  // Find living minions (for starpass eligibility) — exclude dead minions
  const minionSeats: Seat[] = [];
  for (const [seat, role] of seatRoles) {
    if (getRoleType(role, script) === RoleType.Minion && !preDeadSeats.has(seat)) {
      minionSeats.push(seat);
    }
  }
  minionSeats.sort((a, b) => a - b);

  // === VARIABLE ALLOCATION ===

  const variables: NightActionVariable[] = [];
  const categoryRanges = new Map<string, { start: number; count: number }>();
  const poisonerN2TargetOutputs = new Map<number, PoisonerN2TargetOutput>();
  const monkTargetOutputs = new Map<number, MonkTargetOutput>();
  const impTargetOutputs = new Map<number, ImpTargetOutput>();
  const starpassRecipientOutputs = new Map<number, StarpassRecipientOutput>();
  const empathN2Outputs = new Map<number, EmpathN2Output>();
  const fortuneTellerN2Outputs = new Map<number, FortuneTellerN2Output>();

  let vid = 0;

  // --- Poisoner N2 targets ---
  const hasPoisoner = poisonerAlive;
  const poisonerVarStart = vid;
  const poisonerVarIds: number[] = [];

  if (hasPoisoner) {
    for (let target = 0; target < numPlayers; target++) {
      if (target === poisonerSeat) continue;
      if (preDeadSeats.has(target)) continue; // dead players not woken
      variables.push({
        id: vid,
        category: "PoisonerN2",
        description: `Poisoner Night 2 targets seat ${target}`,
      });
      poisonerN2TargetOutputs.set(vid, { targetSeat: target });
      poisonerVarIds.push(vid);
      vid++;
    }
    categoryRanges.set("PoisonerN2", { start: poisonerVarStart, count: vid - poisonerVarStart });
  }

  // --- Monk targets ---
  const hasMonk = monkAlive;
  const monkVarStart = vid;
  const monkVarIds: number[] = [];

  if (hasMonk) {
    for (let target = 0; target < numPlayers; target++) {
      if (target === monkSeat) continue;
      if (preDeadSeats.has(target)) continue; // can't protect dead players
      variables.push({
        id: vid,
        category: "MonkTarget",
        description: `Monk protects seat ${target}`,
      });
      monkTargetOutputs.set(vid, { targetSeat: target });
      monkVarIds.push(vid);
      vid++;
    }
    categoryRanges.set("MonkTarget", { start: monkVarStart, count: vid - monkVarStart });
  }

  // --- Imp targets ---
  const hasImp = impAlive;
  const impVarStart = vid;
  const impVarIds: number[] = [];

  // Determine if starpass is possible (Imp self-target with living minion)
  const starpassPossible = hasImp && minionSeats.length > 0;

  if (hasImp) {
    for (let target = 0; target < numPlayers; target++) {
      // Imp can target anyone, including self (if starpass possible)
      if (target === impSeat && !starpassPossible) continue;
      if (preDeadSeats.has(target)) continue; // can't kill dead players
      variables.push({
        id: vid,
        category: "ImpTarget",
        description: target === impSeat
          ? `Imp self-targets (starpass)`
          : `Imp kills seat ${target}`,
      });
      impTargetOutputs.set(vid, { targetSeat: target });
      impVarIds.push(vid);
      vid++;
    }
    categoryRanges.set("ImpTarget", { start: impVarStart, count: vid - impVarStart });
  }

  // --- Starpass recipients ---
  const starpassVarStart = vid;
  const starpassVarIds: number[] = [];

  if (starpassPossible) {
    for (const minionSeat of minionSeats) {
      // minionSeats already excludes dead minions
      variables.push({
        id: vid,
        category: "StarpassRecipient",
        description: `Starpass: seat ${minionSeat} becomes new Imp`,
      });
      starpassRecipientOutputs.set(vid, { recipientSeat: minionSeat });
      starpassVarIds.push(vid);
      vid++;
    }
    categoryRanges.set("StarpassRecipient", { start: starpassVarStart, count: vid - starpassVarStart });
  }

  // --- Empath N2 outputs ---
  const hasEmpath = empathSeat !== undefined;
  const empathVarStart = vid;
  const empathVarIds: number[] = [];

  if (hasEmpath) {
    for (let c = 0; c <= 2; c++) {
      variables.push({
        id: vid,
        category: "EmpathN2",
        description: `Empath Night 2 count: ${c}`,
      });
      empathN2Outputs.set(vid, { count: c });
      empathVarIds.push(vid);
      vid++;
    }
    categoryRanges.set("EmpathN2", { start: empathVarStart, count: 3 });
  }

  // --- Fortune Teller N2 outputs ---
  const hasFT = ftSeat !== undefined && demonSeat !== undefined;
  const ftVarStart = vid;
  const ftVarIds: number[] = [];

  if (hasFT) {
    for (let a = 0; a < numPlayers; a++) {
      for (let b = a + 1; b < numPlayers; b++) {
        for (const answer of ["Yes", "No"] as const) {
          variables.push({
            id: vid,
            category: "FortuneTellerN2",
            description: `FT Night 2 picks ${a},${b} — ${answer}`,
          });
          fortuneTellerN2Outputs.set(vid, { playerA: a, playerB: b, answer });
          ftVarIds.push(vid);
          vid++;
        }
      }
    }
    categoryRanges.set("FortuneTellerN2", { start: ftVarStart, count: vid - ftVarStart });
  }

  // --- Undertaker N2 outputs ---
  const undertakerOutputs = new Map<number, UndertakerOutput>();
  const hasUndertaker = undertakerSeat !== undefined;
  // Undertaker only has variables if alive (not pre-dead) AND there was an execution
  const undertakerActive = hasUndertaker
    && !preDeadSeats.has(undertakerSeat!)
    && config.executedRole != null;
  const undertakerVarStart = vid;
  const undertakerVarIds: number[] = [];

  if (undertakerActive) {
    const { selectedRoles } = config;
    for (let i = 0; i < selectedRoles.length; i++) {
      variables.push({
        id: vid,
        category: "UndertakerN2",
        description: `Undertaker learns: ${selectedRoles[i]}`,
      });
      undertakerOutputs.set(vid, { roleName: selectedRoles[i], roleIndex: i });
      undertakerVarIds.push(vid);
      vid++;
    }
    categoryRanges.set("UndertakerN2", { start: undertakerVarStart, count: vid - undertakerVarStart });
  }

  // --- Ravenkeeper outputs ---
  // Ravenkeeper fires when killed by Imp this night (not starpass, not already dead).
  // Variables are allocated maximally; branches where RK doesn't fire produce TOP (no RK vars).
  const ravenkeeperTargetOutputs = new Map<number, RavenkeeperTargetOutput>();
  const ravenkeeperRoleOutputs = new Map<number, RavenkeeperRoleOutput>();
  const hasRavenkeeper = ravenkeeperSeat !== undefined;
  // RK must be alive at start of night to potentially fire
  const ravenkeeperCanFire = hasRavenkeeper && !preDeadSeats.has(ravenkeeperSeat!);
  const rkTargetVarStart = vid;
  const rkTargetVarIds: number[] = [];

  if (ravenkeeperCanFire) {
    // Target choice: RK picks any player (including self) to learn their role
    for (let target = 0; target < numPlayers; target++) {
      variables.push({
        id: vid,
        category: "RavenkeeperTarget",
        description: `Ravenkeeper chooses to learn seat ${target}`,
      });
      ravenkeeperTargetOutputs.set(vid, { targetSeat: target });
      rkTargetVarIds.push(vid);
      vid++;
    }
    categoryRanges.set("RavenkeeperTarget", { start: rkTargetVarStart, count: vid - rkTargetVarStart });
  }

  const rkRoleVarStart = vid;
  const rkRoleVarIds: number[] = [];

  if (ravenkeeperCanFire) {
    const { selectedRoles } = config;
    for (let i = 0; i < selectedRoles.length; i++) {
      variables.push({
        id: vid,
        category: "RavenkeeperRole",
        description: `Ravenkeeper learns role: ${selectedRoles[i]}`,
      });
      ravenkeeperRoleOutputs.set(vid, { roleName: selectedRoles[i], roleIndex: i });
      rkRoleVarIds.push(vid);
      vid++;
    }
    categoryRanges.set("RavenkeeperRole", { start: rkRoleVarStart, count: vid - rkRoleVarStart });
  }

  const totalVarCount = vid;

  // === BUILD ZDD THROUGH CASCADING BRANCHES ===

  // We iterate over all combinations of:
  //   Poisoner target × Monk target × Imp target × (Starpass recipient if applicable)
  // For each combination, we determine the kill outcome and build info role outputs.

  let combinedRoot: NodeId = BOTTOM;

  // Poisoner target branches
  const poisonerBranches: Array<{ varId: number; targetSeat: Seat } | null> =
    hasPoisoner
      ? poisonerVarIds.map((v) => ({ varId: v, targetSeat: poisonerN2TargetOutputs.get(v)!.targetSeat }))
      : [null]; // null = no poisoner in play

  for (const poisonerBranch of poisonerBranches) {
    const n2Malfunctioning = new Set(baseMalfunctioning);
    if (poisonerBranch) {
      n2Malfunctioning.add(poisonerBranch.targetSeat);
    }

    // Monk target branches
    const monkBranches: Array<{ varId: number; targetSeat: Seat } | null> =
      hasMonk
        ? monkVarIds.map((v) => ({ varId: v, targetSeat: monkTargetOutputs.get(v)!.targetSeat }))
        : [null];

    for (const monkBranch of monkBranches) {
      const monkFunctioning = hasMonk && !n2Malfunctioning.has(monkSeat!);
      const monkProtectedSeat = monkBranch && monkFunctioning
        ? monkBranch.targetSeat
        : null;

      // Imp target branches
      const impBranches: Array<{ varId: number; targetSeat: Seat }> =
        hasImp
          ? impVarIds.map((v) => ({ varId: v, targetSeat: impTargetOutputs.get(v)!.targetSeat }))
          : [];

      if (!hasImp) {
        // No Imp — no kill, no death. Just combine choices + info roles.
        const infoRoot = buildInfoRolesForBranch(
          zdd, config, empathSeat, ftSeat, demonSeat, undertakerSeat, ravenkeeperSeat,
          empathVarIds, ftVarIds, undertakerVarIds, rkTargetVarIds, rkRoleVarIds,
          empathN2Outputs, fortuneTellerN2Outputs, undertakerOutputs,
          ravenkeeperTargetOutputs, ravenkeeperRoleOutputs,
          n2Malfunctioning, null, preDeadSeats, // nobody died
        );

        let branchRoot = infoRoot;
        if (monkBranch) {
          branchRoot = zdd.product(zdd.singleSet([monkBranch.varId]), branchRoot);
        }
        if (poisonerBranch) {
          branchRoot = zdd.product(zdd.singleSet([poisonerBranch.varId]), branchRoot);
        }
        combinedRoot = zdd.union(combinedRoot, branchRoot);
        continue;
      }

      for (const impBranch of impBranches) {
        const impFunctioning = !n2Malfunctioning.has(impSeat!);
        const isStarpass = impBranch.targetSeat === impSeat;

        // Determine kill outcome
        let deadSeat: Seat | null = null;

        if (impFunctioning) {
          if (isStarpass) {
            // Starpass: Imp dies
            deadSeat = impSeat!;
          } else if (monkProtectedSeat === impBranch.targetSeat) {
            // Monk protection blocks the kill
            deadSeat = null;
          } else if (
            soldierSeat !== undefined &&
            impBranch.targetSeat === soldierSeat &&
            !n2Malfunctioning.has(soldierSeat)
          ) {
            // Soldier immunity: functioning Soldier is immune to demon kill
            deadSeat = null;
          } else {
            // Kill succeeds
            deadSeat = impBranch.targetSeat;
          }
        }
        // If Imp malfunctioning, nobody dies

        // Handle starpass sub-branches
        if (isStarpass && impFunctioning) {
          // Starpass: determine recipient(s).
          // RAW: if a functioning (sober+healthy) Scarlet Woman exists, she MUST
          // become the new Imp — no choice among minions.
          let eligibleStarpassVarIds: number[];

          // Check for a functioning SW among starpass recipients
          const swRecipientVarId = starpassVarIds.find((spVid) => {
            const recipientSeat = starpassRecipientOutputs.get(spVid)!.recipientSeat;
            const recipientRole = seatRoles.get(recipientSeat);
            return recipientRole === "Scarlet Woman" && !n2Malfunctioning.has(recipientSeat);
          });

          if (swRecipientVarId !== undefined) {
            // Functioning SW exists → she is the only valid recipient
            eligibleStarpassVarIds = [swRecipientVarId];
          } else {
            // No functioning SW → any living minion is eligible
            eligibleStarpassVarIds = starpassVarIds;
          }

          for (const spVarId of eligibleStarpassVarIds) {
            const recipient = starpassRecipientOutputs.get(spVarId)!.recipientSeat;

            // After starpass, the recipient is the new demon for FT purposes
            const infoRoot = buildInfoRolesForBranch(
              zdd, config, empathSeat, ftSeat, recipient, undertakerSeat, ravenkeeperSeat,
              empathVarIds, ftVarIds, undertakerVarIds, rkTargetVarIds, rkRoleVarIds,
              empathN2Outputs, fortuneTellerN2Outputs, undertakerOutputs,
              ravenkeeperTargetOutputs, ravenkeeperRoleOutputs,
              n2Malfunctioning, deadSeat, preDeadSeats,
            );

            // Build the set: {poisoner?, monk?, imp, starpassRecipient} × infoRoot
            const choiceVars: number[] = [];
            if (poisonerBranch) choiceVars.push(poisonerBranch.varId);
            if (monkBranch) choiceVars.push(monkBranch.varId);
            choiceVars.push(impBranch.varId);
            choiceVars.push(spVarId);

            const choiceSet = zdd.singleSet(choiceVars.sort((a, b) => a - b));
            const branchZDD = zdd.product(choiceSet, infoRoot);
            combinedRoot = zdd.union(combinedRoot, branchZDD);
          }
        } else {
          // Normal kill (or failed kill)
          const infoRoot = buildInfoRolesForBranch(
            zdd, config, empathSeat, ftSeat, demonSeat, undertakerSeat, ravenkeeperSeat,
            empathVarIds, ftVarIds, undertakerVarIds, rkTargetVarIds, rkRoleVarIds,
            empathN2Outputs, fortuneTellerN2Outputs, undertakerOutputs,
            ravenkeeperTargetOutputs, ravenkeeperRoleOutputs,
            n2Malfunctioning, deadSeat, preDeadSeats,
          );

          const choiceVars: number[] = [];
          if (poisonerBranch) choiceVars.push(poisonerBranch.varId);
          if (monkBranch) choiceVars.push(monkBranch.varId);
          choiceVars.push(impBranch.varId);

          const choiceSet = zdd.singleSet(choiceVars.sort((a, b) => a - b));
          const branchZDD = zdd.product(choiceSet, infoRoot);
          combinedRoot = zdd.union(combinedRoot, branchZDD);
        }
      }
    }
  }

  return {
    root: combinedRoot,
    variableCount: totalVarCount,
    variables,
    categoryVariableRanges: categoryRanges,
    poisonerN2TargetOutputs,
    monkTargetOutputs,
    impTargetOutputs,
    starpassRecipientOutputs,
    empathN2Outputs,
    fortuneTellerN2Outputs,
    undertakerOutputs,
    ravenkeeperTargetOutputs,
    ravenkeeperRoleOutputs,
  };
}

// ---------------------------------------------------------------------------
// Info role builder for a specific branch
// ---------------------------------------------------------------------------

/**
 * Build info role outputs (Empath, FT, Undertaker, Ravenkeeper) for a specific branch given:
 * - malfunctioning seats (from Night 2 poisoner)
 * - who died (from Imp kill resolution)
 *
 * Returns the cross-product of all info role ZDDs for this branch.
 */
function buildInfoRolesForBranch(
  zdd: ZDD,
  config: NightActionConfig,
  empathSeat: Seat | undefined,
  ftSeat: Seat | undefined,
  demonSeat: Seat | undefined,
  undertakerSeat: Seat | undefined,
  ravenkeeperSeat: Seat | undefined,
  empathVarIds: number[],
  ftVarIds: number[],
  undertakerVarIds: number[],
  rkTargetVarIds: number[],
  rkRoleVarIds: number[],
  empathN2Outputs: Map<number, EmpathN2Output>,
  fortuneTellerN2Outputs: Map<number, FortuneTellerN2Output>,
  undertakerOutputs: Map<number, UndertakerOutput>,
  ravenkeeperTargetOutputs: Map<number, RavenkeeperTargetOutput>,
  ravenkeeperRoleOutputs: Map<number, RavenkeeperRoleOutput>,
  n2Malfunctioning: Set<Seat>,
  deadSeat: Seat | null,
  preDeadSeats: Set<Seat>,
): NodeId {
  let root: NodeId = TOP;

  // Empath Night 2
  if (empathSeat !== undefined) {
    const empathRoot = buildEmpathN2ForBranch(
      zdd, config, empathSeat, empathVarIds,
      empathN2Outputs, n2Malfunctioning, deadSeat, preDeadSeats,
    );
    root = zdd.product(root, empathRoot);
  }

  // Fortune Teller Night 2
  if (ftSeat !== undefined && demonSeat !== undefined) {
    const ftRoot = buildFTN2ForBranch(
      zdd, config, ftSeat, demonSeat, ftVarIds,
      fortuneTellerN2Outputs, n2Malfunctioning, deadSeat,
    );
    root = zdd.product(root, ftRoot);
  }

  // Undertaker Night 2
  if (undertakerSeat !== undefined && undertakerVarIds.length > 0) {
    const undertakerRoot = buildUndertakerForBranch(
      zdd, config, undertakerSeat, undertakerVarIds,
      undertakerOutputs, n2Malfunctioning, deadSeat, preDeadSeats,
    );
    root = zdd.product(root, undertakerRoot);
  }

  // Ravenkeeper: fires only if killed by Imp this night
  if (ravenkeeperSeat !== undefined && rkTargetVarIds.length > 0) {
    const rkRoot = buildRavenkeeperForBranch(
      zdd, config, ravenkeeperSeat, rkTargetVarIds, rkRoleVarIds,
      ravenkeeperTargetOutputs, ravenkeeperRoleOutputs,
      n2Malfunctioning, deadSeat, preDeadSeats,
    );
    root = zdd.product(root, rkRoot);
  }

  return root;
}

/**
 * Build Empath Night 2 output for a specific branch.
 */
function buildEmpathN2ForBranch(
  zdd: ZDD,
  config: NightActionConfig,
  empathSeat: Seat,
  empathVarIds: number[],
  empathN2Outputs: Map<number, EmpathN2Output>,
  n2Malfunctioning: Set<Seat>,
  deadSeat: Seat | null,
  preDeadSeats: Set<Seat>,
): NodeId {
  // If the Empath is pre-dead, no Empath output
  if (preDeadSeats.has(empathSeat)) {
    return TOP;
  }

  // If the Empath died this night, no Empath output
  if (deadSeat === empathSeat) {
    return TOP;
  }

  const empathMalfunctioning = n2Malfunctioning.has(empathSeat);

  if (empathMalfunctioning) {
    // Unconstrained: any count is valid
    return exactlyOne(zdd, empathVarIds);
  }

  // Functioning: compute valid counts based on living neighbors
  // Combine pre-dead seats and the night death into one set
  const allDeadSeats = new Set(preDeadSeats);
  if (deadSeat !== null) allDeadSeats.add(deadSeat);
  const validCounts = computeEmpathN2Counts(config, empathSeat, allDeadSeats);
  const validVarIds = empathVarIds.filter((vid) => {
    const output = empathN2Outputs.get(vid);
    return output !== undefined && validCounts.includes(output.count);
  });

  if (validVarIds.length === 0) return BOTTOM;
  return exactlyOne(zdd, validVarIds);
}

/**
 * Build Fortune Teller Night 2 output for a specific branch.
 */
function buildFTN2ForBranch(
  zdd: ZDD,
  config: NightActionConfig,
  ftSeat: Seat,
  demonSeat: Seat,
  ftVarIds: number[],
  fortuneTellerN2Outputs: Map<number, FortuneTellerN2Output>,
  n2Malfunctioning: Set<Seat>,
  deadSeat: Seat | null,
): NodeId {
  const { seatRoles, script } = config;
  const redHerringSeat = config.redHerringSeat;

  const preDeadSeats = config.deadSeats ?? new Set<Seat>();

  // If the FT is pre-dead or died this night, no FT output
  if (preDeadSeats.has(ftSeat) || deadSeat === ftSeat) {
    return TOP;
  }

  const ftMalfunctioning = n2Malfunctioning.has(ftSeat);

  if (ftMalfunctioning) {
    // Unconstrained: any pair+answer is valid
    return exactlyOne(zdd, ftVarIds);
  }

  // Functioning: constrain based on demon and red herring.
  // The demonSeat parameter is the *effective* demon seat for this branch:
  // in non-starpass branches it's the original Imp, in starpass branches
  // it's the starpass recipient (who became the new Imp).

  const validVarIds: number[] = [];

  for (const vid of ftVarIds) {
    const output = fortuneTellerN2Outputs.get(vid);
    if (!output) continue;

    const aMustPing = output.playerA === demonSeat || (redHerringSeat !== undefined && output.playerA === redHerringSeat);
    const bMustPing = output.playerB === demonSeat || (redHerringSeat !== undefined && output.playerB === redHerringSeat);
    const aCanPing = !aMustPing && canPingAsDemon(output.playerA, seatRoles, script);
    const bCanPing = !bMustPing && canPingAsDemon(output.playerB, seatRoles, script);

    if (aMustPing || bMustPing) {
      if (output.answer === "Yes") validVarIds.push(vid);
    } else if (aCanPing || bCanPing) {
      validVarIds.push(vid);
    } else {
      if (output.answer === "No") validVarIds.push(vid);
    }
  }

  if (validVarIds.length === 0) return BOTTOM;
  return exactlyOne(zdd, validVarIds);
}

/**
 * Build Undertaker Night 2 output for a specific branch.
 *
 * The Undertaker learns the role of the player executed during the preceding day.
 * - If the Undertaker is dead (pre-dead or died this night): return TOP (no output).
 * - If no execution: return TOP (Undertaker doesn't wake).
 * - If malfunctioning: any role is valid (exactlyOne over all undertaker vars).
 * - If functioning: exactly the executed player's role.
 */
function buildUndertakerForBranch(
  zdd: ZDD,
  config: NightActionConfig,
  undertakerSeat: Seat,
  undertakerVarIds: number[],
  undertakerOutputs: Map<number, UndertakerOutput>,
  n2Malfunctioning: Set<Seat>,
  deadSeat: Seat | null,
  preDeadSeats: Set<Seat>,
): NodeId {
  // If the Undertaker is pre-dead or died this night: no output
  if (preDeadSeats.has(undertakerSeat) || deadSeat === undertakerSeat) {
    return TOP;
  }

  // If no execution: no output
  const executedRole = config.executedRole;
  if (!executedRole) {
    return TOP;
  }

  // If Undertaker is malfunctioning: any role is valid
  if (n2Malfunctioning.has(undertakerSeat)) {
    return exactlyOne(zdd, undertakerVarIds);
  }

  // Functioning: exactly the executed player's role
  const validVarIds = undertakerVarIds.filter((vid) => {
    const output = undertakerOutputs.get(vid);
    return output !== undefined && output.roleName === executedRole;
  });

  if (validVarIds.length === 0) return BOTTOM;
  return exactlyOne(zdd, validVarIds);
}

/**
 * Build Ravenkeeper output for a specific branch.
 *
 * The Ravenkeeper fires when killed by the Imp this night (deadSeat === ravenkeeperSeat).
 * When fired, they choose a player and learn that player's role.
 * - If RK is pre-dead or NOT killed this night: return TOP (no output).
 * - If malfunctioning: target is any player, role learned can be any role.
 * - If functioning: target is any player, role learned is exactly the target's true role.
 *
 * The output is a cross-product of target choice × role learned, constrained per target.
 */
function buildRavenkeeperForBranch(
  zdd: ZDD,
  config: NightActionConfig,
  ravenkeeperSeat: Seat,
  rkTargetVarIds: number[],
  rkRoleVarIds: number[],
  ravenkeeperTargetOutputs: Map<number, RavenkeeperTargetOutput>,
  ravenkeeperRoleOutputs: Map<number, RavenkeeperRoleOutput>,
  n2Malfunctioning: Set<Seat>,
  deadSeat: Seat | null,
  preDeadSeats: Set<Seat>,
): NodeId {
  // RK only fires if killed this night
  if (preDeadSeats.has(ravenkeeperSeat) || deadSeat !== ravenkeeperSeat) {
    return TOP;
  }

  const { seatRoles } = config;
  const rkMalfunctioning = n2Malfunctioning.has(ravenkeeperSeat);

  if (rkMalfunctioning) {
    // Malfunctioning: any target × any role
    const targetPart = exactlyOne(zdd, rkTargetVarIds);
    const rolePart = exactlyOne(zdd, rkRoleVarIds);
    return zdd.product(targetPart, rolePart);
  }

  // Functioning: for each target, the role learned is exactly the target's true role.
  // Build union of: {targetVar(t)} × {roleVar(trueRole(t))} for each target t
  let rkRoot: NodeId = BOTTOM;

  for (const tVid of rkTargetVarIds) {
    const targetOutput = ravenkeeperTargetOutputs.get(tVid)!;
    const targetRole = seatRoles.get(targetOutput.targetSeat);
    if (targetRole === undefined) continue;

    // Find the role variable matching the target's true role
    const roleVid = rkRoleVarIds.find((rv) => {
      const ro = ravenkeeperRoleOutputs.get(rv);
      return ro !== undefined && ro.roleName === targetRole;
    });
    if (roleVid === undefined) continue;

    const branchSet = zdd.singleSet([tVid, roleVid].sort((a, b) => a - b));
    rkRoot = zdd.union(rkRoot, branchSet);
  }

  return rkRoot;
}

// ---------------------------------------------------------------------------
// Observation handler for NightAction phase
// ---------------------------------------------------------------------------

/**
 * Apply an observation to a night action ZDD.
 *
 * Only `require-variable` and `exclude-variable` observations are supported.
 */
export function applyNightActionObservation(
  zdd: ZDD,
  root: NodeId,
  obs: { kind: string; variable?: number },
): NodeId {
  switch (obs.kind) {
    case "require-variable":
      return zdd.require(root, obs.variable!);
    case "exclude-variable":
      return zdd.offset(root, obs.variable!);
    default:
      throw new Error(
        `Observation kind "${obs.kind}" not supported for NightAction phase`,
      );
  }
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Find the variable ID for a specific Poisoner Night 2 target. */
export function findPoisonerN2TargetVariable(
  result: NightActionResult,
  targetSeat: Seat,
): number | undefined {
  for (const [varId, output] of result.poisonerN2TargetOutputs) {
    if (output.targetSeat === targetSeat) return varId;
  }
  return undefined;
}

/** Find the variable ID for a specific Monk target. */
export function findMonkTargetVariable(
  result: NightActionResult,
  targetSeat: Seat,
): number | undefined {
  for (const [varId, output] of result.monkTargetOutputs) {
    if (output.targetSeat === targetSeat) return varId;
  }
  return undefined;
}

/** Find the variable ID for a specific Imp target. */
export function findImpTargetVariable(
  result: NightActionResult,
  targetSeat: Seat,
): number | undefined {
  for (const [varId, output] of result.impTargetOutputs) {
    if (output.targetSeat === targetSeat) return varId;
  }
  return undefined;
}

/** Find the variable ID for a specific starpass recipient. */
export function findStarpassRecipientVariable(
  result: NightActionResult,
  recipientSeat: Seat,
): number | undefined {
  for (const [varId, output] of result.starpassRecipientOutputs) {
    if (output.recipientSeat === recipientSeat) return varId;
  }
  return undefined;
}

/** Find the variable ID for a specific Empath Night 2 output. */
export function findEmpathN2Variable(
  result: NightActionResult,
  count: number,
): number | undefined {
  for (const [varId, output] of result.empathN2Outputs) {
    if (output.count === count) return varId;
  }
  return undefined;
}

/** Find the variable ID for a specific Fortune Teller Night 2 output. */
export function findFortuneTellerN2Variable(
  result: NightActionResult,
  playerA: Seat,
  playerB: Seat,
  answer: "Yes" | "No",
): number | undefined {
  const a = Math.min(playerA, playerB);
  const b = Math.max(playerA, playerB);

  for (const [varId, output] of result.fortuneTellerN2Outputs) {
    if (output.playerA === a && output.playerB === b && output.answer === answer) {
      return varId;
    }
  }
  return undefined;
}

/** Find the variable ID for a specific Undertaker output (by role name). */
export function findUndertakerVariable(
  result: NightActionResult,
  roleName: string,
): number | undefined {
  for (const [varId, output] of result.undertakerOutputs) {
    if (output.roleName === roleName) return varId;
  }
  return undefined;
}

/** Find the variable ID for a specific Ravenkeeper target. */
export function findRavenkeeperTargetVariable(
  result: NightActionResult,
  targetSeat: Seat,
): number | undefined {
  for (const [varId, output] of result.ravenkeeperTargetOutputs) {
    if (output.targetSeat === targetSeat) return varId;
  }
  return undefined;
}

/** Find the variable ID for a specific Ravenkeeper role-learned output. */
export function findRavenkeeperRoleVariable(
  result: NightActionResult,
  roleName: string,
): number | undefined {
  for (const [varId, output] of result.ravenkeeperRoleOutputs) {
    if (output.roleName === roleName) return varId;
  }
  return undefined;
}
