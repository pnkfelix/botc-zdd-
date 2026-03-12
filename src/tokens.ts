/**
 * Phase 3: Token / Deception Assignment (stub).
 *
 * In BotC, what players *see* differs from ground truth:
 *   - The Drunk drew a Townsfolk token, but is actually an Outsider.
 *   - The Lunatic thinks they're the Demon.
 *   - Spy/Recluse may register differently to information roles.
 *
 * This module will build a ZDD encoding the ST's deception choices:
 *   "Drunk in seat S believes they are Townsfolk T."
 *
 * Variables encode (deceived-seat, perceived-role) pairs.
 *
 * NOT YET IMPLEMENTED — architecture accommodates it via the phase chain.
 */

import { type NodeId } from "./zdd.js";
import { type Seat, type DeceptionChoice } from "./types.js";

// ---------------------------------------------------------------------------
// Interfaces for future implementation
// ---------------------------------------------------------------------------

/**
 * Configuration for building a token assignment ZDD.
 */
export interface TokenAssignmentConfig {
  /** Number of players. */
  numPlayers: number;
  /** Seat assignments from Phase 2 (seat -> role name). */
  seatAssignments: Map<Seat, string>;
  /** Deception choices the ST must make. */
  deceptionChoices: DeceptionChoice[];
}

/**
 * Result of building a token assignment ZDD.
 */
export interface TokenAssignmentResult {
  root: NodeId;
  /** Variable encoding: maps variable ID to description. */
  variableLabels: Map<number, string>;
}

/**
 * Build a token assignment ZDD (stub — returns undefined).
 *
 * Future implementation will:
 * 1. Identify roles requiring deception (Drunk, Lunatic, etc.)
 * 2. For each, create variables for possible perceived roles
 * 3. Build a ZDD of all valid deception assignments
 * 4. Constrain: Drunk must perceive a Townsfolk not in play, etc.
 */
export function buildTokenAssignmentZDD(
  _config: TokenAssignmentConfig,
): TokenAssignmentResult | undefined {
  // TODO: Implement Phase 3
  return undefined;
}

/**
 * Identify deception choices needed for a given seat assignment.
 *
 * Scans the assignment for roles that produce deceptive tokens
 * (Drunk, Lunatic, etc.) and returns the choices the ST must make.
 */
export function identifyDeceptionChoices(
  seatAssignments: Map<Seat, string>,
  _allScriptRoles: string[],
): DeceptionChoice[] {
  const choices: DeceptionChoice[] = [];

  for (const [seat, role] of seatAssignments) {
    if (role === "Drunk") {
      // The Drunk believes they are a Townsfolk.
      // Which Townsfolk is a ST choice — will be populated with
      // available Townsfolk not in play once fully implemented.
      choices.push({
        seat,
        actualRoleName: "Drunk",
        possiblePerceivedRoles: [], // TODO: populate with available Townsfolk
      });
    }
    // Future: Lunatic, Marionette, etc.
  }

  return choices;
}
