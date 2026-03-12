/**
 * Phase 4+: Night Action ZDD builder (stub).
 *
 * Each night is its own ZDD, conditioned on prior phases:
 *   - Poisoner picks a target (~N variables)
 *   - Information roles receive ST-provided outputs, constrained by
 *     game truth (or unconstrained if poisoned)
 *   - Demon picks a kill target
 *   - Monk picks a protection target
 *
 * When the ST tells the Empath "you see 1", that observation constrains
 * which worlds remain consistent.
 *
 * NOT YET IMPLEMENTED — architecture accommodates it via the phase chain.
 */

import { type NodeId } from "./zdd.js";
import { type Seat, type NightAction, NightActionType } from "./types.js";

// ---------------------------------------------------------------------------
// Interfaces for future implementation
// ---------------------------------------------------------------------------

export interface NightPhaseConfig {
  /** Night number (1, 2, 3, ...). */
  nightNumber: number;
  /** Number of players. */
  numPlayers: number;
  /** Roles assigned to seats (from phase 2). */
  seatRoles: Map<Seat, string>;
  /** Which players are alive at the start of this night. */
  alivePlayers: Set<Seat>;
  /** Which player is poisoned this night (if known). */
  poisonedSeat?: Seat;
}

export interface NightPhaseResult {
  root: NodeId;
  /** Actions resolved during this night. */
  actions: NightAction[];
  /** Variable encoding for this night's ZDD. */
  variableLabels: Map<number, string>;
}

/**
 * Build a night action ZDD (stub — returns undefined).
 *
 * Future implementation will:
 * 1. Create variables for each acting role's choices
 * 2. Build constraint ZDDs for information roles (Empath, etc.)
 * 3. Factor in poisoning (poisoned roles get unconstrained info)
 * 4. Factor in Monk protection
 * 5. Combine via cross-product for independent actions
 */
export function buildNightPhaseZDD(
  _config: NightPhaseConfig,
): NightPhaseResult | undefined {
  // TODO: Implement Phase 4+
  return undefined;
}

/**
 * Get the night action order for Trouble Brewing Night 1.
 *
 * Returns roles in the order they act, per the official first-night order.
 * Only roles that are in play (have a seat) are included.
 */
export function firstNightOrder(seatRoles: Map<Seat, string>): NightAction[] {
  const actions: NightAction[] = [];
  const roleToSeat = new Map<string, Seat>();
  for (const [seat, role] of seatRoles) {
    roleToSeat.set(role, seat);
  }

  // Trouble Brewing first night order (information-relevant roles):
  const order: Array<{ role: string; type: NightActionType }> = [
    { role: "Poisoner", type: NightActionType.PoisonerPick },
    // Information roles would follow in a full implementation
  ];

  for (const { role, type } of order) {
    const seat = roleToSeat.get(role);
    if (seat !== undefined) {
      actions.push({ type, seat });
    }
  }

  return actions;
}
