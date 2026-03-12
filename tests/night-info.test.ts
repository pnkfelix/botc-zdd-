import { describe, it, expect } from "vitest";
import { ZDD, BOTTOM } from "../src/zdd.js";
import { TROUBLE_BREWING, RoleType } from "../src/botc.js";
import { resolveSeatAssignment } from "../src/seats.js";
import { Game } from "../src/game.js";
import { PhaseType, seatRoleVar } from "../src/types.js";
import {
  buildNightInfoZDD,
  findPairInfoVariable,
  findCountInfoVariable,
  findPoisonerTargetVariable,
  findRedHerringVariable,
  findFortuneTellerVariable,
  type NightInfoConfig,
} from "../src/night.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a concrete seat assignment map from an array of role names. */
function makeSeatRoles(...roles: string[]): Map<number, string> {
  const map = new Map<number, string>();
  for (let i = 0; i < roles.length; i++) {
    map.set(i, roles[i]);
  }
  return map;
}

/** Create a NightInfoConfig for Trouble Brewing. */
function makeConfig(
  seatRoles: Map<number, string>,
  opts?: { selectedRoles?: string[]; malfunctioningSeats?: Set<number> },
): NightInfoConfig {
  const roles = opts?.selectedRoles ?? [...seatRoles.values()];
  return {
    numPlayers: seatRoles.size,
    seatRoles,
    selectedRoles: roles,
    script: TROUBLE_BREWING,
    malfunctioningSeats: opts?.malfunctioningSeats,
  };
}

// ============================================================================
// No-Poisoner tests (using Scarlet Woman as the minion to avoid triggering poisoner logic)
// ============================================================================

describe("buildNightInfoZDD (no Poisoner)", () => {
  describe("Washerwoman", () => {
    it("enumerates valid ST choices for a 5-player game", () => {
      // Seats: 0=Washerwoman, 1=Chef, 2=Empath, 3=SW, 4=Imp
      const seatRoles = makeSeatRoles(
        "Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      // Washerwoman sees other Townsfolk: Chef (seat 1), Empath (seat 2)
      // For Chef at seat 1: decoys = seats 2, 3, 4 → 3 pairs
      // For Empath at seat 2: decoys = seats 1, 3, 4 → 3 pairs
      // Total Washerwoman choices = 6
      // Chef count = 1 (seats 3,4 both evil and adjacent) → 1 choice
      // Empath count = 1 (seat 1=Chef=good, seat 3=SW=evil) → 1 choice
      // Total worlds = 6 × 1 × 1 = 6
      expect(zdd.count(result.root)).toBe(6);
    });

    it("handles Washerwoman with only one other Townsfolk", () => {
      // Seats: 0=Washerwoman, 1=Soldier, 2=Butler, 3=SW, 4=Imp
      const seatRoles = makeSeatRoles(
        "Washerwoman", "Soldier", "Butler", "Scarlet Woman", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      const wwRange = result.roleVariableRanges.get("Washerwoman");
      expect(wwRange).toBeDefined();

      // Only Townsfolk target: Soldier (seat 1). Decoys: 2, 3, 4 → 3 pairs
      expect(zdd.count(result.root)).toBe(3);
    });

    it("generates correct pair outputs", () => {
      const seatRoles = makeSeatRoles(
        "Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      const wwRange = result.roleVariableRanges.get("Washerwoman")!;
      const wwPairs: Array<{ playerA: number; playerB: number; namedRole: string }> = [];
      for (let vid = wwRange.start; vid < wwRange.start + wwRange.count; vid++) {
        const output = result.pairOutputs.get(vid);
        if (output) wwPairs.push(output);
      }

      expect(wwPairs.length).toBe(6);

      const chefOutputs = wwPairs.filter((p) => p.namedRole === "Chef");
      const empathOutputs = wwPairs.filter((p) => p.namedRole === "Empath");
      expect(chefOutputs.length).toBe(3);
      expect(empathOutputs.length).toBe(3);

      for (const o of chefOutputs) {
        expect(o.playerA === 1 || o.playerB === 1).toBe(true);
      }
      for (const o of empathOutputs) {
        expect(o.playerA === 2 || o.playerB === 2).toBe(true);
      }

      // No output should include seat 0 (the Washerwoman herself)
      for (const o of wwPairs) {
        expect(o.playerA).not.toBe(0);
        expect(o.playerB).not.toBe(0);
      }
    });
  });

  describe("Librarian", () => {
    it("returns 'no outsiders' when no outsiders are in play", () => {
      const seatRoles = makeSeatRoles(
        "Librarian", "Chef", "Empath", "Scarlet Woman", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      const libRange = result.roleVariableRanges.get("Librarian");
      expect(libRange).toBeDefined();
      expect(libRange!.count).toBe(1);

      const libVar = result.variables.find((v) => v.infoRole === "Librarian");
      expect(libVar).toBeDefined();
      expect(libVar!.description).toBe("No Outsiders in play");
    });

    it("enumerates outsider targets when outsiders are in play", () => {
      const seatRoles = makeSeatRoles(
        "Librarian", "Chef", "Empath", "Butler", "Scarlet Woman", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      const libRange = result.roleVariableRanges.get("Librarian");
      expect(libRange).toBeDefined();

      // Outsider: Butler at seat 3. Decoys: seats 1, 2, 4, 5 → 4 pairs
      const libPairs = [];
      for (let vid = libRange!.start; vid < libRange!.start + libRange!.count; vid++) {
        const output = result.pairOutputs.get(vid);
        if (output) libPairs.push(output);
      }
      expect(libPairs.length).toBe(4);
      for (const p of libPairs) {
        expect(p.namedRole).toBe("Butler");
      }
    });
  });

  describe("Investigator", () => {
    it("enumerates minion targets", () => {
      // Seats: 0=Investigator, 1=Chef, 2=Empath, 3=SW, 4=Imp
      const seatRoles = makeSeatRoles(
        "Investigator", "Chef", "Empath", "Scarlet Woman", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      const invRange = result.roleVariableRanges.get("Investigator");
      expect(invRange).toBeDefined();

      // Minion: SW at seat 3. Decoys: 1, 2, 4 → 3 pairs
      const invPairs = [];
      for (let vid = invRange!.start; vid < invRange!.start + invRange!.count; vid++) {
        const output = result.pairOutputs.get(vid);
        if (output) invPairs.push(output);
      }
      expect(invPairs.length).toBe(3);
      for (const p of invPairs) {
        expect(p.namedRole).toBe("Scarlet Woman");
        expect(p.playerA === 3 || p.playerB === 3).toBe(true);
      }
    });
  });

  describe("Chef", () => {
    it("counts adjacent evil pairs correctly", () => {
      // Circle: 0=WW, 1=Chef, 2=Empath, 3=SW, 4=Imp
      // Evil: SW(3), Imp(4). Adjacent: (3,4) → count = 1
      const seatRoles = makeSeatRoles(
        "Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      const chefCountVar = findCountInfoVariable(result, "Chef", 1);
      expect(chefCountVar).toBeDefined();

      const constrained = zdd.require(result.root, chefCountVar!);
      expect(zdd.count(constrained)).toBeGreaterThan(0);

      // Wrong count (0) is NOT valid
      const wrongCountVar = findCountInfoVariable(result, "Chef", 0);
      expect(wrongCountVar).toBeDefined();
      const wrongConstrained = zdd.require(result.root, wrongCountVar!);
      expect(zdd.count(wrongConstrained)).toBe(0);
    });

    it("returns 0 when no evil players are adjacent", () => {
      // Circle: 0=WW, 1=SW, 2=Chef, 3=Imp, 4=Empath
      // Evil: SW(1), Imp(3). Not adjacent → count = 0
      const seatRoles = makeSeatRoles(
        "Washerwoman", "Scarlet Woman", "Chef", "Imp", "Empath",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      const count0Var = findCountInfoVariable(result, "Chef", 0);
      expect(count0Var).toBeDefined();
      expect(zdd.count(zdd.require(result.root, count0Var!))).toBeGreaterThan(0);

      const count1Var = findCountInfoVariable(result, "Chef", 1);
      expect(zdd.count(zdd.require(result.root, count1Var!))).toBe(0);
    });

    it("counts multiple adjacent evil pairs", () => {
      // 7-player: 0=WW, 1=Chef, 2=Baron, 3=Scarlet Woman, 4=Imp, 5=Empath, 6=Virgin
      // Evil: Baron(2), SW(3), Imp(4). Adjacent: (2,3) and (3,4) → count = 2
      const seatRoles = makeSeatRoles(
        "Washerwoman", "Chef", "Baron", "Scarlet Woman", "Imp", "Empath", "Virgin",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      const count2Var = findCountInfoVariable(result, "Chef", 2);
      expect(count2Var).toBeDefined();
      expect(zdd.count(zdd.require(result.root, count2Var!))).toBeGreaterThan(0);
    });
  });

  describe("Empath", () => {
    it("counts evil neighbors correctly (one evil neighbor)", () => {
      // Circle: 0=WW, 1=Chef, 2=Empath, 3=SW, 4=Imp
      // Empath at seat 2. Neighbors: seat 1 (Chef=good), seat 3 (Spy=evil) → 1
      const seatRoles = makeSeatRoles(
        "Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      const count1Var = findCountInfoVariable(result, "Empath", 1);
      expect(count1Var).toBeDefined();
      expect(zdd.count(zdd.require(result.root, count1Var!))).toBeGreaterThan(0);

      // Count 0 and 2 should not be valid
      const count0Var = findCountInfoVariable(result, "Empath", 0);
      expect(zdd.count(zdd.require(result.root, count0Var!))).toBe(0);
      const count2Var = findCountInfoVariable(result, "Empath", 2);
      expect(zdd.count(zdd.require(result.root, count2Var!))).toBe(0);
    });

    it("counts zero evil neighbors", () => {
      // Circle: 0=SW, 1=WW, 2=Empath, 3=Chef, 4=Imp
      const seatRoles = makeSeatRoles(
        "Scarlet Woman", "Washerwoman", "Empath", "Chef", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      const count0Var = findCountInfoVariable(result, "Empath", 0);
      expect(count0Var).toBeDefined();
      expect(zdd.count(zdd.require(result.root, count0Var!))).toBeGreaterThan(0);
    });

    it("counts two evil neighbors", () => {
      // Circle: 0=WW, 1=SW, 2=Empath, 3=Imp, 4=Chef
      const seatRoles = makeSeatRoles(
        "Washerwoman", "Scarlet Woman", "Empath", "Imp", "Chef",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      const count2Var = findCountInfoVariable(result, "Empath", 2);
      expect(count2Var).toBeDefined();
      expect(zdd.count(zdd.require(result.root, count2Var!))).toBeGreaterThan(0);
    });
  });

  describe("roles not in play", () => {
    it("skips info roles that are not in the seat assignment", () => {
      // No info roles at all, no Poisoner: Soldier, Virgin, Slayer, SW, Imp
      const seatRoles = makeSeatRoles(
        "Soldier", "Virgin", "Slayer", "Scarlet Woman", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      expect(result.variableCount).toBe(0);
      expect(result.roleVariableRanges.size).toBe(0);
      expect(zdd.count(result.root)).toBe(1);
    });
  });

  describe("combined world count", () => {
    it("cross-products independent info role choices", () => {
      // 7-player: WW(0), Librarian(1), Investigator(2), Chef(3), Empath(4), SW(5), Imp(6)
      const seatRoles = makeSeatRoles(
        "Washerwoman", "Librarian", "Investigator", "Chef", "Empath",
        "Scarlet Woman", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      // WW: 4 Townsfolk targets × 5 decoys each = 20
      // Librarian: no outsiders → 1
      // Investigator: SW(5), decoys 0,1,3,4,6 → 5 pairs
      // Chef: evil (5,6) adjacent → count=1 → 1
      // Empath: seat 4, neighbors 3(Chef=good), 5(SW=evil) → count=1 → 1
      // Total = 20 × 1 × 5 × 1 × 1 = 100
      expect(zdd.count(result.root)).toBe(100);
    });
  });
});

// ---------------------------------------------------------------------------
// Lookup helper tests (no Poisoner)
// ---------------------------------------------------------------------------

describe("findPairInfoVariable", () => {
  it("finds the correct variable for a valid output", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    const varId = findPairInfoVariable(result, "Washerwoman", 1, 3, "Chef");
    expect(varId).toBeDefined();

    const constrained = zdd.require(result.root, varId!);
    expect(zdd.count(constrained)).toBeGreaterThan(0);
  });

  it("returns undefined for an invalid output", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    // "Players 3 and 4 is the Chef" — neither is Chef → no variable
    const varId = findPairInfoVariable(result, "Washerwoman", 3, 4, "Chef");
    expect(varId).toBeUndefined();
  });

  it("returns undefined for output naming the info role itself", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    const varId = findPairInfoVariable(result, "Washerwoman", 0, 1, "Washerwoman");
    expect(varId).toBeUndefined();
  });

  it("normalizes player order", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    const v1 = findPairInfoVariable(result, "Washerwoman", 1, 3, "Chef");
    const v2 = findPairInfoVariable(result, "Washerwoman", 3, 1, "Chef");
    expect(v1).toBe(v2);
  });
});

describe("findCountInfoVariable", () => {
  it("finds Chef count variables", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    for (let c = 0; c <= 5; c++) {
      const varId = findCountInfoVariable(result, "Chef", c);
      expect(varId).toBeDefined();
    }
  });

  it("finds Empath count variables", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    for (let c = 0; c <= 2; c++) {
      const varId = findCountInfoVariable(result, "Empath", c);
      expect(varId).toBeDefined();
    }
  });

  it("returns undefined for role not in play", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Soldier", "Virgin", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    expect(findCountInfoVariable(result, "Chef", 0)).toBeUndefined();
    expect(findCountInfoVariable(result, "Empath", 0)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Observation / constraint tests (no Poisoner)
// ---------------------------------------------------------------------------

describe("Night info observations (no Poisoner)", () => {
  it("requiring a valid Washerwoman output narrows to 1 world per info role", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    expect(zdd.count(result.root)).toBe(6);

    const varId = findPairInfoVariable(result, "Washerwoman", 1, 3, "Chef")!;
    const constrained = zdd.require(result.root, varId);
    expect(zdd.count(constrained)).toBe(1);
  });

  it("requiring a nonexistent variable yields BOTTOM", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    const constrained = zdd.require(result.root, 9999);
    expect(constrained).toBe(BOTTOM);
  });

  it("excluding a variable removes worlds containing it", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    expect(zdd.count(result.root)).toBe(6);

    const varId = findPairInfoVariable(result, "Washerwoman", 1, 3, "Chef")!;
    const constrained = zdd.offset(result.root, varId);
    expect(zdd.count(constrained)).toBe(5);
  });

  it("requiring two different WW outputs yields BOTTOM (contradiction)", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    const var1 = findPairInfoVariable(result, "Washerwoman", 1, 3, "Chef")!;
    const var2 = findPairInfoVariable(result, "Washerwoman", 1, 4, "Chef")!;
    expect(var1).not.toBe(var2);

    let constrained = zdd.require(result.root, var1);
    constrained = zdd.require(constrained, var2);
    expect(constrained).toBe(BOTTOM);
  });
});

// ============================================================================
// Poisoner target selection tests
// ============================================================================

describe("Poisoner target selection", () => {
  // Standard scenario: WW(0), Chef(1), Empath(2), Poisoner(3), Imp(4)
  // Poisoner at seat 3. Targets: seats 0, 1, 2, 4.
  //
  // Maximal WW variables: C(4,2) × 13 Townsfolk = 78
  // Maximal Chef variables: counts 0..5 = 6
  // Maximal Empath variables: counts 0,1,2 = 3
  //
  // Branches:
  //   Target 0 (WW):    WW malfunctions (78) × Chef(1) × Empath(1) = 78
  //   Target 1 (Chef):  WW(6) × Chef malfunctions (6) × Empath(1) = 36
  //   Target 2 (Empath): WW(6) × Chef(1) × Empath malfunctions (3) = 18
  //   Target 4 (Imp):   WW(6) × Chef(1) × Empath(1) = 6
  // Total = 78 + 36 + 18 + 6 = 138

  function standardPoisonerSetup() {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));
    return { seatRoles, zdd, result };
  }

  it("total world count is the sum across all poisoner target branches", () => {
    const { zdd, result } = standardPoisonerSetup();
    expect(zdd.count(result.root)).toBe(138);
  });

  it("has poisoner target variables", () => {
    const { result } = standardPoisonerSetup();
    expect(result.poisonerTargetOutputs.size).toBe(4);

    const poisonerRange = result.roleVariableRanges.get("Poisoner");
    expect(poisonerRange).toBeDefined();
    expect(poisonerRange!.count).toBe(4);
    // Poisoner vars come first (lowest IDs)
    expect(poisonerRange!.start).toBe(0);
  });

  it("findPoisonerTargetVariable finds correct targets", () => {
    const { result } = standardPoisonerSetup();

    for (const seat of [0, 1, 2, 4]) {
      const varId = findPoisonerTargetVariable(result, seat);
      expect(varId).toBeDefined();
      expect(result.poisonerTargetOutputs.get(varId!)!.targetSeat).toBe(seat);
    }

    // Poisoner can't target self (seat 3)
    expect(findPoisonerTargetVariable(result, 3)).toBeUndefined();
  });

  it("poisoner targets non-info role: all info roles function normally", () => {
    const { zdd, result } = standardPoisonerSetup();

    // Require poisoner targets seat 4 (Imp) — no info role poisoned
    const targetVar = findPoisonerTargetVariable(result, 4)!;
    const constrained = zdd.require(result.root, targetVar);

    // WW(6) × Chef(1) × Empath(1) = 6
    expect(zdd.count(constrained)).toBe(6);
  });

  it("poisoner targets Washerwoman: WW gets unconstrained outputs", () => {
    const { zdd, result } = standardPoisonerSetup();

    const targetVar = findPoisonerTargetVariable(result, 0)!;
    const constrained = zdd.require(result.root, targetVar);

    // WW malfunctions (78) × Chef(1) × Empath(1) = 78
    expect(zdd.count(constrained)).toBe(78);
  });

  it("poisoner targets Chef: Chef can report any count", () => {
    const { zdd, result } = standardPoisonerSetup();

    const targetVar = findPoisonerTargetVariable(result, 1)!;
    const constrained = zdd.require(result.root, targetVar);

    // WW(6) × Chef malfunctions (6 counts) × Empath(1) = 36
    expect(zdd.count(constrained)).toBe(36);
  });

  it("poisoner targets Empath: Empath can report 0, 1, or 2", () => {
    const { zdd, result } = standardPoisonerSetup();

    const targetVar = findPoisonerTargetVariable(result, 2)!;
    const constrained = zdd.require(result.root, targetVar);

    // WW(6) × Chef(1) × Empath malfunctions (3) = 18
    expect(zdd.count(constrained)).toBe(18);
  });

  it("requiring output only valid when malfunctioning forces poisoner target", () => {
    const { zdd, result } = standardPoisonerSetup();

    // Chef true count is 1 (Poisoner+Imp adjacent). Require count=0 (only valid malfunctioning).
    const count0Var = findCountInfoVariable(result, "Chef", 0)!;
    const constrained = zdd.require(result.root, count0Var);

    // Only the branch where poisoner targets seat 1 (Chef) allows count=0.
    // That branch: WW(6) × Chef(count=0, 1 of 6 options) × Empath(1) = 6
    expect(zdd.count(constrained)).toBe(6);

    // Verify the poisoner must be targeting seat 1
    const target1Var = findPoisonerTargetVariable(result, 1)!;
    const doublyConstrained = zdd.require(constrained, target1Var);
    expect(zdd.count(doublyConstrained)).toBe(6); // All worlds already have target 1
  });

  it("requiring a truthful info output is valid in all branches", () => {
    const { zdd, result } = standardPoisonerSetup();

    // Require WW shows "players 1,3 = Chef" — truthful output valid in all branches
    const wwVar = findPairInfoVariable(result, "Washerwoman", 1, 3, "Chef")!;
    const constrained = zdd.require(result.root, wwVar);

    // Target 0 (WW malfunctions): 1 (this specific output) × 1 × 1 = 1
    // Target 1 (Chef malfunctions): 1 × 6 × 1 = 6
    // Target 2 (Empath malfunctions): 1 × 1 × 3 = 3
    // Target 4 (all function): 1 × 1 × 1 = 1
    // Total = 1 + 6 + 3 + 1 = 11
    expect(zdd.count(constrained)).toBe(11);
  });

  it("requiring a WW output only valid when malfunctioning forces poisoner on WW", () => {
    const { zdd, result } = standardPoisonerSetup();

    // "Players 3,4 = Chef" — neither seat 3 (Poisoner) nor seat 4 (Imp) is Chef.
    // This output is only in the maximal (malfunctioning) variable set.
    const wwVar = findPairInfoVariable(result, "Washerwoman", 3, 4, "Chef")!;
    expect(wwVar).toBeDefined();

    const constrained = zdd.require(result.root, wwVar);

    // Only valid when WW malfunctions → poisoner targets seat 0
    // WW(1 specific) × Chef(1) × Empath(1) = 1
    expect(zdd.count(constrained)).toBe(1);

    // Verify poisoner targets seat 0
    const target0Var = findPoisonerTargetVariable(result, 0)!;
    expect(zdd.require(constrained, target0Var)).not.toBe(BOTTOM);
  });

  it("info role variables have correct ranges with poisoner offset", () => {
    const { result } = standardPoisonerSetup();

    // Poisoner: 4 vars at start
    const poisonerRange = result.roleVariableRanges.get("Poisoner")!;
    expect(poisonerRange.start).toBe(0);
    expect(poisonerRange.count).toBe(4);

    // Info role vars start after poisoner vars
    const wwRange = result.roleVariableRanges.get("Washerwoman")!;
    expect(wwRange.start).toBe(4);

    const chefRange = result.roleVariableRanges.get("Chef")!;
    expect(chefRange.start).toBe(4 + wwRange.count);

    const empathRange = result.roleVariableRanges.get("Empath")!;
    expect(empathRange.start).toBe(4 + wwRange.count + chefRange.count);
  });

  it("no poisoner targets available when Poisoner is not in play", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    expect(result.poisonerTargetOutputs.size).toBe(0);
    expect(result.roleVariableRanges.has("Poisoner")).toBe(false);
  });
});

// ============================================================================
// Malfunctioning seats (Drunk) tests
// ============================================================================

describe("malfunctioningSeats (Drunk)", () => {
  it("malfunctioning Empath gets unconstrained outputs (no Poisoner)", () => {
    // WW(0), Chef(1), Empath(2), SW(3), Imp(4)
    // Empath at seat 2 is the Drunk → always malfunctioning
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles, {
      malfunctioningSeats: new Set([2]),
    }));

    // WW functioning (6) × Chef functioning (count=1, 1) × Empath malfunctioning (3)
    // = 6 × 1 × 3 = 18
    expect(zdd.count(result.root)).toBe(18);
  });

  it("malfunctioning Empath allows wrong count", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles, {
      malfunctioningSeats: new Set([2]),
    }));

    // True Empath count is 1 (neighbor seat 3 = SW = evil)
    // But malfunctioning, so count=0 is also valid
    const count0Var = findCountInfoVariable(result, "Empath", 0)!;
    const constrained = zdd.require(result.root, count0Var);
    // WW(6) × Chef(1) × Empath(count=0) = 6
    expect(zdd.count(constrained)).toBe(6);
  });

  it("malfunctioning Chef allows any count (no Poisoner)", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles, {
      malfunctioningSeats: new Set([1]),
    }));

    // WW functioning (6) × Chef malfunctioning (6 counts) × Empath functioning (1)
    // = 6 × 6 × 1 = 36
    expect(zdd.count(result.root)).toBe(36);
  });

  it("malfunctioning WW gets all possible outputs (no Poisoner)", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles, {
      malfunctioningSeats: new Set([0]),
    }));

    // WW malfunctioning: C(4,2) pairs × 13 Townsfolk = 78
    // Chef functioning (1) × Empath functioning (1)
    // = 78 × 1 × 1 = 78
    expect(zdd.count(result.root)).toBe(78);
  });

  it("malfunctioning seat is always unconstrained regardless of poisoner target", () => {
    // WW(0), Chef(1), Empath(2), Poisoner(3), Imp(4)
    // Empath at seat 2 is Drunk (always malfunctioning)
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles, {
      malfunctioningSeats: new Set([2]),
    }));

    // Empath always malfunctions (3 options), regardless of poisoner target.
    //   Target 0 (WW): WW malfunctions (78) × Chef(1) × Empath(3) = 234
    //   Target 1 (Chef): WW(6) × Chef malfunctions (6) × Empath(3) = 108
    //   Target 2 (Empath): WW(6) × Chef(1) × Empath(already malfunctioning, 3) = 18
    //   Target 4 (Imp): WW(6) × Chef(1) × Empath(3) = 18
    // Total = 234 + 108 + 18 + 18 = 378
    expect(zdd.count(result.root)).toBe(378);

    // Verify Empath is unconstrained even when poisoner targets someone else
    const target4Var = findPoisonerTargetVariable(result, 4)!;
    const constrained = zdd.require(result.root, target4Var);
    // WW(6) × Chef(1) × Empath(3) = 18
    expect(zdd.count(constrained)).toBe(18);

    // Empath count=0 should be valid in every branch
    const count0Var = findCountInfoVariable(result, "Empath", 0)!;
    const withCount0 = zdd.require(result.root, count0Var);
    // Should be valid in all 4 branches (Empath always has 3 options, picking 1)
    // Target 0: 78×1×1 = 78, Target 1: 6×6×1 = 36, Target 2: 6×1×1 = 6, Target 4: 6×1×1 = 6
    // Total: 78+36+6+6 = 126
    expect(zdd.count(withCount0)).toBe(126);
  });
});

// ============================================================================
// Game class integration tests
// ============================================================================

describe("Game.buildNightInfo", () => {
  function setupGameWithNightInfo(
    roles: string[],
    seatOrder: string[],
    malfunctioningSeats?: Set<number>,
  ): { game: Game; seatAssignment: Map<number, string> } {
    const game = new Game(TROUBLE_BREWING, roles.length);
    game.buildDistribution();

    const roleIndices = roles.map((name) =>
      TROUBLE_BREWING.roles.findIndex((r) => r.name === name),
    );
    roleIndices.sort((a, b) => a - b);

    game.buildSeatAssignment(roleIndices);

    const selectedRoles = game.selectedRoles!;

    for (let seat = 0; seat < seatOrder.length; seat++) {
      const roleIndex = selectedRoles.indexOf(seatOrder[seat]);
      game.applyObservation({
        kind: "seat-has-role",
        seat,
        roleIndex,
      });
    }
    expect(game.countWorlds()).toBe(1);

    const assignments = game.zdd.enumerate(game.currentRoot);
    expect(assignments.length).toBe(1);
    const seatAssignment = resolveSeatAssignment(
      assignments[0],
      roles.length,
      selectedRoles,
    );

    game.buildNightInfo(seatAssignment, malfunctioningSeats);

    return { game, seatAssignment };
  }

  it("creates a NightInfo phase after seat assignment", () => {
    const { game } = setupGameWithNightInfo(
      ["Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp"],
      ["Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp"],
    );

    expect(game.phaseCount).toBe(3);
    expect(game.currentPhase!.info.type).toBe(PhaseType.NightInfo);
    expect(game.currentPhase!.info.label).toBe("Night 1 Information");
  });

  it("world count matches expected for 5-player setup (no Poisoner)", () => {
    const { game } = setupGameWithNightInfo(
      ["Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp"],
      ["Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp"],
    );

    // 6 WW choices × 1 Chef × 1 Empath = 6
    expect(game.countWorlds()).toBe(6);
  });

  it("world count matches expected for 5-player setup (with Poisoner)", () => {
    const { game } = setupGameWithNightInfo(
      ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"],
      ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"],
    );

    // 4 poisoner targets × branching info = 78 + 36 + 18 + 6 = 138
    expect(game.countWorlds()).toBe(138);
  });

  it("nightInfoResult is accessible", () => {
    const { game } = setupGameWithNightInfo(
      ["Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp"],
      ["Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp"],
    );

    const result = game.nightInfoResult;
    expect(result).toBeDefined();
    expect(result!.roleVariableRanges.has("Washerwoman")).toBe(true);
    expect(result!.roleVariableRanges.has("Chef")).toBe(true);
    expect(result!.roleVariableRanges.has("Empath")).toBe(true);
  });

  it("applying Washerwoman observation constrains the night info ZDD (no Poisoner)", () => {
    const { game } = setupGameWithNightInfo(
      ["Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp"],
      ["Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp"],
    );

    expect(game.countWorlds()).toBe(6);

    const result = game.nightInfoResult!;
    const varId = findPairInfoVariable(result, "Washerwoman", 1, 3, "Chef")!;

    game.applyObservation({ kind: "require-variable", variable: varId });
    expect(game.countWorlds()).toBe(1);
  });

  it("inconsistent observation produces empty ZDD", () => {
    const { game } = setupGameWithNightInfo(
      ["Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp"],
      ["Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp"],
    );

    game.applyObservation({ kind: "require-variable", variable: 9999 });
    expect(game.countWorlds()).toBe(0);
  });

  it("wrong Chef count produces empty ZDD (no Poisoner)", () => {
    const { game } = setupGameWithNightInfo(
      ["Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp"],
      ["Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp"],
    );

    const result = game.nightInfoResult!;
    const wrongVar = findCountInfoVariable(result, "Chef", 0)!;
    game.applyObservation({ kind: "require-variable", variable: wrongVar });
    expect(game.countWorlds()).toBe(0);
  });

  it("correct Chef count keeps worlds alive (no Poisoner)", () => {
    const { game } = setupGameWithNightInfo(
      ["Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp"],
      ["Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp"],
    );

    const result = game.nightInfoResult!;
    const correctVar = findCountInfoVariable(result, "Chef", 1)!;
    game.applyObservation({ kind: "require-variable", variable: correctVar });
    expect(game.countWorlds()).toBe(6);
  });

  it("wrong Chef count is valid with Poisoner (poisoner may target Chef)", () => {
    const { game } = setupGameWithNightInfo(
      ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"],
      ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"],
    );

    const result = game.nightInfoResult!;
    // True count is 1, but count=0 is valid when poisoner targets Chef
    const wrongVar = findCountInfoVariable(result, "Chef", 0)!;
    game.applyObservation({ kind: "require-variable", variable: wrongVar });
    // Only the poisoner-targets-Chef branch: WW(6) × 1 × Empath(1) = 6
    expect(game.countWorlds()).toBe(6);
  });

  it("undo removes the night info phase", () => {
    const { game } = setupGameWithNightInfo(
      ["Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp"],
      ["Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp"],
    );

    expect(game.phaseCount).toBe(3);
    const popped = game.undo();
    expect(popped!.type).toBe(PhaseType.NightInfo);
    expect(game.phaseCount).toBe(2);
    expect(game.currentPhase!.info.type).toBe(PhaseType.SeatAssignment);
  });

  it("throws if seat assignment count doesn't match player count", () => {
    const game = new Game(TROUBLE_BREWING, 5);
    game.buildDistribution();
    const dists = game.zdd.enumerate(game.currentRoot);
    game.buildSeatAssignment(dists[0]);

    const wrongSize = new Map<number, string>([[0, "Washerwoman"], [1, "Chef"]]);
    expect(() => game.buildNightInfo(wrongSize)).toThrow(
      "Expected 5 seat assignments, got 2",
    );
  });

  it("passes malfunctioningSeats through to night info builder", () => {
    const { game } = setupGameWithNightInfo(
      ["Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp"],
      ["Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp"],
      new Set([2]), // Empath is Drunk
    );

    // WW(6) × Chef(1) × Empath malfunctioning (3) = 18
    expect(game.countWorlds()).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: full pipeline test
// ---------------------------------------------------------------------------

describe("end-to-end: distribution → seats → night info", () => {
  it("5-player TB full pipeline with observations (no Poisoner)", () => {
    const game = new Game(TROUBLE_BREWING, 5);

    // Phase 1: distribution
    game.buildDistribution();
    expect(game.countWorlds()).toBe(858);

    // Find distribution: Washerwoman, Chef, Empath, Scarlet Woman, Imp
    const wwIdx = TROUBLE_BREWING.roles.findIndex((r) => r.name === "Washerwoman");
    const chefIdx = TROUBLE_BREWING.roles.findIndex((r) => r.name === "Chef");
    const empIdx = TROUBLE_BREWING.roles.findIndex((r) => r.name === "Empath");
    const spyIdx = TROUBLE_BREWING.roles.findIndex((r) => r.name === "Scarlet Woman");
    const impIdx = TROUBLE_BREWING.roles.findIndex((r) => r.name === "Imp");
    const distVars = [wwIdx, chefIdx, empIdx, spyIdx, impIdx].sort((a, b) => a - b);

    // Phase 2: seat assignment
    game.buildSeatAssignment(distVars);
    expect(game.countWorlds()).toBe(120); // 5!

    // Fix assignment: seat 0=WW, 1=Chef, 2=Empath, 3=SW, 4=Imp
    const selectedRoles = game.selectedRoles!;
    for (let seat = 0; seat < 5; seat++) {
      const desiredRole = ["Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp"][seat];
      const roleIndex = selectedRoles.indexOf(desiredRole);
      game.applyObservation({ kind: "seat-has-role", seat, roleIndex });
    }
    expect(game.countWorlds()).toBe(1);

    // Resolve seat assignment
    const assignments = game.zdd.enumerate(game.currentRoot);
    const seatAssignment = resolveSeatAssignment(
      assignments[0], 5, selectedRoles,
    );
    expect(seatAssignment.get(0)).toBe("Washerwoman");
    expect(seatAssignment.get(3)).toBe("Scarlet Woman");

    // Phase 3: Night 1 information
    game.buildNightInfo(seatAssignment);
    expect(game.phaseCount).toBe(3);
    expect(game.countWorlds()).toBe(6);

    // The storyteller tells us: "Washerwoman sees players 1 and 3, one is the Chef"
    const nightResult = game.nightInfoResult!;
    const wwVar = findPairInfoVariable(nightResult, "Washerwoman", 1, 3, "Chef")!;
    expect(wwVar).toBeDefined();

    game.applyObservation({ kind: "require-variable", variable: wwVar });
    expect(game.countWorlds()).toBe(1);

    // Verify the remaining world has the correct variables
    const worlds = game.zdd.enumerate(game.currentRoot);
    expect(worlds.length).toBe(1);
    expect(worlds[0]).toContain(wwVar);

    // The world should also contain Chef count=1 and Empath count=1
    const chefVar = findCountInfoVariable(nightResult, "Chef", 1)!;
    const empathVar = findCountInfoVariable(nightResult, "Empath", 1)!;
    expect(worlds[0]).toContain(chefVar);
    expect(worlds[0]).toContain(empathVar);
  });

  it("5-player TB full pipeline with Poisoner", () => {
    const game = new Game(TROUBLE_BREWING, 5);
    game.buildDistribution();

    const wwIdx = TROUBLE_BREWING.roles.findIndex((r) => r.name === "Washerwoman");
    const chefIdx = TROUBLE_BREWING.roles.findIndex((r) => r.name === "Chef");
    const empIdx = TROUBLE_BREWING.roles.findIndex((r) => r.name === "Empath");
    const poisIdx = TROUBLE_BREWING.roles.findIndex((r) => r.name === "Poisoner");
    const impIdx = TROUBLE_BREWING.roles.findIndex((r) => r.name === "Imp");
    const distVars = [wwIdx, chefIdx, empIdx, poisIdx, impIdx].sort((a, b) => a - b);

    game.buildSeatAssignment(distVars);
    const selectedRoles = game.selectedRoles!;
    for (let seat = 0; seat < 5; seat++) {
      const desiredRole = ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"][seat];
      const roleIndex = selectedRoles.indexOf(desiredRole);
      game.applyObservation({ kind: "seat-has-role", seat, roleIndex });
    }

    const assignments = game.zdd.enumerate(game.currentRoot);
    const seatAssignment = resolveSeatAssignment(assignments[0], 5, selectedRoles);

    game.buildNightInfo(seatAssignment);
    expect(game.countWorlds()).toBe(138);

    const nightResult = game.nightInfoResult!;

    // Require poisoner targets the Imp (non-info role)
    const targetImpVar = findPoisonerTargetVariable(nightResult, 4)!;
    game.applyObservation({ kind: "require-variable", variable: targetImpVar });
    expect(game.countWorlds()).toBe(6); // All info roles functioning

    // Now require a specific WW output
    const wwVar = findPairInfoVariable(nightResult, "Washerwoman", 1, 3, "Chef")!;
    game.applyObservation({ kind: "require-variable", variable: wwVar });
    expect(game.countWorlds()).toBe(1);

    // Verify world contains poisoner target, WW output, Chef count=1, Empath count=1
    const worlds = game.zdd.enumerate(game.currentRoot);
    expect(worlds.length).toBe(1);
    expect(worlds[0]).toContain(targetImpVar);
    expect(worlds[0]).toContain(wwVar);
    expect(worlds[0]).toContain(findCountInfoVariable(nightResult, "Chef", 1)!);
    expect(worlds[0]).toContain(findCountInfoVariable(nightResult, "Empath", 1)!);
  });
});

// ============================================================================
// Spy registration tests
// ============================================================================

describe("Spy registration", () => {
  it("Spy expands Washerwoman outputs (all 13 Townsfolk role names)", () => {
    // Seats: 0=WW, 1=Chef, 2=Empath, 3=Spy, 4=Imp
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Spy", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    // WW targets:
    //  Chef(seat 1): decoys 2,3,4 → 3 outputs (named "Chef")
    //  Empath(seat 2): decoys 1,3,4 → 3 outputs (named "Empath")
    //  Spy(seat 3) registers as Townsfolk: 13 roles × decoys 1,2,4 = 39 outputs
    //    minus 2 overlaps: (1,3,"Chef") and (2,3,"Empath") already counted
    // WW total: 3 + 3 + 39 - 2 = 43
    // Chef: Spy can register Good/Evil → counts {0, 1} → 2
    // Empath: seat 2, neighbors 1(Chef=good), 3(Spy flexible) → counts {0, 1} → 2
    // Total = 43 × 2 × 2 = 172
    expect(zdd.count(result.root)).toBe(172);
  });

  it("Spy expands Librarian outputs (all 4 Outsider role names)", () => {
    // Seats: 0=Librarian, 1=Chef, 2=Butler, 3=Spy, 4=Imp
    const seatRoles = makeSeatRoles(
      "Librarian", "Chef", "Butler", "Spy", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    const libRange = result.roleVariableRanges.get("Librarian");
    expect(libRange).toBeDefined();

    // Librarian targets:
    //   Butler(seat 2): decoys 1,3,4 → 3 outputs (named "Butler")
    //   Spy(seat 3) registers as Outsider: 4 roles × decoys 1,2,4 = 12 outputs
    //     minus 1 overlap: (2,3,"Butler") already counted
    // Total Lib outputs = 3 + 12 - 1 = 14
    const libPairs = [];
    for (let vid = libRange!.start; vid < libRange!.start + libRange!.count; vid++) {
      const output = result.pairOutputs.get(vid);
      if (output) libPairs.push(output);
    }
    expect(libPairs.length).toBe(14);

    // Spy can appear as any Outsider
    const spyOutputs = libPairs.filter((p) => p.playerA === 3 || p.playerB === 3);
    const spyRoles = new Set(spyOutputs.map((p) => p.namedRole));
    expect(spyRoles.size).toBe(4); // Butler, Drunk, Recluse, Saint
  });

  it("Spy expands Investigator outputs (all 4 Minion role names, not just Spy)", () => {
    // Seats: 0=Investigator, 1=Chef, 2=Empath, 3=Spy, 4=Imp
    const seatRoles = makeSeatRoles(
      "Investigator", "Chef", "Empath", "Spy", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    const invRange = result.roleVariableRanges.get("Investigator");
    expect(invRange).toBeDefined();

    // Spy(seat 3) is actually a Minion AND has registersAs including Minion
    // registersAs expands: can be named as any of 4 Minion roles
    // Decoys: 1, 2, 4 → 3 × 4 = 12 outputs
    const invPairs = [];
    for (let vid = invRange!.start; vid < invRange!.start + invRange!.count; vid++) {
      const output = result.pairOutputs.get(vid);
      if (output) invPairs.push(output);
    }
    expect(invPairs.length).toBe(12);

    const namedRoles = new Set(invPairs.map((p) => p.namedRole));
    expect(namedRoles).toContain("Spy");
    expect(namedRoles).toContain("Poisoner");
    expect(namedRoles).toContain("Scarlet Woman");
    expect(namedRoles).toContain("Baron");
  });

  it("Spy adjacent to evil: Chef has 2 valid counts (evil vs. good registration)", () => {
    // Circle: 0=WW, 1=Chef, 2=Empath, 3=Spy, 4=Imp
    // Spy(3) adjacent to Imp(4). Spy evil → pair (3,4) count=1; Spy good → count=0
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Spy", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    const count0Var = findCountInfoVariable(result, "Chef", 0)!;
    const count1Var = findCountInfoVariable(result, "Chef", 1)!;
    expect(count0Var).toBeDefined();
    expect(count1Var).toBeDefined();

    // Both counts should have worlds
    expect(zdd.count(zdd.require(result.root, count0Var))).toBeGreaterThan(0);
    expect(zdd.count(zdd.require(result.root, count1Var))).toBeGreaterThan(0);

    // Count=2 should NOT be valid (only one possible evil pair)
    const count2Var = findCountInfoVariable(result, "Chef", 2)!;
    expect(zdd.count(zdd.require(result.root, count2Var))).toBe(0);
  });

  it("Spy as Empath neighbor: Empath has 2 valid counts", () => {
    // Circle: 0=WW, 1=Chef, 2=Empath, 3=Spy, 4=Imp
    // Empath neighbors: Chef(1, good), Spy(3, flexible)
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Spy", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    const count0Var = findCountInfoVariable(result, "Empath", 0)!;
    const count1Var = findCountInfoVariable(result, "Empath", 1)!;

    expect(zdd.count(zdd.require(result.root, count0Var))).toBeGreaterThan(0);
    expect(zdd.count(zdd.require(result.root, count1Var))).toBeGreaterThan(0);

    // Count=2 NOT valid (only one flexible neighbor)
    const count2Var = findCountInfoVariable(result, "Empath", 2)!;
    expect(zdd.count(zdd.require(result.root, count2Var))).toBe(0);
  });

  it("Spy + Poisoner: total world count with expanded outputs", () => {
    // Seats: 0=WW, 1=Chef, 2=Empath, 3=Spy, 4=Imp
    // Replace Spy with Poisoner at seat 3, Spy at another position...
    // Actually let's use: 0=WW, 1=Chef, 2=Empath, 3=Poisoner, 4=Imp
    // with Spy NOT in play — this is the existing Poisoner test.
    // For Spy+Poisoner: 0=WW, 1=Chef, 2=Spy, 3=Poisoner, 4=Imp
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Spy", "Poisoner", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    // Poisoner targets: 0,1,2,4 (4 targets)
    expect(result.poisonerTargetOutputs.size).toBe(4);

    // The total should be higher than 138 (the no-Spy baseline with Empath)
    // because Spy expands WW outputs and Chef/no-Empath is simpler
    expect(zdd.count(result.root)).toBeGreaterThan(0);
  });
});

// ============================================================================
// Recluse registration tests
// ============================================================================

describe("Recluse registration", () => {
  it("Recluse as Investigator Minion reference (all 4 Minion role names)", () => {
    // Seats: 0=Investigator, 1=Chef, 2=Recluse, 3=Scarlet Woman, 4=Imp
    const seatRoles = makeSeatRoles(
      "Investigator", "Chef", "Recluse", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    const invRange = result.roleVariableRanges.get("Investigator");
    expect(invRange).toBeDefined();

    const invPairs = [];
    for (let vid = invRange!.start; vid < invRange!.start + invRange!.count; vid++) {
      const output = result.pairOutputs.get(vid);
      if (output) invPairs.push(output);
    }

    // SW(seat 3): actual Minion → named "Scarlet Woman" + registersAs→ no registration capability
    //   decoys: 1, 2, 4 → 3 outputs
    // Recluse(seat 2): registersAs includes Minion → all 4 Minion roles
    //   decoys: 1, 3, 4 → 3 per role × 4 = 12 outputs
    //   minus overlap with SW: (2,3,"Scarlet Woman") already counted? No — SW target
    //   produces (2,3,"Scarlet Woman") where seat 3 is reference. Recluse target
    //   produces (2,3,"Scarlet Woman") where seat 2 is reference. Same triple → dedup!
    // Total: 3 + 12 - 1 = 14
    expect(invPairs.length).toBe(14);

    // Recluse outputs include all 4 Minion roles
    const recluseOutputs = invPairs.filter((p) => p.playerA === 2 || p.playerB === 2);
    const recluseRoles = new Set(recluseOutputs.map((p) => p.namedRole));
    expect(recluseRoles).toContain("Poisoner");
    expect(recluseRoles).toContain("Spy");
    expect(recluseRoles).toContain("Scarlet Woman");
    expect(recluseRoles).toContain("Baron");
  });

  it("Recluse expands Librarian outputs (all 4 Outsider role names)", () => {
    // Seats: 0=Librarian, 1=Chef, 2=Recluse, 3=Scarlet Woman, 4=Imp
    const seatRoles = makeSeatRoles(
      "Librarian", "Chef", "Recluse", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    const libRange = result.roleVariableRanges.get("Librarian");
    expect(libRange).toBeDefined();

    const libPairs = [];
    for (let vid = libRange!.start; vid < libRange!.start + libRange!.count; vid++) {
      const output = result.pairOutputs.get(vid);
      if (output) libPairs.push(output);
    }

    // Recluse(seat 2): actual Outsider → "Recluse" + registersAs includes Outsider → all 4
    // decoys: 1, 3, 4 → 3 per role × 4 roles = 12 outputs
    expect(libPairs.length).toBe(12);

    const roleNames = new Set(libPairs.map((p) => p.namedRole));
    expect(roleNames.size).toBe(4); // Butler, Drunk, Recluse, Saint
  });

  it("Recluse CANNOT register as Townsfolk (no effect on Washerwoman)", () => {
    // Seats: 0=WW, 1=Chef, 2=Recluse, 3=Scarlet Woman, 4=Imp
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Recluse", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    const wwRange = result.roleVariableRanges.get("Washerwoman");
    expect(wwRange).toBeDefined();

    const wwPairs = [];
    for (let vid = wwRange!.start; vid < wwRange!.start + wwRange!.count; vid++) {
      const output = result.pairOutputs.get(vid);
      if (output) wwPairs.push(output);
    }

    // Only Chef(seat 1) is a Townsfolk target. Decoys: 2,3,4 → 3 outputs
    expect(wwPairs.length).toBe(3);
    for (const p of wwPairs) {
      expect(p.namedRole).toBe("Chef");
      expect(p.playerA === 1 || p.playerB === 1).toBe(true);
    }
  });

  it("Recluse adjacent to evil: Chef count expands", () => {
    // Circle: 0=WW, 1=Chef, 2=Recluse, 3=Scarlet Woman, 4=Imp
    // SW(3) and Imp(4) adjacent → pair. Recluse(2) adjacent to SW(3).
    // Recluse registers evil → (2,3) evil pair too → count=2
    // Recluse registers good → just (3,4) → count=1
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Recluse", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    const count1Var = findCountInfoVariable(result, "Chef", 1)!;
    const count2Var = findCountInfoVariable(result, "Chef", 2)!;

    expect(zdd.count(zdd.require(result.root, count1Var))).toBeGreaterThan(0);
    expect(zdd.count(zdd.require(result.root, count2Var))).toBeGreaterThan(0);
  });

  it("Recluse as Empath neighbor: Empath count expands", () => {
    // Circle: 0=WW, 1=Recluse, 2=Empath, 3=Chef, 4=Scarlet Woman, 5=Imp
    // Empath neighbors: Recluse(1, flexible), Chef(3, good)
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Recluse", "Empath", "Chef", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    const count0Var = findCountInfoVariable(result, "Empath", 0)!;
    const count1Var = findCountInfoVariable(result, "Empath", 1)!;

    expect(zdd.count(zdd.require(result.root, count0Var))).toBeGreaterThan(0);
    expect(zdd.count(zdd.require(result.root, count1Var))).toBeGreaterThan(0);
  });
});

// ============================================================================
// Fortune Teller tests
// ============================================================================

describe("Fortune Teller", () => {
  it("FT in play: red herring and FT output variables present", () => {
    // Seats: 0=Fortune Teller, 1=Chef, 2=Empath, 3=Scarlet Woman, 4=Imp
    const seatRoles = makeSeatRoles(
      "Fortune Teller", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    // Red herring: all seats except Demon(4) → seats 0,1,2,3 → 4 vars
    expect(result.redHerringOutputs.size).toBe(4);

    // FT outputs: C(4,2) pairs × 2 answers = 6 × 2 = 12
    expect(result.fortuneTellerOutputs.size).toBe(12);

    expect(result.roleVariableRanges.has("RedHerring")).toBe(true);
    expect(result.roleVariableRanges.has("Fortune Teller")).toBe(true);
  });

  it("FT with Demon in pair: always Yes regardless of red herring", () => {
    const seatRoles = makeSeatRoles(
      "Fortune Teller", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    // Pair (1, 4) where Imp is at seat 4: always Yes
    const yesVar = findFortuneTellerVariable(result, 1, 4, "Yes");
    const noVar = findFortuneTellerVariable(result, 1, 4, "No");
    expect(yesVar).toBeDefined();
    expect(noVar).toBeDefined();

    // Yes should have worlds; No should have none (Demon always pings)
    const withYes = zdd.require(result.root, yesVar!);
    expect(zdd.count(withYes)).toBeGreaterThan(0);

    const withNo = zdd.require(result.root, noVar!);
    expect(zdd.count(withNo)).toBe(0);
  });

  it("FT with red herring in pair: Yes regardless of actual demon", () => {
    const seatRoles = makeSeatRoles(
      "Fortune Teller", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    // Require red herring on seat 1 (Chef)
    const rhVar = findRedHerringVariable(result, 1)!;
    expect(rhVar).toBeDefined();
    const constrained = zdd.require(result.root, rhVar);

    // Pair (1, 2): seat 1 is red herring → Yes
    const yesVar = findFortuneTellerVariable(result, 1, 2, "Yes")!;
    const noVar = findFortuneTellerVariable(result, 1, 2, "No")!;

    expect(zdd.count(zdd.require(constrained, yesVar))).toBeGreaterThan(0);
    expect(zdd.count(zdd.require(constrained, noVar))).toBe(0);
  });

  it("FT with neither Demon nor red herring in pair: No", () => {
    const seatRoles = makeSeatRoles(
      "Fortune Teller", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    // Require red herring on seat 3 (SW)
    const rhVar = findRedHerringVariable(result, 3)!;
    const constrained = zdd.require(result.root, rhVar);

    // Pair (1, 2): neither is Demon(4) nor red herring(3) → No
    const yesVar = findFortuneTellerVariable(result, 1, 2, "Yes")!;
    const noVar = findFortuneTellerVariable(result, 1, 2, "No")!;

    expect(zdd.count(zdd.require(constrained, yesVar))).toBe(0);
    expect(zdd.count(zdd.require(constrained, noVar))).toBeGreaterThan(0);
  });

  it("FT malfunctioning (poisoned): any pair+answer valid", () => {
    const seatRoles = makeSeatRoles(
      "Fortune Teller", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles, {
      malfunctioningSeats: new Set([0]),
    }));

    // Pair (1, 2) neither demon nor red herring, but FT malfunctions
    // Both Yes and No should be valid across red herring branches
    const yesVar = findFortuneTellerVariable(result, 1, 2, "Yes")!;
    const noVar = findFortuneTellerVariable(result, 1, 2, "No")!;

    expect(zdd.count(zdd.require(result.root, yesVar))).toBeGreaterThan(0);
    expect(zdd.count(zdd.require(result.root, noVar))).toBeGreaterThan(0);
  });

  it("FT world count with specific red herring", () => {
    // 5-player: 0=FT, 1=Chef, 2=Empath, 3=SW, 4=Imp
    // Red herring candidates: 0,1,2,3 (not seat 4=Imp=Demon)
    // For a specific red herring at seat 1:
    //   Pinging seats: Imp(4) and red herring(1)
    //   Pairs with at least one pinging: (1,2), (1,3), (1,4), (2,4), (3,4) → 5 Yes
    //   Pairs with no pinging: (2,3) → 1 No
    //   FT choices = 6 (one per pair, answer determined)
    const seatRoles = makeSeatRoles(
      "Fortune Teller", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    const rhVar = findRedHerringVariable(result, 1)!;
    const constrained = zdd.require(result.root, rhVar);

    // Chef(1 count) × Empath(1 count) × FT(6 determined pairs) = 6
    expect(zdd.count(constrained)).toBe(6);
  });

  it("FT total world count (sum across red herring branches)", () => {
    // 5-player: 0=FT, 1=Chef, 2=Empath, 3=SW, 4=Imp
    // C(4,2)=6 pairs. For each red herring candidate, each pair has exactly 1 valid answer.
    // So each RH branch has 6 FT choices.
    // RH candidates: 4 (seats 0,1,2,3)
    // Chef: 1 count × Empath: 1 count × (4 RH × 6 FT) = 24
    const seatRoles = makeSeatRoles(
      "Fortune Teller", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    expect(zdd.count(result.root)).toBe(24);
  });

  it("FT + Poisoner branching: total world count", () => {
    // 5-player: 0=FT, 1=Chef, 2=Empath, 3=Poisoner, 4=Imp
    // Poisoner targets: 0,1,2,4 (4 targets)
    // RH candidates: 0,1,2,3 (4, not Demon=4)
    //
    // For each poisoner target:
    //   Non-FT roles constrained + FT branches per RH
    //
    // Target 0 (FT poisoned):
    //   Chef(1) × Empath(1) × (4 RH × 12 FT unconstrained) = 48
    // Target 1 (Chef poisoned):
    //   Chef(6 counts) × Empath(1) × (4 RH × 6 FT constrained) = 144
    // Target 2 (Empath poisoned):
    //   Chef(1) × Empath(3 counts) × (4 RH × 6 FT constrained) = 72
    // Target 4 (Imp poisoned):
    //   Chef(1) × Empath(1) × (4 RH × 6 FT constrained) = 24
    // Total = 48 + 144 + 72 + 24 = 288
    const seatRoles = makeSeatRoles(
      "Fortune Teller", "Chef", "Empath", "Poisoner", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    expect(result.poisonerTargetOutputs.size).toBe(4);
    expect(result.redHerringOutputs.size).toBe(4);
    expect(zdd.count(result.root)).toBe(288);
  });
});

// ============================================================================
// Combined Spy + Recluse tests
// ============================================================================

describe("Combined Spy + Recluse", () => {
  it("Spy + Recluse: Chef enumerates all combinations", () => {
    // Circle: 0=WW, 1=Chef, 2=Spy, 3=Recluse, 4=Scarlet Woman, 5=Imp
    // Evil naturally: Spy(2), SW(4), Imp(5)
    // Flexible: Spy(2) and Recluse(3), both can be Good or Evil
    // Adjacent pairs depend on registration:
    //   Spy evil, Recluse evil: evil={2,3,4,5}. Pairs: (2,3),(3,4),(4,5) = 3
    //   Spy evil, Recluse good: evil={2,4,5}. Pairs: (4,5) = 1
    //   Spy good, Recluse evil: evil={3,4,5}. Pairs: (3,4),(4,5) = 2
    //   Spy good, Recluse good: evil={4,5}. Pairs: (4,5) = 1
    // Valid counts: {1, 2, 3}
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Spy", "Recluse", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    const count1Var = findCountInfoVariable(result, "Chef", 1)!;
    const count2Var = findCountInfoVariable(result, "Chef", 2)!;
    const count3Var = findCountInfoVariable(result, "Chef", 3)!;

    expect(zdd.count(zdd.require(result.root, count1Var))).toBeGreaterThan(0);
    expect(zdd.count(zdd.require(result.root, count2Var))).toBeGreaterThan(0);
    expect(zdd.count(zdd.require(result.root, count3Var))).toBeGreaterThan(0);

    // Count 0 should not be valid
    const count0Var = findCountInfoVariable(result, "Chef", 0)!;
    expect(zdd.count(zdd.require(result.root, count0Var))).toBe(0);
  });
});

// ============================================================================
// Lookup helper tests for new types
// ============================================================================

describe("findRedHerringVariable", () => {
  it("finds correct red herring variables", () => {
    const seatRoles = makeSeatRoles(
      "Fortune Teller", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    // Eligible: seats 0,1,2,3 (not seat 4 = Demon)
    for (const seat of [0, 1, 2, 3]) {
      const varId = findRedHerringVariable(result, seat);
      expect(varId).toBeDefined();
      expect(result.redHerringOutputs.get(varId!)!.targetSeat).toBe(seat);
    }

    // Demon seat is not eligible
    expect(findRedHerringVariable(result, 4)).toBeUndefined();
  });
});

describe("findFortuneTellerVariable", () => {
  it("finds correct FT output variables", () => {
    const seatRoles = makeSeatRoles(
      "Fortune Teller", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    const yesVar = findFortuneTellerVariable(result, 1, 2, "Yes");
    const noVar = findFortuneTellerVariable(result, 1, 2, "No");
    expect(yesVar).toBeDefined();
    expect(noVar).toBeDefined();
    expect(yesVar).not.toBe(noVar);
  });

  it("normalizes player order", () => {
    const seatRoles = makeSeatRoles(
      "Fortune Teller", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    const v1 = findFortuneTellerVariable(result, 1, 2, "Yes");
    const v2 = findFortuneTellerVariable(result, 2, 1, "Yes");
    expect(v1).toBe(v2);
  });

  it("returns undefined for FT not in play", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    expect(findFortuneTellerVariable(result, 1, 2, "Yes")).toBeUndefined();
  });
});
