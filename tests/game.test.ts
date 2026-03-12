import { describe, it, expect } from "vitest";
import { TROUBLE_BREWING } from "../src/botc.js";
import { Game } from "../src/game.js";
import { PhaseType } from "../src/types.js";

describe("Game", () => {
  describe("Phase 1: Distribution", () => {
    it("builds a distribution phase", () => {
      const game = new Game(TROUBLE_BREWING, 5);
      game.buildDistribution();

      expect(game.phaseCount).toBe(1);
      expect(game.currentPhase!.info.type).toBe(PhaseType.Distribution);
      expect(game.countWorlds()).toBe(858);
    });

    it("builds distribution with Baron modifier", () => {
      const game = new Game(TROUBLE_BREWING, 5);
      game.buildDistribution(true);
      expect(game.countWorlds()).toBe(1170);
    });
  });

  describe("Phase 2: Seat Assignment", () => {
    it("builds seat assignment from a selected distribution", () => {
      const game = new Game(TROUBLE_BREWING, 5);
      game.buildDistribution();

      // Pick the first enumerated distribution
      const distributions = game.zdd.enumerate(game.currentRoot);
      const firstDist = distributions[0];
      expect(firstDist.length).toBe(5);

      game.buildSeatAssignment(firstDist);
      expect(game.phaseCount).toBe(2);
      expect(game.currentPhase!.info.type).toBe(PhaseType.SeatAssignment);
      // 5 roles into 5 seats = 5! = 120 permutations
      expect(game.countWorlds()).toBe(120);
    });

    it("throws if role count doesn't match player count", () => {
      const game = new Game(TROUBLE_BREWING, 5);
      game.buildDistribution();

      expect(() => game.buildSeatAssignment([0, 1, 2])).toThrow(
        "Expected 5 roles, got 3",
      );
    });

    it("tracks selected roles", () => {
      const game = new Game(TROUBLE_BREWING, 5);
      game.buildDistribution();

      const dists = game.zdd.enumerate(game.currentRoot);
      game.buildSeatAssignment(dists[0]);

      const roles = game.selectedRoles;
      expect(roles).toBeDefined();
      expect(roles!.length).toBe(5);
      // Every role should be a valid TB role name
      for (const name of roles!) {
        expect(TROUBLE_BREWING.roles.some((r) => r.name === name)).toBe(true);
      }
    });
  });

  describe("Observations on seat assignment", () => {
    function gameWithSeatAssignment(): Game {
      const game = new Game(TROUBLE_BREWING, 5);
      game.buildDistribution();
      const dists = game.zdd.enumerate(game.currentRoot);
      game.buildSeatAssignment(dists[0]);
      return game;
    }

    it("applying seat-has-role narrows worlds", () => {
      const game = gameWithSeatAssignment();
      expect(game.countWorlds()).toBe(120);

      game.applyObservation({
        kind: "seat-has-role",
        seat: 0,
        roleIndex: 0,
      });
      // Fixing one seat: (5-1)! = 24
      expect(game.countWorlds()).toBe(24);
    });

    it("applying seat-not-role narrows worlds", () => {
      const game = gameWithSeatAssignment();

      game.applyObservation({
        kind: "seat-not-role",
        seat: 0,
        roleIndex: 0,
      });
      // 5! - 4! = 120 - 24 = 96
      expect(game.countWorlds()).toBe(96);
    });

    it("query seat probabilities after constraining", () => {
      const game = gameWithSeatAssignment();

      // Fix seat 0 to role 0
      game.applyObservation({
        kind: "seat-has-role",
        seat: 0,
        roleIndex: 0,
      });

      // Seat 0 should have 100% probability for role 0
      const probs = game.seatProbabilities(0);
      expect(probs.get(0)).toBeCloseTo(1.0);
      expect(probs.size).toBe(1);

      // Seat 1 should have uniform distribution over remaining 4 roles
      const probs1 = game.seatProbabilities(1);
      expect(probs1.size).toBe(4);
      for (const [, prob] of probs1) {
        expect(prob).toBeCloseTo(0.25);
      }
    });

    it("countWithSeatRole returns correct count", () => {
      const game = gameWithSeatAssignment();

      // Each seat-role pair appears in (N-1)! = 24 of 120 worlds
      expect(game.countWithSeatRole(0, 0)).toBe(24);
      expect(game.countWithSeatRole(2, 3)).toBe(24);
    });
  });

  describe("Undo", () => {
    it("undo removes the last phase", () => {
      const game = new Game(TROUBLE_BREWING, 5);
      game.buildDistribution();
      const dists = game.zdd.enumerate(game.currentRoot);
      game.buildSeatAssignment(dists[0]);

      expect(game.phaseCount).toBe(2);

      const popped = game.undo();
      expect(popped).toBeDefined();
      expect(popped!.type).toBe(PhaseType.SeatAssignment);
      expect(game.phaseCount).toBe(1);
      expect(game.currentPhase!.info.type).toBe(PhaseType.Distribution);
      expect(game.countWorlds()).toBe(858);
    });

    it("undo on empty game returns undefined", () => {
      const game = new Game(TROUBLE_BREWING, 5);
      expect(game.undo()).toBeUndefined();
    });

    it("can rebuild seat assignment after undo with different distribution", () => {
      const game = new Game(TROUBLE_BREWING, 5);
      game.buildDistribution();

      const dists = game.zdd.enumerate(game.currentRoot);
      game.buildSeatAssignment(dists[0]);
      expect(game.countWorlds()).toBe(120);

      // Undo and try a different distribution
      game.undo();
      game.buildSeatAssignment(dists[1]);
      expect(game.countWorlds()).toBe(120); // still 5! permutations
      // But the selected roles should differ
    });
  });

  describe("end-to-end: distribution → seat assignment → constrain", () => {
    it("5-player TB: full pipeline", () => {
      const game = new Game(TROUBLE_BREWING, 5);

      // Phase 1: build distribution
      game.buildDistribution();
      expect(game.countWorlds()).toBe(858);

      // Pick a distribution that includes the Imp (demon)
      const dists = game.zdd.enumerate(game.currentRoot);
      const impIdx = TROUBLE_BREWING.roles.findIndex(
        (r) => r.name === "Imp",
      );
      // All distributions should include the Imp (only 1 demon in TB)
      for (const d of dists) {
        expect(d).toContain(impIdx);
      }

      // Phase 2: assign roles to seats
      const chosenDist = dists[0];
      game.buildSeatAssignment(chosenDist);
      expect(game.countWorlds()).toBe(120);

      // The Imp role is at some index in the selected set.
      // Find which selected-role-index corresponds to the Imp.
      const selectedRoles = game.selectedRoles!;
      const impLocalIdx = selectedRoles.indexOf("Imp");
      expect(impLocalIdx).toBeGreaterThanOrEqual(0);

      // Apply: "seat 3 is the Imp"
      game.applyObservation({
        kind: "seat-has-role",
        seat: 3,
        roleIndex: impLocalIdx,
      });
      // 4! = 24 remaining
      expect(game.countWorlds()).toBe(24);

      // Query: all remaining worlds have Imp in seat 3
      const probs = game.seatProbabilities(3);
      expect(probs.get(impLocalIdx)).toBeCloseTo(1.0);
      expect(probs.size).toBe(1);

      // Fix another seat to further narrow.
      // Pick a role index that isn't the Imp.
      const nonImpIdx = impLocalIdx === 0 ? 1 : 0;
      game.applyObservation({
        kind: "seat-has-role",
        seat: 0,
        roleIndex: nonImpIdx,
      });
      // Two seats fixed out of 5: remaining = 3! = 6
      expect(game.countWorlds()).toBe(6);
    });
  });
});
