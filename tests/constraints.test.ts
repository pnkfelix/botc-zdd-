import { describe, it, expect } from "vitest";
import { ZDD } from "../src/zdd.js";
import { buildSeatAssignmentZDD } from "../src/seats.js";
import { applyObservation, applyObservations, executeQuery } from "../src/constraints.js";
import { seatRoleVar, type Observation } from "../src/types.js";

describe("applyObservation", () => {
  describe("seat-has-role", () => {
    it("requiring seat 0 = role 0 narrows a 3-player game to 2! = 2 worlds", () => {
      const zdd = new ZDD();
      const N = 3;
      const root = buildSeatAssignmentZDD(zdd, N);
      expect(zdd.count(root)).toBe(6);

      const narrowed = applyObservation(
        zdd,
        root,
        { kind: "seat-has-role", seat: 0, roleIndex: 0 },
        N,
      );
      // Fixing seat 0 to role 0 leaves (N-1)! = 2 permutations
      expect(zdd.count(narrowed)).toBe(2);
    });

    it("all surviving worlds have the required seat-role pair", () => {
      const zdd = new ZDD();
      const N = 4;
      const root = buildSeatAssignmentZDD(zdd, N);

      const narrowed = applyObservation(
        zdd,
        root,
        { kind: "seat-has-role", seat: 1, roleIndex: 2 },
        N,
      );

      const sets = zdd.enumerate(narrowed);
      const requiredVar = seatRoleVar(1, 2, N);
      for (const s of sets) {
        expect(s).toContain(requiredVar);
      }
      // Should be (N-1)! = 6
      expect(sets.length).toBe(6);
    });

    it("requiring an impossible assignment yields BOTTOM", () => {
      const zdd = new ZDD();
      const N = 3;
      const root = buildSeatAssignmentZDD(zdd, N);

      // Fix seat 0 to role 0
      let narrowed = applyObservation(
        zdd,
        root,
        { kind: "seat-has-role", seat: 0, roleIndex: 0 },
        N,
      );
      // Then try to also fix seat 0 to role 1 — impossible
      narrowed = applyObservation(
        zdd,
        narrowed,
        { kind: "seat-has-role", seat: 0, roleIndex: 1 },
        N,
      );
      expect(zdd.count(narrowed)).toBe(0);
    });
  });

  describe("seat-not-role", () => {
    it("excluding seat 0 = role 0 removes 1/N of the worlds", () => {
      const zdd = new ZDD();
      const N = 3;
      const root = buildSeatAssignmentZDD(zdd, N);

      const narrowed = applyObservation(
        zdd,
        root,
        { kind: "seat-not-role", seat: 0, roleIndex: 0 },
        N,
      );
      // N! - (N-1)! = 6 - 2 = 4
      expect(zdd.count(narrowed)).toBe(4);
    });

    it("no surviving world has the excluded pair", () => {
      const zdd = new ZDD();
      const N = 3;
      const root = buildSeatAssignmentZDD(zdd, N);

      const narrowed = applyObservation(
        zdd,
        root,
        { kind: "seat-not-role", seat: 0, roleIndex: 0 },
        N,
      );

      const excludedVar = seatRoleVar(0, 0, N);
      const sets = zdd.enumerate(narrowed);
      for (const s of sets) {
        expect(s).not.toContain(excludedVar);
      }
    });
  });

  describe("multiple observations", () => {
    it("fixing all seats yields exactly 1 world", () => {
      const zdd = new ZDD();
      const N = 4;
      const root = buildSeatAssignmentZDD(zdd, N);

      const observations: Observation[] = [
        { kind: "seat-has-role", seat: 0, roleIndex: 3 },
        { kind: "seat-has-role", seat: 1, roleIndex: 0 },
        { kind: "seat-has-role", seat: 2, roleIndex: 1 },
        // seat 3 must be role 2 by elimination
      ];

      const narrowed = applyObservations(zdd, root, observations, N);
      expect(zdd.count(narrowed)).toBe(1);
    });

    it("contradictory observations yield BOTTOM", () => {
      const zdd = new ZDD();
      const N = 3;
      const root = buildSeatAssignmentZDD(zdd, N);

      // Two different seats claim the same role
      const observations: Observation[] = [
        { kind: "seat-has-role", seat: 0, roleIndex: 0 },
        { kind: "seat-has-role", seat: 1, roleIndex: 0 }, // conflict!
      ];

      const narrowed = applyObservations(zdd, root, observations, N);
      expect(zdd.count(narrowed)).toBe(0);
    });
  });
});

describe("executeQuery", () => {
  it("count-worlds returns the total count", () => {
    const zdd = new ZDD();
    const N = 3;
    const root = buildSeatAssignmentZDD(zdd, N);

    const result = executeQuery(zdd, root, { kind: "count-worlds" }, N);
    expect(result).toEqual({ kind: "count", value: 6 });
  });

  it("count-with-seat-role returns correct fraction", () => {
    const zdd = new ZDD();
    const N = 3;
    const root = buildSeatAssignmentZDD(zdd, N);

    // In N! permutations, each seat-role pair appears (N-1)! times
    const result = executeQuery(
      zdd,
      root,
      { kind: "count-with-seat-role", seat: 0, roleIndex: 1 },
      N,
    );
    expect(result).toEqual({ kind: "count", value: 2 }); // (3-1)! = 2
  });

  it("seat-probabilities are uniform for unconstrained permutations", () => {
    const zdd = new ZDD();
    const N = 3;
    const root = buildSeatAssignmentZDD(zdd, N);

    const result = executeQuery(
      zdd,
      root,
      { kind: "seat-probabilities", seat: 0 },
      N,
    );
    expect(result.kind).toBe("probabilities");
    if (result.kind === "probabilities") {
      // Each of N roles equally likely: probability 1/N
      expect(result.values.size).toBe(N);
      for (const [, prob] of result.values) {
        expect(prob).toBeCloseTo(1 / N, 10);
      }
    }
  });

  it("seat-probabilities update after observation", () => {
    const zdd = new ZDD();
    const N = 3;
    let root = buildSeatAssignmentZDD(zdd, N);

    // Exclude role 0 from seat 0
    root = applyObservation(
      zdd,
      root,
      { kind: "seat-not-role", seat: 0, roleIndex: 0 },
      N,
    );

    const result = executeQuery(
      zdd,
      root,
      { kind: "seat-probabilities", seat: 0 },
      N,
    );
    if (result.kind === "probabilities") {
      expect(result.values.has(0)).toBe(false); // role 0 eliminated
      expect(result.values.size).toBe(2); // roles 1 and 2 remain
      for (const [, prob] of result.values) {
        expect(prob).toBeCloseTo(0.5, 10);
      }
    }
  });
});
