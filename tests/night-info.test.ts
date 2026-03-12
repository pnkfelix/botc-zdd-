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
  selectedRoles?: string[],
): NightInfoConfig {
  const roles = selectedRoles ?? [...seatRoles.values()];
  return {
    numPlayers: seatRoles.size,
    seatRoles,
    selectedRoles: roles,
    script: TROUBLE_BREWING,
  };
}

// ---------------------------------------------------------------------------
// Direct builder tests (unit tests for buildNightInfoZDD)
// ---------------------------------------------------------------------------

describe("buildNightInfoZDD", () => {
  describe("Washerwoman", () => {
    it("enumerates valid ST choices for a 5-player game", () => {
      // Seats: 0=Washerwoman, 1=Chef, 2=Empath, 3=Poisoner, 4=Imp
      const seatRoles = makeSeatRoles(
        "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      // Washerwoman sees other Townsfolk: Chef (seat 1), Empath (seat 2)
      // For Chef at seat 1: decoys = seats 2, 3, 4 → 3 pairs
      // For Empath at seat 2: decoys = seats 1, 3, 4 → 3 pairs
      // Total Washerwoman choices = 6
      // Chef count = 1 (seats 3,4 both evil and adjacent) → 1 choice
      // Empath count = 1 (seat 1=Chef=good, seat 3=Poisoner=evil) → 1 choice
      // Total worlds = 6 × 1 × 1 = 6
      expect(zdd.count(result.root)).toBe(6);
    });

    it("handles Washerwoman with only one other Townsfolk", () => {
      // Seats: 0=Washerwoman, 1=Soldier, 2=Butler, 3=Poisoner, 4=Imp
      // Only other Townsfolk: Soldier (seat 1)
      // Decoys for Soldier: seats 2, 3, 4 → 3 pairs
      const seatRoles = makeSeatRoles(
        "Washerwoman", "Soldier", "Butler", "Poisoner", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      const wwRange = result.roleVariableRanges.get("Washerwoman");
      expect(wwRange).toBeDefined();

      // Count worlds from Washerwoman contribution only:
      // 3 Washerwoman choices × 1 Chef (not in play) × 1 Empath (not in play)
      // But Chef and Empath aren't in play, so just the Washerwoman's 3 choices
      expect(zdd.count(result.root)).toBe(3);
    });

    it("generates correct pair outputs", () => {
      const seatRoles = makeSeatRoles(
        "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      // Check that pair outputs exist for Chef and Empath targets
      const wwRange = result.roleVariableRanges.get("Washerwoman")!;
      const wwPairs: Array<{ playerA: number; playerB: number; namedRole: string }> = [];
      for (let vid = wwRange.start; vid < wwRange.start + wwRange.count; vid++) {
        const output = result.pairOutputs.get(vid);
        if (output) wwPairs.push(output);
      }

      // Should have 6 pair outputs
      expect(wwPairs.length).toBe(6);

      // 3 outputs should name "Chef", 3 should name "Empath"
      const chefOutputs = wwPairs.filter((p) => p.namedRole === "Chef");
      const empathOutputs = wwPairs.filter((p) => p.namedRole === "Empath");
      expect(chefOutputs.length).toBe(3);
      expect(empathOutputs.length).toBe(3);

      // All Chef outputs should include seat 1 (the true Chef)
      for (const o of chefOutputs) {
        expect(o.playerA === 1 || o.playerB === 1).toBe(true);
      }
      // All Empath outputs should include seat 2 (the true Empath)
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
      // 5-player: 3 Townsfolk, 0 Outsiders, 1 Minion, 1 Demon
      const seatRoles = makeSeatRoles(
        "Librarian", "Chef", "Empath", "Poisoner", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      const libRange = result.roleVariableRanges.get("Librarian");
      expect(libRange).toBeDefined();
      expect(libRange!.count).toBe(1); // Just the "no outsiders" variable

      // Check the variable description
      const libVar = result.variables.find((v) => v.infoRole === "Librarian");
      expect(libVar).toBeDefined();
      expect(libVar!.description).toBe("No Outsiders in play");
    });

    it("enumerates outsider targets when outsiders are in play", () => {
      // 6-player: 3 Townsfolk, 1 Outsider, 1 Minion, 1 Demon
      const seatRoles = makeSeatRoles(
        "Librarian", "Chef", "Empath", "Butler", "Poisoner", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      const libRange = result.roleVariableRanges.get("Librarian");
      expect(libRange).toBeDefined();

      // Outsider: Butler at seat 3. Decoys: seats 1, 2, 4, 5 (not seat 0=Librarian, not seat 3=Butler)
      // = 4 pairs, all naming "Butler"
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
      // Seats: 0=Investigator, 1=Chef, 2=Empath, 3=Poisoner, 4=Imp
      const seatRoles = makeSeatRoles(
        "Investigator", "Chef", "Empath", "Poisoner", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      const invRange = result.roleVariableRanges.get("Investigator");
      expect(invRange).toBeDefined();

      // Minion: Poisoner at seat 3. Decoys: seats 1, 2, 4 (not 0=Investigator, not 3=Poisoner)
      // = 3 pairs, all naming "Poisoner"
      const invPairs = [];
      for (let vid = invRange!.start; vid < invRange!.start + invRange!.count; vid++) {
        const output = result.pairOutputs.get(vid);
        if (output) invPairs.push(output);
      }
      expect(invPairs.length).toBe(3);
      for (const p of invPairs) {
        expect(p.namedRole).toBe("Poisoner");
        expect(p.playerA === 3 || p.playerB === 3).toBe(true);
      }
    });
  });

  describe("Chef", () => {
    it("counts adjacent evil pairs correctly", () => {
      // Circle: 0=WW, 1=Chef, 2=Empath, 3=Poisoner, 4=Imp
      // Evil: Poisoner(3), Imp(4). Adjacent evil pair: (3,4) → count = 1
      const seatRoles = makeSeatRoles(
        "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      const chefCountVar = findCountInfoVariable(result, "Chef", 1);
      expect(chefCountVar).toBeDefined();

      // Verify that the true count (1) is in the ZDD
      const constrained = zdd.require(result.root, chefCountVar!);
      expect(zdd.count(constrained)).toBeGreaterThan(0);

      // Verify that a wrong count (0) is NOT valid
      const wrongCountVar = findCountInfoVariable(result, "Chef", 0);
      expect(wrongCountVar).toBeDefined();
      const wrongConstrained = zdd.require(result.root, wrongCountVar!);
      expect(zdd.count(wrongConstrained)).toBe(0);
    });

    it("returns 0 when no evil players are adjacent", () => {
      // Circle: 0=WW, 1=Poisoner, 2=Chef, 3=Imp, 4=Empath
      // Evil: Poisoner(1), Imp(3). Not adjacent → count = 0
      const seatRoles = makeSeatRoles(
        "Washerwoman", "Poisoner", "Chef", "Imp", "Empath",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      const count0Var = findCountInfoVariable(result, "Chef", 0);
      expect(count0Var).toBeDefined();

      const constrained = zdd.require(result.root, count0Var!);
      expect(zdd.count(constrained)).toBeGreaterThan(0);

      const count1Var = findCountInfoVariable(result, "Chef", 1);
      const wrongConstrained = zdd.require(result.root, count1Var!);
      expect(zdd.count(wrongConstrained)).toBe(0);
    });

    it("counts multiple adjacent evil pairs", () => {
      // 7-player circle: 0=WW, 1=Chef, 2=Spy, 3=Poisoner, 4=Imp, 5=Empath, 6=Virgin
      // Evil: Spy(2), Poisoner(3), Imp(4). Adjacent pairs: (2,3) and (3,4) → count = 2
      const seatRoles = makeSeatRoles(
        "Washerwoman", "Chef", "Spy", "Poisoner", "Imp", "Empath", "Virgin",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      const count2Var = findCountInfoVariable(result, "Chef", 2);
      expect(count2Var).toBeDefined();

      const constrained = zdd.require(result.root, count2Var!);
      expect(zdd.count(constrained)).toBeGreaterThan(0);
    });
  });

  describe("Empath", () => {
    it("counts evil neighbors correctly (one evil neighbor)", () => {
      // Circle: 0=WW, 1=Chef, 2=Empath, 3=Poisoner, 4=Imp
      // Empath at seat 2. Neighbors: seat 1 (Chef=good), seat 3 (Poisoner=evil)
      // Count = 1
      const seatRoles = makeSeatRoles(
        "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      const count1Var = findCountInfoVariable(result, "Empath", 1);
      expect(count1Var).toBeDefined();

      const constrained = zdd.require(result.root, count1Var!);
      expect(zdd.count(constrained)).toBeGreaterThan(0);

      // Count 0 and 2 should not be valid
      const count0Var = findCountInfoVariable(result, "Empath", 0);
      expect(zdd.count(zdd.require(result.root, count0Var!))).toBe(0);
      const count2Var = findCountInfoVariable(result, "Empath", 2);
      expect(zdd.count(zdd.require(result.root, count2Var!))).toBe(0);
    });

    it("counts zero evil neighbors", () => {
      // Circle: 0=Poisoner, 1=WW, 2=Empath, 3=Chef, 4=Imp
      // Empath at seat 2. Neighbors: seat 1 (WW=good), seat 3 (Chef=good)
      // Count = 0
      const seatRoles = makeSeatRoles(
        "Poisoner", "Washerwoman", "Empath", "Chef", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      const count0Var = findCountInfoVariable(result, "Empath", 0);
      expect(count0Var).toBeDefined();
      expect(zdd.count(zdd.require(result.root, count0Var!))).toBeGreaterThan(0);
    });

    it("counts two evil neighbors", () => {
      // Circle: 0=WW, 1=Poisoner, 2=Empath, 3=Imp, 4=Chef
      // Empath at seat 2. Neighbors: seat 1 (Poisoner=evil), seat 3 (Imp=evil)
      // Count = 2
      const seatRoles = makeSeatRoles(
        "Washerwoman", "Poisoner", "Empath", "Imp", "Chef",
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
      // No info roles at all: Soldier, Virgin, Slayer, Poisoner, Imp
      const seatRoles = makeSeatRoles(
        "Soldier", "Virgin", "Slayer", "Poisoner", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      // No info roles → no variables, root is TOP (one trivial world)
      expect(result.variableCount).toBe(0);
      expect(result.roleVariableRanges.size).toBe(0);
      expect(zdd.count(result.root)).toBe(1);
    });
  });

  describe("combined world count", () => {
    it("cross-products independent info role choices", () => {
      // 7-player: WW(0), Librarian(1), Investigator(2), Chef(3), Empath(4), Poisoner(5), Imp(6)
      // All 5 info roles in play!
      const seatRoles = makeSeatRoles(
        "Washerwoman", "Librarian", "Investigator", "Chef", "Empath",
        "Poisoner", "Imp",
      );
      const zdd = new ZDD();
      const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

      // Washerwoman: other Townsfolk = Librarian(1), Investigator(2), Chef(3), Empath(4)
      // For each target at seat S, decoys = all seats except 0(WW) and S
      // Librarian(1): decoys 2,3,4,5,6 → 5 pairs naming "Librarian"
      // Investigator(2): decoys 1,3,4,5,6 → 5 pairs naming "Investigator"
      // Chef(3): decoys 1,2,4,5,6 → 5 pairs naming "Chef"
      // Empath(4): decoys 1,2,3,5,6 → 5 pairs naming "Empath"
      // Total WW choices = 20

      // Librarian: outsiders = none (7-player base: 0 outsiders) → "No Outsiders" = 1
      // Investigator: minion = Poisoner(5). Decoys: 0,1,3,4,6 (not 2=Inv, not 5=Pois) → 5 pairs
      // Chef: evil = Poisoner(5), Imp(6). Adjacent: (5,6)=yes, (6,0)=no → count=1 → 1 choice
      // Empath: seat 4, neighbors: seat 3 (Chef=good), seat 5 (Poisoner=evil) → count=1 → 1 choice

      // Total = 20 × 1 × 5 × 1 × 1 = 100
      expect(zdd.count(result.root)).toBe(100);
    });
  });
});

// ---------------------------------------------------------------------------
// Lookup helper tests
// ---------------------------------------------------------------------------

describe("findPairInfoVariable", () => {
  it("finds the correct variable for a valid output", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    // "Players 1 and 3 is the Chef" — Chef at seat 1, decoy at seat 3
    const varId = findPairInfoVariable(result, "Washerwoman", 1, 3, "Chef");
    expect(varId).toBeDefined();

    // Verify this variable is in the ZDD
    const constrained = zdd.require(result.root, varId!);
    expect(zdd.count(constrained)).toBeGreaterThan(0);
  });

  it("returns undefined for an invalid output", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    // "Players 3 and 4 is the Chef" — neither seat 3 (Poisoner) nor seat 4 (Imp) is Chef
    const varId = findPairInfoVariable(result, "Washerwoman", 3, 4, "Chef");
    expect(varId).toBeUndefined();
  });

  it("returns undefined for output naming the info role itself", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    // Try to find a variable naming "Washerwoman" — info role can't learn about itself
    const varId = findPairInfoVariable(result, "Washerwoman", 0, 1, "Washerwoman");
    expect(varId).toBeUndefined();
  });

  it("normalizes player order", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    // (3, 1) should find the same as (1, 3)
    const v1 = findPairInfoVariable(result, "Washerwoman", 1, 3, "Chef");
    const v2 = findPairInfoVariable(result, "Washerwoman", 3, 1, "Chef");
    expect(v1).toBe(v2);
  });
});

describe("findCountInfoVariable", () => {
  it("finds Chef count variables", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
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
      "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
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
      "Washerwoman", "Soldier", "Virgin", "Poisoner", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    expect(findCountInfoVariable(result, "Chef", 0)).toBeUndefined();
    expect(findCountInfoVariable(result, "Empath", 0)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Observation / constraint tests
// ---------------------------------------------------------------------------

describe("Night info observations", () => {
  it("requiring a valid Washerwoman output narrows to 1 world per info role", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    // 6 total worlds (6 WW choices × 1 Chef × 1 Empath)
    expect(zdd.count(result.root)).toBe(6);

    // Require "Washerwoman told players 1,3 = Chef"
    const varId = findPairInfoVariable(result, "Washerwoman", 1, 3, "Chef")!;
    const constrained = zdd.require(result.root, varId);

    // Should narrow to exactly 1 world
    expect(zdd.count(constrained)).toBe(1);
  });

  it("requiring a nonexistent variable yields BOTTOM", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    // Use a variable ID way outside the allocated range
    const nonexistentVar = 9999;
    const constrained = zdd.require(result.root, nonexistentVar);
    expect(constrained).toBe(BOTTOM);
  });

  it("excluding a variable removes worlds containing it", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
    );
    const zdd = new ZDD();
    const result = buildNightInfoZDD(zdd, makeConfig(seatRoles));

    expect(zdd.count(result.root)).toBe(6);

    // Exclude one Washerwoman output
    const varId = findPairInfoVariable(result, "Washerwoman", 1, 3, "Chef")!;
    const constrained = zdd.offset(result.root, varId);

    // Should have 5 remaining worlds
    expect(zdd.count(constrained)).toBe(5);
  });

  it("requiring two different WW outputs yields BOTTOM (contradiction)", () => {
    const seatRoles = makeSeatRoles(
      "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
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

// ---------------------------------------------------------------------------
// Game class integration tests
// ---------------------------------------------------------------------------

describe("Game.buildNightInfo", () => {
  /**
   * Helper: set up a 5-player game through distribution → seat assignment,
   * resolve to a specific concrete assignment, then build night info.
   */
  function setupGameWithNightInfo(
    roles: string[],
    seatOrder: string[],
  ): { game: Game; seatAssignment: Map<number, string> } {
    const game = new Game(TROUBLE_BREWING, roles.length);
    game.buildDistribution();

    // Find the distribution containing exactly these roles
    const roleIndices = roles.map((name) =>
      TROUBLE_BREWING.roles.findIndex((r) => r.name === name),
    );
    roleIndices.sort((a, b) => a - b);

    game.buildSeatAssignment(roleIndices);

    // Build the specific seat assignment
    const selectedRoles = game.selectedRoles!;

    // Apply observations to fix each seat to the desired role
    for (let seat = 0; seat < seatOrder.length; seat++) {
      const roleIndex = selectedRoles.indexOf(seatOrder[seat]);
      game.applyObservation({
        kind: "seat-has-role",
        seat,
        roleIndex,
      });
    }
    expect(game.countWorlds()).toBe(1);

    // Enumerate the single remaining assignment and resolve it
    const assignments = game.zdd.enumerate(game.currentRoot);
    expect(assignments.length).toBe(1);
    const seatAssignment = resolveSeatAssignment(
      assignments[0],
      roles.length,
      selectedRoles,
    );

    // Build night info
    game.buildNightInfo(seatAssignment);

    return { game, seatAssignment };
  }

  it("creates a NightInfo phase after seat assignment", () => {
    const { game } = setupGameWithNightInfo(
      ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"],
      ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"],
    );

    expect(game.phaseCount).toBe(3);
    expect(game.currentPhase!.info.type).toBe(PhaseType.NightInfo);
    expect(game.currentPhase!.info.label).toBe("Night 1 Information");
  });

  it("world count matches expected for 5-player setup", () => {
    const { game } = setupGameWithNightInfo(
      ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"],
      ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"],
    );

    // 6 WW choices × 1 Chef × 1 Empath = 6
    expect(game.countWorlds()).toBe(6);
  });

  it("nightInfoResult is accessible", () => {
    const { game } = setupGameWithNightInfo(
      ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"],
      ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"],
    );

    const result = game.nightInfoResult;
    expect(result).toBeDefined();
    expect(result!.roleVariableRanges.has("Washerwoman")).toBe(true);
    expect(result!.roleVariableRanges.has("Chef")).toBe(true);
    expect(result!.roleVariableRanges.has("Empath")).toBe(true);
  });

  it("applying Washerwoman observation constrains the night info ZDD", () => {
    const { game } = setupGameWithNightInfo(
      ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"],
      ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"],
    );

    expect(game.countWorlds()).toBe(6);

    const result = game.nightInfoResult!;
    const varId = findPairInfoVariable(result, "Washerwoman", 1, 3, "Chef")!;

    game.applyObservation({ kind: "require-variable", variable: varId });
    expect(game.countWorlds()).toBe(1);
  });

  it("inconsistent observation produces empty ZDD", () => {
    const { game } = setupGameWithNightInfo(
      ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"],
      ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"],
    );

    // Require a nonexistent variable (no WW output has this ID)
    game.applyObservation({ kind: "require-variable", variable: 9999 });
    expect(game.countWorlds()).toBe(0);
  });

  it("wrong Chef count produces empty ZDD", () => {
    const { game } = setupGameWithNightInfo(
      ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"],
      ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"],
    );

    const result = game.nightInfoResult!;
    // True Chef count is 1 (Poisoner+Imp adjacent). Requiring count=0 should fail.
    const wrongVar = findCountInfoVariable(result, "Chef", 0)!;
    game.applyObservation({ kind: "require-variable", variable: wrongVar });
    expect(game.countWorlds()).toBe(0);
  });

  it("correct Chef count keeps worlds alive", () => {
    const { game } = setupGameWithNightInfo(
      ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"],
      ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"],
    );

    const result = game.nightInfoResult!;
    const correctVar = findCountInfoVariable(result, "Chef", 1)!;
    game.applyObservation({ kind: "require-variable", variable: correctVar });
    // Chef is determined, WW still has 6 choices, Empath still 1 → 6
    expect(game.countWorlds()).toBe(6);
  });

  it("undo removes the night info phase", () => {
    const { game } = setupGameWithNightInfo(
      ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"],
      ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"],
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
});

// ---------------------------------------------------------------------------
// End-to-end: full pipeline test
// ---------------------------------------------------------------------------

describe("end-to-end: distribution → seats → night info", () => {
  it("5-player TB full pipeline with observations", () => {
    const game = new Game(TROUBLE_BREWING, 5);

    // Phase 1: distribution
    game.buildDistribution();
    expect(game.countWorlds()).toBe(858);

    // Find distribution: Washerwoman, Chef, Empath, Poisoner, Imp
    const wwIdx = TROUBLE_BREWING.roles.findIndex((r) => r.name === "Washerwoman");
    const chefIdx = TROUBLE_BREWING.roles.findIndex((r) => r.name === "Chef");
    const empIdx = TROUBLE_BREWING.roles.findIndex((r) => r.name === "Empath");
    const poisIdx = TROUBLE_BREWING.roles.findIndex((r) => r.name === "Poisoner");
    const impIdx = TROUBLE_BREWING.roles.findIndex((r) => r.name === "Imp");
    const distVars = [wwIdx, chefIdx, empIdx, poisIdx, impIdx].sort((a, b) => a - b);

    // Phase 2: seat assignment
    game.buildSeatAssignment(distVars);
    expect(game.countWorlds()).toBe(120); // 5!

    // Fix assignment: seat 0=WW, 1=Chef, 2=Empath, 3=Poisoner, 4=Imp
    const selectedRoles = game.selectedRoles!;
    for (let seat = 0; seat < 5; seat++) {
      const desiredRole = ["Washerwoman", "Chef", "Empath", "Poisoner", "Imp"][seat];
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
    expect(seatAssignment.get(3)).toBe("Poisoner");

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
});
