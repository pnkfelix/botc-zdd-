/**
 * Phase chain manager.
 *
 * Holds the sequence of phase ZDDs as a game progresses.
 * Supports advancing phases, applying observations, querying
 * remaining worlds, and undoing phases.
 */

import { ZDD, BOTTOM, type NodeId } from "./zdd.js";
import {
  type Script,
  type Observation,
  type Query,
  type QueryResult,
  PhaseType,
  type PhaseInfo,
} from "./types.js";
import { buildDistributionZDD, buildDistributionZDDWithModifiers, resolveRoles } from "./botc.js";
import { buildSeatAssignmentZDD } from "./seats.js";
import { applyObservation, applyObservations, executeQuery } from "./constraints.js";

// ---------------------------------------------------------------------------
// Phase snapshot (for undo)
// ---------------------------------------------------------------------------

interface PhaseSnapshot {
  info: PhaseInfo;
  /** Root of this phase's ZDD. */
  root: NodeId;
  /** The roles selected for seat assignment (only for SeatAssignment phase). */
  selectedRoles?: string[];
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export class Game {
  readonly zdd: ZDD;
  readonly script: Script;
  readonly playerCount: number;
  private phases: PhaseSnapshot[] = [];

  constructor(script: Script, playerCount: number) {
    this.zdd = new ZDD();
    this.script = script;
    this.playerCount = playerCount;
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
  // Observations & Constraints
  // -----------------------------------------------------------------------

  /**
   * Apply an observation to the current phase's ZDD.
   *
   * @param obs - The observation to apply.
   * @returns The new ZDD root after narrowing.
   */
  applyObservation(obs: Observation): NodeId {
    const phase = this.currentPhase;
    if (!phase) throw new Error("No active phase");

    phase.root = applyObservation(this.zdd, phase.root, obs, this.playerCount);
    return phase.root;
  }

  /**
   * Apply multiple observations to the current phase.
   */
  applyObservations(observations: Observation[]): NodeId {
    const phase = this.currentPhase;
    if (!phase) throw new Error("No active phase");

    phase.root = applyObservations(
      this.zdd,
      phase.root,
      observations,
      this.playerCount,
    );
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

  // -----------------------------------------------------------------------
  // Undo
  // -----------------------------------------------------------------------

  /**
   * Pop the most recent phase, returning to the prior phase's state.
   * Returns the popped phase info, or undefined if nothing to undo.
   */
  undo(): PhaseInfo | undefined {
    const popped = this.phases.pop();
    return popped?.info;
  }
}
