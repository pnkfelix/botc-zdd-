/**
 * High-level observation API for the botc-zdd engine.
 *
 * Translates human-readable game observations (e.g., "Washerwoman was shown
 * seats 1 and 2 and told one is the Chef") into ZDD require/exclude operations.
 * Designed for integration with the botc-asp web UI Grimoire interface.
 */

import { type NodeId, BOTTOM } from "./zdd.js";
import { type Seat } from "./types.js";
import { Game, type DayResult } from "./game.js";
import {
  findPairInfoVariable,
  findCountInfoVariable,
  findFortuneTellerVariable,
  type NightInfoResult,
} from "./night.js";
import {
  findEmpathN2Variable,
  findFortuneTellerN2Variable,
  findUndertakerVariable,
  findRavenkeeperTargetVariable,
  findRavenkeeperRoleVariable,
  type NightActionResult,
} from "./night-action.js";

// ---------------------------------------------------------------------------
// possibleValues return types
// ---------------------------------------------------------------------------

export interface PairInfoValue {
  seat1: Seat;
  seat2: Seat;
  role: string;
}

export interface CountInfoValue {
  count: number;
}

export interface FortuneTellerValue {
  seat1: Seat;
  seat2: Seat;
  answer: "Yes" | "No";
}

export interface UndertakerValue {
  role: string;
}

export interface RavenkeeperValue {
  targetSeat: Seat;
  learnedRole: string;
}

export interface LibrarianNoOutsidersValue {
  noOutsiders: true;
}

export type PossibleValueEntry = {
  value:
    | PairInfoValue
    | CountInfoValue
    | FortuneTellerValue
    | UndertakerValue
    | RavenkeeperValue
    | LibrarianNoOutsidersValue;
  worldCount: number;
};

// ---------------------------------------------------------------------------
// Undo stack entry
// ---------------------------------------------------------------------------

interface ObservationEntry {
  /** Root before this observation was applied. */
  previousRoot: NodeId;
  /** Description for debugging. */
  description: string;
}

// ---------------------------------------------------------------------------
// GameObserver
// ---------------------------------------------------------------------------

export class GameObserver {
  readonly game: Game;
  private _undoStack: ObservationEntry[] = [];

  constructor(game: Game) {
    this.game = game;
  }

  // -----------------------------------------------------------------------
  // Night 1 info observations
  // -----------------------------------------------------------------------

  /**
   * Observe pair info (Washerwoman, Librarian, Investigator).
   * The player was shown two seats and told one of them is a specific role.
   */
  observePairInfo(
    role: string,
    shownSeat1: Seat,
    shownSeat2: Seat,
    claimedRole: string,
  ): void {
    const nightInfo = this._requireNightInfoResult();
    const varId = findPairInfoVariable(
      nightInfo,
      role,
      shownSeat1,
      shownSeat2,
      claimedRole,
    );
    if (varId === undefined) {
      throw new Error(
        `No variable found for ${role} pair info: seats ${shownSeat1},${shownSeat2} role ${claimedRole}`,
      );
    }
    this._applyRequire(varId, `${role} pair info: seats ${shownSeat1},${shownSeat2} = ${claimedRole}`);
  }

  /**
   * Observe count info (Chef count of evil pairs, Empath count of evil neighbors).
   */
  observeCountInfo(role: string, count: number): void {
    const nightInfo = this._requireNightInfoResult();
    const varId = findCountInfoVariable(nightInfo, role, count);
    if (varId === undefined) {
      throw new Error(
        `No variable found for ${role} count info: count ${count}`,
      );
    }
    this._applyRequire(varId, `${role} count info: ${count}`);
  }

  /**
   * Observe Fortune Teller Night 1 info.
   */
  observeFortuneTellerInfo(
    chosenSeat1: Seat,
    chosenSeat2: Seat,
    answer: "Yes" | "No",
  ): void {
    const nightInfo = this._requireNightInfoResult();
    const varId = findFortuneTellerVariable(
      nightInfo,
      chosenSeat1,
      chosenSeat2,
      answer,
    );
    if (varId === undefined) {
      throw new Error(
        `No variable found for Fortune Teller info: seats ${chosenSeat1},${chosenSeat2} answer ${answer}`,
      );
    }
    this._applyRequire(varId, `Fortune Teller N1: seats ${chosenSeat1},${chosenSeat2} = ${answer}`);
  }

  /**
   * Observe Librarian "no outsiders in play" special output.
   */
  observeLibrarianNoOutsiders(): void {
    const nightInfo = this._requireNightInfoResult();
    const range = nightInfo.roleVariableRanges.get("Librarian");
    if (!range) {
      throw new Error("No Librarian variables found in night info");
    }
    // The "No Outsiders" variable is in the variables array but not in pairOutputs
    let varId: number | undefined;
    for (const v of nightInfo.variables) {
      if (
        v.infoRole === "Librarian" &&
        v.id >= range.start &&
        v.id < range.start + range.count &&
        !nightInfo.pairOutputs.has(v.id)
      ) {
        varId = v.id;
        break;
      }
    }
    if (varId === undefined) {
      throw new Error("No 'No Outsiders' variable found for Librarian");
    }
    this._applyRequire(varId, "Librarian: No Outsiders in play");
  }

  // -----------------------------------------------------------------------
  // Night 2 observations
  // -----------------------------------------------------------------------

  /**
   * Record an observed night death.
   */
  observeNightDeath(seat: Seat): void {
    this.game.recordNightDeath(seat);
  }

  /**
   * Observe Empath Night 2 count.
   */
  observeEmpathN2(count: number): void {
    const actionResult = this._requireNightActionResult();
    const varId = findEmpathN2Variable(actionResult, count);
    if (varId === undefined) {
      throw new Error(
        `No variable found for Empath N2 count: ${count}`,
      );
    }
    this._applyRequire(varId, `Empath N2: count ${count}`);
  }

  /**
   * Observe Fortune Teller Night 2 reading.
   */
  observeFortuneTellerN2(
    chosenSeat1: Seat,
    chosenSeat2: Seat,
    answer: "Yes" | "No",
  ): void {
    const actionResult = this._requireNightActionResult();
    const varId = findFortuneTellerN2Variable(
      actionResult,
      chosenSeat1,
      chosenSeat2,
      answer,
    );
    if (varId === undefined) {
      throw new Error(
        `No variable found for Fortune Teller N2: seats ${chosenSeat1},${chosenSeat2} answer ${answer}`,
      );
    }
    this._applyRequire(varId, `Fortune Teller N2: seats ${chosenSeat1},${chosenSeat2} = ${answer}`);
  }

  /**
   * Observe Undertaker learned the executed player's role.
   */
  observeUndertakerRole(roleName: string): void {
    const actionResult = this._requireNightActionResult();
    const varId = findUndertakerVariable(actionResult, roleName);
    if (varId === undefined) {
      throw new Error(
        `No variable found for Undertaker role: ${roleName}`,
      );
    }
    this._applyRequire(varId, `Undertaker: learned ${roleName}`);
  }

  /**
   * Observe Ravenkeeper chose a player and learned their role.
   * This requires both the target variable and the role variable.
   */
  observeRavenkeeperInfo(targetSeat: Seat, learnedRole: string): void {
    const actionResult = this._requireNightActionResult();
    const targetVarId = findRavenkeeperTargetVariable(actionResult, targetSeat);
    if (targetVarId === undefined) {
      throw new Error(
        `No variable found for Ravenkeeper target: seat ${targetSeat}`,
      );
    }
    const roleVarId = findRavenkeeperRoleVariable(actionResult, learnedRole);
    if (roleVarId === undefined) {
      throw new Error(
        `No variable found for Ravenkeeper role: ${learnedRole}`,
      );
    }
    // Apply target first, then role
    this._applyRequire(targetVarId, `Ravenkeeper target: seat ${targetSeat}`);
    this._applyRequire(roleVarId, `Ravenkeeper role: ${learnedRole}`);
  }

  // -----------------------------------------------------------------------
  // Day observations
  // -----------------------------------------------------------------------

  /**
   * Record an execution during the day.
   */
  observeExecution(seat: Seat): DayResult {
    return this.game.recordDay(seat);
  }

  /**
   * Record that no execution occurred.
   */
  observeNoExecution(): DayResult {
    return this.game.recordDay(null);
  }

  /**
   * Observe a Slayer shot. Requires the matching Slayer shot variable.
   */
  observeSlayerShot(
    slayerSeat: Seat,
    targetSeat: Seat,
    targetDied: boolean,
  ): DayResult {
    const dayResult = this.game.recordDay(null, {
      slayerShot: { slayerSeat },
    });
    const varId = this.game.findSlayerShotVariable(targetSeat, targetDied);
    if (varId === undefined) {
      throw new Error(
        `No variable found for Slayer shot: target seat ${targetSeat}, died=${targetDied}`,
      );
    }
    this._applyRequire(varId, `Slayer shot: seat ${targetSeat} died=${targetDied}`);
    return dayResult;
  }

  // -----------------------------------------------------------------------
  // Query methods
  // -----------------------------------------------------------------------

  /**
   * Returns the current ZDD world count after all observations.
   */
  worldCount(): number {
    return this.game.countWorlds();
  }

  /**
   * Returns possible values for a role's info at a given night number,
   * along with how many worlds are consistent with each value.
   *
   * This is the key method for the UI — it shows "given what you've
   * observed so far, here are the remaining possibilities and how likely each is."
   */
  possibleValues(role: string, nightNumber: number): PossibleValueEntry[] {
    const results: PossibleValueEntry[] = [];
    const currentRoot = this.game.currentRoot;
    const zdd = this.game.zdd;

    if (nightNumber === 1) {
      const nightInfo = this._requireNightInfoResult();
      const range = nightInfo.roleVariableRanges.get(role);
      if (!range) return results;

      for (let varId = range.start; varId < range.start + range.count; varId++) {
        const required = zdd.require(currentRoot, varId);
        const count = zdd.count(required);
        if (count === 0) continue;

        // Determine the value type
        const pairOutput = nightInfo.pairOutputs.get(varId);
        if (pairOutput) {
          results.push({
            value: {
              seat1: pairOutput.playerA,
              seat2: pairOutput.playerB,
              role: pairOutput.namedRole,
            } as PairInfoValue,
            worldCount: count,
          });
          continue;
        }

        const countOutput = nightInfo.countOutputs.get(varId);
        if (countOutput) {
          results.push({
            value: { count: countOutput.count } as CountInfoValue,
            worldCount: count,
          });
          continue;
        }

        const ftOutput = nightInfo.fortuneTellerOutputs.get(varId);
        if (ftOutput) {
          results.push({
            value: {
              seat1: ftOutput.playerA,
              seat2: ftOutput.playerB,
              answer: ftOutput.answer,
            } as FortuneTellerValue,
            worldCount: count,
          });
          continue;
        }

        // Check if this is a Librarian "No Outsiders" variable
        const nightVar = nightInfo.variables.find((v) => v.id === varId);
        if (nightVar && nightVar.infoRole === "Librarian") {
          results.push({
            value: { noOutsiders: true } as LibrarianNoOutsidersValue,
            worldCount: count,
          });
        }
      }
    } else if (nightNumber === 2) {
      const actionResult = this._requireNightActionResult();

      // Empath N2
      if (role === "Empath") {
        for (const [varId, output] of actionResult.empathN2Outputs) {
          const required = zdd.require(currentRoot, varId);
          const count = zdd.count(required);
          if (count > 0) {
            results.push({
              value: { count: output.count } as CountInfoValue,
              worldCount: count,
            });
          }
        }
      }

      // Fortune Teller N2
      if (role === "Fortune Teller") {
        for (const [varId, output] of actionResult.fortuneTellerN2Outputs) {
          const required = zdd.require(currentRoot, varId);
          const count = zdd.count(required);
          if (count > 0) {
            results.push({
              value: {
                seat1: output.playerA,
                seat2: output.playerB,
                answer: output.answer,
              } as FortuneTellerValue,
              worldCount: count,
            });
          }
        }
      }

      // Undertaker
      if (role === "Undertaker") {
        for (const [varId, output] of actionResult.undertakerOutputs) {
          const required = zdd.require(currentRoot, varId);
          const count = zdd.count(required);
          if (count > 0) {
            results.push({
              value: { role: output.roleName } as UndertakerValue,
              worldCount: count,
            });
          }
        }
      }

      // Ravenkeeper
      if (role === "Ravenkeeper") {
        // For Ravenkeeper, combine target + role into compound values
        for (const [targetVarId, targetOutput] of actionResult.ravenkeeperTargetOutputs) {
          const afterTarget = zdd.require(currentRoot, targetVarId);
          if (zdd.count(afterTarget) === 0) continue;

          for (const [roleVarId, roleOutput] of actionResult.ravenkeeperRoleOutputs) {
            const afterBoth = zdd.require(afterTarget, roleVarId);
            const count = zdd.count(afterBoth);
            if (count > 0) {
              results.push({
                value: {
                  targetSeat: targetOutput.targetSeat,
                  learnedRole: roleOutput.roleName,
                } as RavenkeeperValue,
                worldCount: count,
              });
            }
          }
        }
      }
    }

    return results;
  }

  /**
   * Undo the most recent observation.
   * Returns true if an observation was undone, false if the undo stack is empty.
   */
  undo(): boolean {
    const entry = this._undoStack.pop();
    if (!entry) return false;

    // Restore the previous root on the current phase
    const phase = this.game.currentPhase;
    if (phase) {
      // Access the private root via the Game's applyObservation mechanism
      // We need to directly set the phase root. Since Game doesn't expose
      // a setter, we'll use a workaround by accessing the phase snapshot.
      (phase as { root: NodeId }).root = entry.previousRoot;
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private _requireNightInfoResult(): NightInfoResult {
    const result = this.game.nightInfoResult;
    if (!result) {
      throw new Error("No night info result (build night info first)");
    }
    return result;
  }

  private _requireNightActionResult(): NightActionResult {
    const result = this.game.nightActionResult;
    if (!result) {
      throw new Error("No night action result (build night action first)");
    }
    return result;
  }

  /**
   * Apply a require observation, with rollback if it would result in zero worlds.
   */
  private _applyRequire(varId: number, description: string): void {
    const previousRoot = this.game.currentRoot;

    this.game.applyObservation({ kind: "require-variable", variable: varId });

    if (this.game.currentRoot === BOTTOM) {
      // Roll back: restore the previous root
      const phase = this.game.currentPhase;
      if (phase) {
        (phase as { root: NodeId }).root = previousRoot;
      }
      throw new Error(
        `Inconsistent observation: "${description}" would reduce world count to zero`,
      );
    }

    this._undoStack.push({ previousRoot, description });
  }
}
