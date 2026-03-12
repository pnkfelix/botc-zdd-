import { describe, it, expect } from "vitest";
import { ZDD } from "../src/zdd.js";
import { buildSeatAssignmentZDD, resolveSeatAssignment } from "../src/seats.js";
import { seatRoleVar, decodeSeatRoleVar } from "../src/types.js";

describe("seatRoleVar encoding", () => {
  it("encodes seat 0, role 0 as 0", () => {
    expect(seatRoleVar(0, 0, 5)).toBe(0);
  });

  it("encodes seat 1, role 0 as N", () => {
    expect(seatRoleVar(1, 0, 5)).toBe(5);
  });

  it("encodes seat 2, role 3 correctly", () => {
    expect(seatRoleVar(2, 3, 5)).toBe(13); // 2*5 + 3
  });

  it("round-trips through decode", () => {
    for (let s = 0; s < 5; s++) {
      for (let r = 0; r < 5; r++) {
        const v = seatRoleVar(s, r, 5);
        const decoded = decodeSeatRoleVar(v, 5);
        expect(decoded.seat).toBe(s);
        expect(decoded.roleIndex).toBe(r);
      }
    }
  });
});

describe("buildSeatAssignmentZDD", () => {
  it("1 player: 1 permutation (trivial)", () => {
    const zdd = new ZDD();
    const root = buildSeatAssignmentZDD(zdd, 1);
    expect(zdd.count(root)).toBe(1);
  });

  it("2 players: 2! = 2 permutations", () => {
    const zdd = new ZDD();
    const root = buildSeatAssignmentZDD(zdd, 2);
    expect(zdd.count(root)).toBe(2);

    const sets = zdd.enumerate(root);
    expect(sets.length).toBe(2);
    // Each set should have exactly 2 variables (one per seat)
    for (const s of sets) {
      expect(s.length).toBe(2);
    }
  });

  it("3 players: 3! = 6 permutations", () => {
    const zdd = new ZDD();
    const root = buildSeatAssignmentZDD(zdd, 3);
    expect(zdd.count(root)).toBe(6);
  });

  it("4 players: 4! = 24 permutations", () => {
    const zdd = new ZDD();
    const root = buildSeatAssignmentZDD(zdd, 4);
    expect(zdd.count(root)).toBe(24);
  });

  it("5 players: 5! = 120 permutations", () => {
    const zdd = new ZDD();
    const root = buildSeatAssignmentZDD(zdd, 5);
    expect(zdd.count(root)).toBe(120);
  });

  it("7 players: 7! = 5040 permutations", () => {
    const zdd = new ZDD();
    const root = buildSeatAssignmentZDD(zdd, 7);
    expect(zdd.count(root)).toBe(5040);
  });

  it("every enumerated set has exactly N variables (one per seat)", () => {
    const zdd = new ZDD();
    const N = 4;
    const root = buildSeatAssignmentZDD(zdd, N);
    const sets = zdd.enumerate(root);
    for (const s of sets) {
      expect(s.length).toBe(N);
      // Check each seat is represented exactly once
      const seats = s.map((v) => Math.floor(v / N));
      const roles = s.map((v) => v % N);
      expect(new Set(seats).size).toBe(N);
      expect(new Set(roles).size).toBe(N);
    }
  });

  it("each permutation is a valid bijection", () => {
    const zdd = new ZDD();
    const N = 3;
    const root = buildSeatAssignmentZDD(zdd, N);
    const sets = zdd.enumerate(root);

    for (const s of sets) {
      const seatToRole = new Map<number, number>();
      const roleToSeat = new Map<number, number>();
      for (const v of s) {
        const seat = Math.floor(v / N);
        const role = v % N;
        // No seat assigned twice
        expect(seatToRole.has(seat)).toBe(false);
        // No role assigned twice
        expect(roleToSeat.has(role)).toBe(false);
        seatToRole.set(seat, role);
        roleToSeat.set(role, seat);
      }
      expect(seatToRole.size).toBe(N);
    }
  });
});

describe("resolveSeatAssignment", () => {
  it("maps variables to seat -> role name", () => {
    const roleNames = ["Chef", "Imp", "Poisoner"];
    // Assignment: seat 0 -> role 1 (Imp), seat 1 -> role 2 (Poisoner), seat 2 -> role 0 (Chef)
    const variables = [
      seatRoleVar(0, 1, 3), // seat 0 = Imp
      seatRoleVar(1, 2, 3), // seat 1 = Poisoner
      seatRoleVar(2, 0, 3), // seat 2 = Chef
    ];
    const result = resolveSeatAssignment(variables, 3, roleNames);
    expect(result.get(0)).toBe("Imp");
    expect(result.get(1)).toBe("Poisoner");
    expect(result.get(2)).toBe("Chef");
  });
});
