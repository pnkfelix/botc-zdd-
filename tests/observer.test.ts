import { describe, it, expect } from "vitest";
import { TROUBLE_BREWING } from "../src/botc.js";
import { Game } from "../src/game.js";
import {
  GameObserver,
  type PairInfoValue,
  type CountInfoValue,
} from "../src/observer.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSeatRoles(...roles: string[]): Map<number, string> {
  const map = new Map<number, string>();
  for (let i = 0; i < roles.length; i++) {
    map.set(i, roles[i]);
  }
  return map;
}

/**
 * Build a Game + GameObserver through Night 1 info for the given roles.
 * Uses the standard buildDistribution → enumerate → match → buildSeatAssignment
 * → buildNightInfo pipeline.
 */
function buildThroughNight1(
  ...roles: string[]
): { observer: GameObserver; seatRoles: Map<number, string> } {
  const game = new Game(TROUBLE_BREWING, roles.length);
  game.buildDistribution();

  const dists = game.zdd.enumerate(game.currentRoot);
  const targetRoleSet = new Set(roles);
  const roleNames = TROUBLE_BREWING.roles.map((r) => r.name);

  let matchedDist: number[] | undefined;
  for (const dist of dists) {
    const distRoles = dist.map((v) => roleNames[v]);
    if (
      distRoles.length === roles.length &&
      distRoles.every((r) => targetRoleSet.has(r)) &&
      roles.every((r) => distRoles.includes(r))
    ) {
      matchedDist = dist;
      break;
    }
  }

  if (!matchedDist) {
    throw new Error(`Could not find distribution matching: ${roles.join(", ")}`);
  }

  game.buildSeatAssignment(matchedDist);
  const seatRoles = makeSeatRoles(...roles);
  game.buildNightInfo(seatRoles);

  return { observer: new GameObserver(game), seatRoles };
}

// ============================================================================
// Tests
// ============================================================================

describe("GameObserver", () => {
  describe("possibleValues", () => {
    it("Chef possibleValues returns all valid counts summing to total", () => {
      // 5 players: Washerwoman, Chef, Empath, Poisoner, Imp
      const { observer } = buildThroughNight1(
        "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
      );

      const totalBefore = observer.worldCount();
      expect(totalBefore).toBeGreaterThan(0);

      const chefValues = observer.possibleValues("Chef", 1);
      expect(chefValues.length).toBeGreaterThan(0);

      // Every entry should have a count value
      for (const entry of chefValues) {
        expect((entry.value as CountInfoValue).count).toBeDefined();
        expect(entry.worldCount).toBeGreaterThan(0);
      }

      // World counts across all possible Chef values should sum to total
      const sum = chefValues.reduce((acc, v) => acc + v.worldCount, 0);
      expect(sum).toBe(totalBefore);
    });

    it("Washerwoman possibleValues returns pair info values", () => {
      const { observer } = buildThroughNight1(
        "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
      );

      const wwValues = observer.possibleValues("Washerwoman", 1);
      expect(wwValues.length).toBeGreaterThan(0);

      for (const entry of wwValues) {
        const v = entry.value as PairInfoValue;
        expect(v.seat1).toBeDefined();
        expect(v.seat2).toBeDefined();
        expect(v.role).toBeDefined();
        expect(entry.worldCount).toBeGreaterThan(0);
      }
    });
  });

  describe("observePairInfo", () => {
    it("WW observation reduces world count", () => {
      const { observer } = buildThroughNight1(
        "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
      );

      const before = observer.worldCount();

      // Washerwoman shown seats 1 and 2, told one is Chef
      observer.observePairInfo("Washerwoman", 1, 2, "Chef");

      const after = observer.worldCount();
      expect(after).toBeLessThan(before);
      expect(after).toBeGreaterThan(0);
    });
  });

  describe("observeCountInfo", () => {
    it("Empath possibleValues shift after Chef observation", () => {
      const { observer } = buildThroughNight1(
        "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
      );

      const empathBefore = observer.possibleValues("Empath", 1);

      // Apply Chef observation: count = 1
      observer.observeCountInfo("Chef", 1);

      const empathAfter = observer.possibleValues("Empath", 1);

      // After Chef observation, the Empath possibilities may shift
      // (some count values may have different world counts or disappear)
      const beforeTotal = empathBefore.reduce((a, v) => a + v.worldCount, 0);
      const afterTotal = empathAfter.reduce((a, v) => a + v.worldCount, 0);
      expect(afterTotal).toBeLessThanOrEqual(beforeTotal);
      expect(afterTotal).toBeGreaterThan(0);
    });
  });

  describe("conflicting observations", () => {
    it("second conflicting observation throws without modifying state", () => {
      const { observer } = buildThroughNight1(
        "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
      );

      // Observe Chef count = 1
      observer.observeCountInfo("Chef", 1);
      const afterFirst = observer.worldCount();
      expect(afterFirst).toBeGreaterThan(0);

      // Try to observe a conflicting Chef count (should throw)
      expect(() => observer.observeCountInfo("Chef", 0)).toThrow(
        /inconsistent/i,
      );

      // World count should be unchanged
      expect(observer.worldCount()).toBe(afterFirst);
    });
  });

  describe("undo", () => {
    it("undoing an observation restores previous world count", () => {
      const { observer } = buildThroughNight1(
        "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
      );

      const before = observer.worldCount();

      observer.observePairInfo("Washerwoman", 1, 2, "Chef");
      const afterObs = observer.worldCount();
      expect(afterObs).toBeLessThan(before);

      const undone = observer.undo();
      expect(undone).toBe(true);
      expect(observer.worldCount()).toBe(before);
    });

    it("undo returns false when stack is empty", () => {
      const { observer } = buildThroughNight1(
        "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
      );
      expect(observer.undo()).toBe(false);
    });
  });

  describe("full pipeline", () => {
    it("Night 1 info → Day execution → Night 2 action → observe death → verify world counts", () => {
      // 5 players: Washerwoman, Chef, Empath, Poisoner, Imp
      const roles = ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"];
      const game = new Game(TROUBLE_BREWING, 5);
      game.buildDistribution();

      const dists = game.zdd.enumerate(game.currentRoot);
      const roleNames = TROUBLE_BREWING.roles.map((r) => r.name);
      const targetRoleSet = new Set(roles);

      let matchedDist: number[] | undefined;
      for (const dist of dists) {
        const distRoles = dist.map((v) => roleNames[v]);
        if (
          distRoles.length === roles.length &&
          distRoles.every((r) => targetRoleSet.has(r)) &&
          roles.every((r) => distRoles.includes(r))
        ) {
          matchedDist = dist;
          break;
        }
      }

      game.buildSeatAssignment(matchedDist!);
      const seatRoles = makeSeatRoles(...roles);
      game.buildNightInfo(seatRoles);

      const observer = new GameObserver(game);

      // Observe Night 1 info
      const n1Count = observer.worldCount();
      expect(n1Count).toBeGreaterThan(0);

      // Observe WW: shown seats 1 and 2, told one is Chef
      observer.observePairInfo("Washerwoman", 1, 2, "Chef");
      const afterWW = observer.worldCount();
      expect(afterWW).toBeLessThan(n1Count);

      // Observe Chef count
      observer.observeCountInfo("Chef", 1);
      const afterChef = observer.worldCount();
      expect(afterChef).toBeLessThanOrEqual(afterWW);
      expect(afterChef).toBeGreaterThan(0);

      // Day: execute seat 1 (Chef)
      observer.observeExecution(1);

      // Night 2 action
      game.buildNightAction(seatRoles);

      // Observe night death (Imp kills someone — say seat 2)
      observer.observeNightDeath(2);

      // Verify the world count is still positive
      const afterN2 = observer.worldCount();
      expect(afterN2).toBeGreaterThan(0);
    });
  });

  describe("observeExecution / observeNoExecution", () => {
    it("observeExecution calls recordDay internally", () => {
      const { observer } = buildThroughNight1(
        "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
      );

      const result = observer.observeExecution(1);
      expect(result.executedSeat).toBe(1);
      expect(result.executedRole).toBe("Chef");
    });

    it("observeNoExecution calls recordDay(null)", () => {
      const { observer } = buildThroughNight1(
        "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
      );

      const result = observer.observeNoExecution();
      expect(result.executedSeat).toBeNull();
    });
  });

  describe("Night 2 observations", () => {
    function buildThroughNight2(
      ...roles: string[]
    ): { observer: GameObserver; seatRoles: Map<number, string> } {
      const { observer, seatRoles } = buildThroughNight1(...roles);

      // Day 1: execute seat 1
      observer.observeExecution(1);

      // Build Night 2 action
      observer.game.buildNightAction(seatRoles);

      return { observer, seatRoles };
    }

    it("observeEmpathN2 narrows worlds", () => {
      // Empath at seat 2, evil neighbors at seats 1(dead-Chef) and 3(Poisoner)
      const { observer } = buildThroughNight2(
        "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
      );

      const before = observer.worldCount();
      const empathValues = observer.possibleValues("Empath", 2);

      // If there are multiple possible counts, picking one should narrow
      if (empathValues.length > 1) {
        const count = (empathValues[0].value as CountInfoValue).count;
        observer.observeEmpathN2(count);
        expect(observer.worldCount()).toBeLessThan(before);
      }
    });
  });
});
