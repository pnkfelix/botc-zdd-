/**
 * Phase chain manager.
 *
 * Holds the sequence of phase ZDDs as a game progresses.
 * Supports advancing phases, applying observations, querying
 * remaining worlds, and undoing phases.
 */

import { ZDD, BOTTOM, TOP, type NodeId } from "./zdd.js";
import {
  type Script,
  type Observation,
  type Query,
  type QueryResult,
  type Seat,
  PhaseType,
  type PhaseInfo,
} from "./types.js";
import { RoleType, buildDistributionZDD, buildDistributionZDDWithModifiers, resolveRoles } from "./botc.js";
import { buildSeatAssignmentZDD } from "./seats.js";
import { applyObservation, applyObservations, executeQuery } from "./constraints.js";
import {
  buildNightInfoZDD,
  applyNightInfoObservation,
  type NightInfoConfig,
  type NightInfoResult,
} from "./night.js";
import {
  buildNightActionZDD,
  applyNightActionObservation,
  type NightActionConfig,
  type NightActionResult,
} from "./night-action.js";

// ---------------------------------------------------------------------------
// Day phase types
// ---------------------------------------------------------------------------

/** Result of recording a Day phase. */
export interface DayResult {
  /** Which day this is (1-indexed: Day 1 follows Night 1). */
  dayNumber: number;
  /** The seat that was executed, or null if no execution. */
  executedSeat: Seat | null;
  /** The role of the executed player, or null if no execution. */
  executedRole: string | null;
  /** Seats that died during the day from other causes (Virgin trigger, Slayer). */
  otherDeaths: Seat[];
  /** Cumulative set of all dead seats after this day. */
  deadSeats: Set<Seat>;
  /** If Scarlet Woman promotion occurred, the seat that became the new Imp. */
  scarletWomanPromotion?: Seat;
  /** Game-over result if the game ended this day, or undefined if it continues. */
  gameOver?: GameOverResult;
  /** Slayer shot ZDD variable outputs (if Slayer shot occurred this day). */
  slayerShotOutputs?: Map<number, SlayerShotOutput>;
}

/** Result of a game-over check. */
export interface GameOverResult {
  /** Which team won. */
  winner: "Good" | "Evil";
  /** Reason for the game ending. */
  reason: string;
}

/** Describes a Slayer shot ZDD variable (one legal (target, outcome) pair). */
export interface SlayerShotOutput {
  /** The target seat. */
  targetSeat: Seat;
  /** Whether the target died in this outcome. */
  targetDied: boolean;
}

// ---------------------------------------------------------------------------
// Phase snapshot (for undo)
// ---------------------------------------------------------------------------

interface PhaseSnapshot {
  info: PhaseInfo;
  /** Root of this phase's ZDD. */
  root: NodeId;
  /** The roles selected for seat assignment (only for SeatAssignment phase). */
  selectedRoles?: string[];
  /** Night info result metadata (only for NightInfo phase). */
  nightInfoResult?: NightInfoResult;
  /** Night action result metadata (only for NightAction phase). */
  nightActionResult?: NightActionResult;
  /** Day result metadata (only for DayAction phase). */
  dayResult?: DayResult;
  /** Dead seats snapshot before this phase (for undo). */
  previousDeadSeats?: Set<Seat>;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export class Game {
  readonly zdd: ZDD;
  readonly script: Script;
  readonly playerCount: number;
  private phases: PhaseSnapshot[] = [];
  /** Cumulative set of all dead seats (from day executions, other day deaths, and observed night deaths). */
  private _deadSeats: Set<Seat> = new Set();
  /** Stored seat assignment for later use (e.g., Undertaker needs to look up executed player's role). */
  private _seatAssignment: Map<Seat, string> | undefined;
  /** Day results stored for later retrieval (e.g., Undertaker). */
  private _dayResults: DayResult[] = [];
  /** Permanently malfunctioning seats (e.g., the Drunk), passed in from buildNightInfo/buildNightAction. */
  private _malfunctioningSeats: Set<Seat> | undefined;
  /** Tracks whether the Slayer has used their ability. */
  private _slayerUsed = false;

  constructor(script: Script, playerCount: number) {
    this.zdd = new ZDD();
    this.script = script;
    this.playerCount = playerCount;
  }

  /** Get the current set of dead seats. */
  get deadSeats(): Set<Seat> {
    return new Set(this._deadSeats);
  }

  /** The current (most recent) phase, or undefined if no phases yet. */
  get currentPhase(): PhaseSnapshot | undefined {
    return this.phases[this.phases.length - 1];
  }

  /** The current ZDD root, or BOTTOM if no phases. */
  get currentRoot(): NodeId {
    return this.currentPhase?.root ?? BOTTOM;
  }

  /** Number of phases in the chain. */
  get phaseCount(): number {
    return this.phases.length;
  }

  /** Get info for all phases. */
  get phaseInfos(): PhaseInfo[] {
    return this.phases.map((p) => p.info);
  }

  // -----------------------------------------------------------------------
  // Phase 1: Role Distribution
  // -----------------------------------------------------------------------

  /**
   * Initialize the game with Phase 1 (role distribution).
   *
   * @param includeModifiers - If true, include modifier-role distribution variants.
   * @returns The distribution ZDD root.
   */
  buildDistribution(includeModifiers = false): NodeId {
    const root = includeModifiers
      ? buildDistributionZDDWithModifiers(this.zdd, this.script, this.playerCount)
      : buildDistributionZDD(this.zdd, this.script, this.playerCount);

    this.phases.push({
      info: {
        type: PhaseType.Distribution,
        label: "Role Distribution",
        variableOffset: 0,
        variableCount: this.script.roles.length,
      },
      root,
    });

    return root;
  }

  // -----------------------------------------------------------------------
  // Phase 2: Seat Assignment
  // -----------------------------------------------------------------------

  /**
   * Advance to Phase 2: build a seat assignment ZDD for a specific
   * role distribution selected from Phase 1.
   *
   * @param selectedRoleVarIds - The variable IDs from Phase 1 that define
   *                             which roles are in play (one enumerated set).
   * @returns The seat assignment ZDD root.
   */
  buildSeatAssignment(selectedRoleVarIds: number[]): NodeId {
    const selectedRoles = resolveRoles(this.script, selectedRoleVarIds);

    // Validate: the selected distribution should have playerCount roles
    if (selectedRoles.length !== this.playerCount) {
      throw new Error(
        `Expected ${this.playerCount} roles, got ${selectedRoles.length}`,
      );
    }

    // Build seat assignment ZDD: all permutations of these roles into seats.
    // This uses a fresh variable space (0..N*N-1) for the seat-role pairs.
    const root = buildSeatAssignmentZDD(this.zdd, this.playerCount);

    this.phases.push({
      info: {
        type: PhaseType.SeatAssignment,
        label: "Seat Assignment",
        variableOffset: this.script.roles.length,
        variableCount: this.playerCount * this.playerCount,
      },
      root,
      selectedRoles,
    });

    return root;
  }

  // -----------------------------------------------------------------------
  // Phase 3: Night 1 Information
  // -----------------------------------------------------------------------

  /**
   * Advance to the Night 1 information phase.
   *
   * Takes a concrete seat-to-role mapping and builds a ZDD representing
   * all valid Storyteller information choices for that assignment.
   *
   * @param seatAssignment - Concrete mapping of seat index to role name.
   * @param malfunctioningSeats - Optional set of seats that are always
   *   malfunctioning (e.g., the Drunk). These seats receive unconstrained
   *   info regardless of poisoner target.
   * @returns The night info ZDD root.
   */
  buildNightInfo(
    seatAssignment: Map<Seat, string>,
    malfunctioningSeats?: Set<Seat>,
  ): NodeId {
    if (seatAssignment.size !== this.playerCount) {
      throw new Error(
        `Expected ${this.playerCount} seat assignments, got ${seatAssignment.size}`,
      );
    }

    const selectedRoles = this.selectedRoles;
    if (!selectedRoles) {
      throw new Error("No selected roles (build seat assignment first)");
    }

    // Store seat assignment for later use (e.g., Undertaker role lookup)
    this._seatAssignment = new Map(seatAssignment);

    // Store malfunctioning seats for Saint check
    if (malfunctioningSeats) {
      this._malfunctioningSeats = new Set(malfunctioningSeats);
    }

    const config: NightInfoConfig = {
      numPlayers: this.playerCount,
      seatRoles: seatAssignment,
      selectedRoles,
      script: this.script,
      malfunctioningSeats,
    };

    const nightResult = buildNightInfoZDD(this.zdd, config);

    const variableOffset = this.phases.reduce(
      (sum, p) => sum + p.info.variableCount,
      0,
    );

    this.phases.push({
      info: {
        type: PhaseType.NightInfo,
        label: "Night 1 Information",
        variableOffset,
        variableCount: nightResult.variableCount,
      },
      root: nightResult.root,
      nightInfoResult: nightResult,
    });

    return nightResult.root;
  }

  // -----------------------------------------------------------------------
  // Phase 4: Night 2 Actions
  // -----------------------------------------------------------------------

  /**
   * Advance to the Night 2 action phase.
   *
   * Takes a concrete seat-to-role mapping and builds a ZDD representing
   * all valid Night 2 action choice combinations (Poisoner retarget,
   * Monk protection, Imp kill, death state, Empath/FT re-query).
   *
   * @param seatAssignment - Concrete mapping of seat index to role name.
   * @param malfunctioningSeats - Optional set of permanently malfunctioning seats.
   * @param redHerringSeat - Red herring seat from Night 1 (if FT is in play).
   * @returns The night action ZDD root.
   */
  buildNightAction(
    seatAssignment: Map<Seat, string>,
    malfunctioningSeats?: Set<Seat>,
    redHerringSeat?: Seat,
  ): NodeId {
    if (seatAssignment.size !== this.playerCount) {
      throw new Error(
        `Expected ${this.playerCount} seat assignments, got ${seatAssignment.size}`,
      );
    }

    const selectedRoles = this.selectedRoles;
    if (!selectedRoles) {
      throw new Error("No selected roles (build seat assignment first)");
    }

    // Get the executed role from the last Day phase (if any)
    const lastDay = this._dayResults[this._dayResults.length - 1];
    const executedRole = lastDay?.executedRole ?? null;

    const config: NightActionConfig = {
      numPlayers: this.playerCount,
      seatRoles: seatAssignment,
      selectedRoles,
      script: this.script,
      malfunctioningSeats,
      redHerringSeat,
      deadSeats: this._deadSeats.size > 0 ? new Set(this._deadSeats) : undefined,
      executedRole,
    };

    const actionResult = buildNightActionZDD(this.zdd, config);

    const variableOffset = this.phases.reduce(
      (sum, p) => sum + p.info.variableCount,
      0,
    );

    this.phases.push({
      info: {
        type: PhaseType.NightAction,
        label: "Night 2 Actions",
        variableOffset,
        variableCount: actionResult.variableCount,
      },
      root: actionResult.root,
      nightActionResult: actionResult,
    });

    return actionResult.root;
  }

  // -----------------------------------------------------------------------
  // Observations & Constraints
  // -----------------------------------------------------------------------

  /**
   * Apply an observation to the current phase's ZDD.
   *
   * For NightInfo phases, only `require-variable` and `exclude-variable`
   * observations are supported.
   *
   * @param obs - The observation to apply.
   * @returns The new ZDD root after narrowing.
   */
  applyObservation(obs: Observation): NodeId {
    const phase = this.currentPhase;
    if (!phase) throw new Error("No active phase");

    if (phase.info.type === PhaseType.NightInfo) {
      phase.root = applyNightInfoObservation(this.zdd, phase.root, obs);
    } else if (phase.info.type === PhaseType.NightAction) {
      phase.root = applyNightActionObservation(this.zdd, phase.root, obs);
    } else {
      phase.root = applyObservation(this.zdd, phase.root, obs, this.playerCount);
    }
    return phase.root;
  }

  /**
   * Apply multiple observations to the current phase.
   */
  applyObservations(observations: Observation[]): NodeId {
    const phase = this.currentPhase;
    if (!phase) throw new Error("No active phase");

    for (const obs of observations) {
      this.applyObservation(obs);
      if (phase.root === BOTTOM) return BOTTOM;
    }
    return phase.root;
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /**
   * Query the current phase's ZDD.
   */
  query(q: Query): QueryResult {
    const phase = this.currentPhase;
    if (!phase) throw new Error("No active phase");

    return executeQuery(this.zdd, phase.root, q, this.playerCount);
  }

  /**
   * Count remaining worlds in the current phase.
   */
  countWorlds(): number {
    return this.zdd.count(this.currentRoot);
  }

  /**
   * Count worlds where a specific seat has a specific role.
   */
  countWithSeatRole(seat: number, roleIndex: number): number {
    const result = this.query({
      kind: "count-with-seat-role",
      seat,
      roleIndex,
    });
    return (result as { kind: "count"; value: number }).value;
  }

  /**
   * Get role probabilities for a given seat.
   * Returns a map from roleIndex to probability (0..1).
   */
  seatProbabilities(seat: number): Map<number, number> {
    const result = this.query({ kind: "seat-probabilities", seat });
    return (result as { kind: "probabilities"; values: Map<number, number> }).values;
  }

  /**
   * Get the selected role names for the current seat assignment phase.
   */
  get selectedRoles(): string[] | undefined {
    const seatPhase = this.phases.find(
      (p) => p.info.type === PhaseType.SeatAssignment,
    );
    return seatPhase?.selectedRoles;
  }

  /**
   * Get the NightInfoResult for the current night info phase.
   */
  get nightInfoResult(): NightInfoResult | undefined {
    const nightPhase = this.phases.find(
      (p) => p.info.type === PhaseType.NightInfo,
    );
    return nightPhase?.nightInfoResult;
  }

  /**
   * Get the NightActionResult for the current night action phase.
   */
  get nightActionResult(): NightActionResult | undefined {
    const actionPhase = this.phases.find(
      (p) => p.info.type === PhaseType.NightAction,
    );
    return actionPhase?.nightActionResult;
  }

  // -----------------------------------------------------------------------
  // Day Phase
  // -----------------------------------------------------------------------

  /**
   * Record a Day phase (execution and/or other deaths).
   *
   * When no Slayer shot is specified, the Day phase has zero ZDD variables
   * and root = TOP. When a Slayer shot is specified, the Day phase builds a
   * ZDD of all legal (target, outcome) pairs, with one variable per pair.
   *
   * @param executedSeat - The seat that was executed, or null if no execution.
   * @param otherDeathsOrOpts - Either a Seat[] of other deaths, or an options
   *   object with `otherDeaths` and/or `slayerShot`.
   * @returns The DayResult.
   */
  recordDay(
    executedSeat: Seat | null,
    otherDeathsOrOpts?: Seat[] | { otherDeaths?: Seat[]; slayerShot?: { slayerSeat: Seat } },
  ): DayResult {
    // Parse overloaded parameter
    let otherDeaths: Seat[];
    let slayerShot: { slayerSeat: Seat } | undefined;
    if (Array.isArray(otherDeathsOrOpts)) {
      otherDeaths = otherDeathsOrOpts;
    } else if (otherDeathsOrOpts) {
      otherDeaths = otherDeathsOrOpts.otherDeaths ?? [];
      slayerShot = otherDeathsOrOpts.slayerShot;
    } else {
      otherDeaths = [];
    }
    // Validate executed seat is alive
    if (executedSeat !== null && this._deadSeats.has(executedSeat)) {
      throw new Error(`Seat ${executedSeat} is already dead and cannot be executed`);
    }

    // Validate other deaths are alive
    for (const seat of otherDeaths) {
      if (this._deadSeats.has(seat)) {
        throw new Error(`Seat ${seat} is already dead (in otherDeaths)`);
      }
    }

    // Snapshot the previous dead set for undo
    const previousDeadSeats = new Set(this._deadSeats);

    // Look up executed role
    let executedRole: string | null = null;
    if (executedSeat !== null) {
      executedRole = this._seatAssignment?.get(executedSeat) ?? null;
      this._deadSeats.add(executedSeat);
    }

    // Add other deaths
    for (const seat of otherDeaths) {
      this._deadSeats.add(seat);
    }

    // Compute day number from existing Day phases
    const dayNumber = this._dayResults.length + 1;

    const dayResult: DayResult = {
      dayNumber,
      executedSeat,
      executedRole,
      otherDeaths: [...otherDeaths],
      deadSeats: new Set(this._deadSeats),
    };

    // --- Saint check: if the executed player is a functioning Saint, evil wins ---
    if (executedSeat !== null && executedRole === "Saint") {
      const malfunctioning = this._malfunctioningSeats?.has(executedSeat) ?? false;
      if (!malfunctioning) {
        dayResult.gameOver = { winner: "Evil", reason: "Saint was executed" };
      }
    }

    // --- Scarlet Woman promotion: if the Imp was executed and 5+ players remain alive ---
    if (executedSeat !== null && executedRole !== null && this._seatAssignment) {
      const executedRoleObj = this.script.roles.find((r) => r.name === executedRole);
      if (executedRoleObj?.type === RoleType.Demon) {
        // Count alive players (after this execution)
        const aliveCount = this.playerCount - this._deadSeats.size;
        if (aliveCount >= 5) {
          // Find a living Scarlet Woman
          let swSeat: Seat | undefined;
          for (const [seat, role] of this._seatAssignment) {
            if (role === "Scarlet Woman" && !this._deadSeats.has(seat)) {
              swSeat = seat;
              break;
            }
          }
          if (swSeat !== undefined) {
            // SW becomes the new Imp
            this._seatAssignment.set(swSeat, "Imp");
            dayResult.scarletWomanPromotion = swSeat;
          }
        }
      }
    }

    // --- Slayer shot ZDD ---
    let dayRoot: NodeId = TOP;
    let dayVarCount = 0;

    if (slayerShot) {
      if (!this._seatAssignment) {
        throw new Error("No seat assignment (build seat assignment first)");
      }
      if (this._deadSeats.has(slayerShot.slayerSeat)) {
        throw new Error(`Slayer (seat ${slayerShot.slayerSeat}) is dead and cannot use ability`);
      }
      if (this._slayerUsed) {
        throw new Error("Slayer ability has already been used");
      }
      const slayerRole = this._seatAssignment.get(slayerShot.slayerSeat);
      if (slayerRole !== "Slayer") {
        throw new Error(`Seat ${slayerShot.slayerSeat} is ${slayerRole}, not Slayer`);
      }

      this._slayerUsed = true;

      const malf = this._malfunctioningSeats ?? new Set<Seat>();
      const slayerFunctioning = !malf.has(slayerShot.slayerSeat);
      const slayerShotOutputs = new Map<number, SlayerShotOutput>();
      let vid = 0;

      // Build variables for each legal (target, outcome) pair
      for (let target = 0; target < this.playerCount; target++) {
        if (this._deadSeats.has(target)) continue; // can't target dead

        const targetRole = this._seatAssignment.get(target);
        const targetRoleObj = targetRole
          ? this.script.roles.find((r) => r.name === targetRole)
          : undefined;
        const targetIsDemon = targetRoleObj?.type === RoleType.Demon;
        const targetCanRegisterAsDemon =
          targetRoleObj?.registersAs?.roleTypes.includes(RoleType.Demon) === true;

        if (slayerFunctioning && targetIsDemon) {
          // Actual Demon: must die
          slayerShotOutputs.set(vid, { targetSeat: target, targetDied: true });
          vid++;
        } else if (slayerFunctioning && targetCanRegisterAsDemon) {
          // Recluse-like: ST decides — both outcomes are legal
          slayerShotOutputs.set(vid, { targetSeat: target, targetDied: true });
          vid++;
          slayerShotOutputs.set(vid, { targetSeat: target, targetDied: false });
          vid++;
        } else {
          // Non-Demon (or malfunctioning Slayer): target survives
          slayerShotOutputs.set(vid, { targetSeat: target, targetDied: false });
          vid++;
        }
      }

      dayVarCount = vid;
      dayResult.slayerShotOutputs = slayerShotOutputs;

      // Build ZDD: family of exactly-one-of-N singletons
      if (vid > 0) {
        const varIds = [...slayerShotOutputs.keys()];
        dayRoot = this._buildExactlyOne(varIds);
      }
    }

    this._dayResults.push(dayResult);

    // Push a phase with PhaseType.DayAction
    this.phases.push({
      info: {
        type: PhaseType.DayAction,
        label: `Day ${dayNumber}`,
        variableOffset: this.phases.reduce((sum, p) => sum + p.info.variableCount, 0),
        variableCount: dayVarCount,
      },
      root: dayRoot,
      dayResult,
      previousDeadSeats,
    });

    return dayResult;
  }

  /**
   * Record an observed night death (the ST sees who died overnight).
   *
   * This does NOT create a new phase — it's a state update to the cumulative
   * dead set. Call after a Night action phase, before the next Day phase.
   *
   * @param seat - The seat that died during the preceding night.
   */
  recordNightDeath(seat: Seat): void {
    if (this._deadSeats.has(seat)) {
      throw new Error(`Seat ${seat} is already dead`);
    }
    this._deadSeats.add(seat);
  }

  // -----------------------------------------------------------------------
  // Slayer Shot Lookup
  // -----------------------------------------------------------------------

  /**
   * Find the variable ID for a specific Slayer shot (target, outcome) pair
   * in the most recent Day phase's ZDD.
   *
   * @param targetSeat - The target seat.
   * @param targetDied - Whether the target died.
   * @returns The variable ID, or undefined if no match.
   */
  findSlayerShotVariable(targetSeat: Seat, targetDied: boolean): number | undefined {
    const lastDay = this._dayResults[this._dayResults.length - 1];
    if (!lastDay?.slayerShotOutputs) return undefined;
    for (const [varId, output] of lastDay.slayerShotOutputs) {
      if (output.targetSeat === targetSeat && output.targetDied === targetDied) {
        return varId;
      }
    }
    return undefined;
  }

  /**
   * Check if the Slayer ability has been used.
   */
  get slayerUsed(): boolean {
    return this._slayerUsed;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Build a ZDD family of exactly-one-of-N singletons: { {v1}, {v2}, …, {vN} }.
   */
  private _buildExactlyOne(vars: number[]): NodeId {
    if (vars.length === 0) return BOTTOM;
    const sorted = [...vars].sort((a, b) => a - b);
    let result: NodeId = BOTTOM;
    for (let i = sorted.length - 1; i >= 0; i--) {
      result = this.zdd.getNode(sorted[i], result, TOP);
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Game-over check
  // -----------------------------------------------------------------------

  /**
   * Check if the game has ended based on the most recent DayResult.
   *
   * Returns the GameOverResult from the last day, or undefined if the game continues.
   */
  checkGameOver(): GameOverResult | undefined {
    const lastDay = this._dayResults[this._dayResults.length - 1];
    return lastDay?.gameOver;
  }

  /**
   * Get the most recent DayResult, or undefined if no days recorded.
   */
  get lastDayResult(): DayResult | undefined {
    return this._dayResults[this._dayResults.length - 1];
  }

  /**
   * Get all DayResults recorded so far.
   */
  get dayResults(): DayResult[] {
    return [...this._dayResults];
  }

  // -----------------------------------------------------------------------
  // Undo
  // -----------------------------------------------------------------------

  /**
   * Pop the most recent phase, returning to the prior phase's state.
   * Returns the popped phase info, or undefined if nothing to undo.
   */
  undo(): PhaseInfo | undefined {
    const popped = this.phases.pop();
    if (!popped) return undefined;

    // If undoing a Day phase, restore the dead set and reverse SW promotion
    if (popped.info.type === PhaseType.DayAction && popped.previousDeadSeats) {
      // Reverse Scarlet Woman promotion if it occurred
      if (popped.dayResult?.scarletWomanPromotion !== undefined && this._seatAssignment) {
        this._seatAssignment.set(popped.dayResult.scarletWomanPromotion, "Scarlet Woman");
      }
      // Reverse Slayer used flag if this day had a Slayer shot
      if (popped.dayResult?.slayerShotOutputs) {
        this._slayerUsed = false;
      }
      this._deadSeats = new Set(popped.previousDeadSeats);
      this._dayResults.pop();
    }

    return popped.info;
  }
}
