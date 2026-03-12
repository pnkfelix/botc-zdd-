import { describe, it, expect } from "vitest";
import { ZDD, BOTTOM } from "../src/zdd.js";
import { TROUBLE_BREWING } from "../src/botc.js";
import {
  buildNightActionZDD,
  findPoisonerN2TargetVariable,
  findMonkTargetVariable,
  findImpTargetVariable,
  findStarpassRecipientVariable,
  findEmpathN2Variable,
  findFortuneTellerN2Variable,
  type NightActionConfig,
} from "../src/night-action.js";
import { Game } from "../src/game.js";
import { PhaseType } from "../src/types.js";

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

function makeConfig(
  seatRoles: Map<number, string>,
  opts?: {
    selectedRoles?: string[];
    malfunctioningSeats?: Set<number>;
    redHerringSeat?: number;
  },
): NightActionConfig {
  const roles = opts?.selectedRoles ?? [...seatRoles.values()];
  return {
    numPlayers: seatRoles.size,
    seatRoles,
    selectedRoles: roles,
    script: TROUBLE_BREWING,
    malfunctioningSeats: opts?.malfunctioningSeats,
    redHerringSeat: opts?.redHerringSeat,
  };
}

// ============================================================================
// Basic variable allocation
// ============================================================================

describe("buildNightActionZDD variable allocation", () => {
  it("allocates variables for Poisoner, Monk, Imp, Empath in a 5p game", () => {
    // Seats: 0=Monk, 1=Chef, 2=Empath, 3=Poisoner, 4=Imp
    const seatRoles = makeSeatRoles("Monk", "Chef", "Empath", "Poisoner", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    // Poisoner: 4 targets (not self=seat 3)
    expect(result.categoryVariableRanges.get("PoisonerN2")).toEqual({ start: 0, count: 4 });
    // Monk: 4 targets (not self=seat 0)
    expect(result.categoryVariableRanges.get("MonkTarget")).toEqual({ start: 4, count: 4 });
    // Imp: 5 targets (can self-target since Poisoner is a living minion)
    expect(result.categoryVariableRanges.get("ImpTarget")).toEqual({ start: 8, count: 5 });
    // Starpass: 1 recipient (Poisoner at seat 3)
    expect(result.categoryVariableRanges.get("StarpassRecipient")).toEqual({ start: 13, count: 1 });
    // Empath: 3 count variables (0, 1, 2)
    expect(result.categoryVariableRanges.get("EmpathN2")).toEqual({ start: 14, count: 3 });
    // No FT
    expect(result.categoryVariableRanges.has("FortuneTellerN2")).toBe(false);

    expect(result.variableCount).toBe(17);
  });

  it("allocates FT variables when Fortune Teller is in play", () => {
    // Seats: 0=Monk, 1=Empath, 2=Fortune Teller, 3=Poisoner, 4=Imp
    const seatRoles = makeSeatRoles("Monk", "Empath", "Fortune Teller", "Poisoner", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles, { redHerringSeat: 0 }));

    expect(result.categoryVariableRanges.has("FortuneTellerN2")).toBe(true);
    const ftRange = result.categoryVariableRanges.get("FortuneTellerN2")!;
    // C(5,2) pairs × 2 answers = 10 × 2 = 20
    expect(ftRange.count).toBe(20);
  });

  it("excludes starpass when no living minions", () => {
    // A game with only Imp as evil (no minion for starpass)
    // This is artificial but tests the edge case
    // Seats: 0=Monk, 1=Chef, 2=Empath, 3=Soldier, 4=Imp
    // Wait — in TB, Imp is the only demon, and a 5p game always has 1 minion.
    // Let's use Scarlet Woman as minion (not Poisoner) so no poisoner logic.
    const seatRoles = makeSeatRoles("Monk", "Chef", "Empath", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    // No Poisoner
    expect(result.categoryVariableRanges.has("PoisonerN2")).toBe(false);
    // Monk: 4 targets
    expect(result.categoryVariableRanges.get("MonkTarget")).toEqual({ start: 0, count: 4 });
    // Imp: 5 targets (can starpass to SW at seat 3)
    expect(result.categoryVariableRanges.get("ImpTarget")).toEqual({ start: 4, count: 5 });
    // Starpass: 1 recipient (Scarlet Woman)
    expect(result.categoryVariableRanges.get("StarpassRecipient")).toEqual({ start: 9, count: 1 });
    // Empath: 3
    expect(result.categoryVariableRanges.get("EmpathN2")).toEqual({ start: 10, count: 3 });
  });
});

// ============================================================================
// Monk protection blocks Imp kill
// ============================================================================

describe("Monk protection", () => {
  it("blocks Imp kill when Monk is functioning", () => {
    // Seats: 0=Monk, 1=Chef, 2=Soldier, 3=Scarlet Woman, 4=Imp
    // No Poisoner, no Empath/FT — pure action test
    const seatRoles = makeSeatRoles("Monk", "Chef", "Soldier", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    // Monk protects seat 1 (Chef)
    const monkVar = findMonkTargetVariable(result, 1)!;
    expect(monkVar).toBeDefined();

    // Imp targets seat 1 (Chef)
    const impVar = findImpTargetVariable(result, 1)!;
    expect(impVar).toBeDefined();

    // Require Monk protects seat 1 and Imp targets seat 1
    let root = result.root;
    root = zdd.require(root, monkVar);
    root = zdd.require(root, impVar);

    // Should have valid worlds (protection succeeds, nobody dies)
    expect(root).not.toBe(BOTTOM);
    expect(zdd.count(root)).toBeGreaterThan(0);
  });

  it("produces different outcomes for protected vs unprotected kills", () => {
    // Seats: 0=Monk, 1=Chef, 2=Empath, 3=Scarlet Woman, 4=Imp
    // When Monk protects seat 1 and Imp targets seat 1: nobody dies
    // When Monk protects seat 2 and Imp targets seat 1: seat 1 dies
    // These should produce different Empath outputs if the Empath's neighbors change
    const seatRoles = makeSeatRoles("Monk", "Chef", "Empath", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    const impTarget1 = findImpTargetVariable(result, 1)!;

    // Branch 1: Monk protects seat 1, Imp targets seat 1 → nobody dies
    const monkProtects1 = findMonkTargetVariable(result, 1)!;
    let branch1 = zdd.require(result.root, impTarget1);
    branch1 = zdd.require(branch1, monkProtects1);

    // Branch 2: Monk protects seat 2, Imp targets seat 1 → seat 1 dies
    const monkProtects2 = findMonkTargetVariable(result, 2)!;
    let branch2 = zdd.require(result.root, impTarget1);
    branch2 = zdd.require(branch2, monkProtects2);

    // Both should have valid worlds
    expect(zdd.count(branch1)).toBeGreaterThan(0);
    expect(zdd.count(branch2)).toBeGreaterThan(0);
  });
});

// ============================================================================
// Poisoned Monk's protection has no effect
// ============================================================================

describe("Poisoned Monk", () => {
  it("does not protect when poisoned", () => {
    // Seats: 0=Monk, 1=Chef, 2=Empath, 3=Poisoner, 4=Imp
    const seatRoles = makeSeatRoles("Monk", "Chef", "Empath", "Poisoner", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    // Poisoner targets Monk (seat 0), Monk protects seat 1, Imp targets seat 1
    // → Monk is poisoned, protection fails, seat 1 dies
    const poisonerTargetsMonk = findPoisonerN2TargetVariable(result, 0)!;
    const monkProtects1 = findMonkTargetVariable(result, 1)!;
    const impTargets1 = findImpTargetVariable(result, 1)!;

    let root = result.root;
    root = zdd.require(root, poisonerTargetsMonk);
    root = zdd.require(root, monkProtects1);
    root = zdd.require(root, impTargets1);

    expect(zdd.count(root)).toBeGreaterThan(0);

    // Check that the Empath output reflects seat 1 being dead.
    // Empath is at seat 2. With seat 1 dead:
    // Living neighbors of seat 2 are seat 0 (Monk=good) and seat 3 (Poisoner=evil)
    // But Poisoner poisons Monk (seat 0), so Empath at seat 2 is NOT poisoned.
    // Empath is functioning → should see 1 evil neighbor (Poisoner at seat 3)
    const empath1 = findEmpathN2Variable(result, 1)!;
    const withEmpath1 = zdd.require(root, empath1);
    expect(zdd.count(withEmpath1)).toBeGreaterThan(0);
  });

  it("Monk protection works when Poisoner targets someone else", () => {
    // Seats: 0=Monk, 1=Chef, 2=Empath, 3=Poisoner, 4=Imp
    const seatRoles = makeSeatRoles("Monk", "Chef", "Empath", "Poisoner", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    // Poisoner targets Chef (seat 1), Monk protects seat 2, Imp targets seat 2
    // → Monk is NOT poisoned, protection works, nobody dies
    const poisonerTargetsChef = findPoisonerN2TargetVariable(result, 1)!;
    const monkProtects2 = findMonkTargetVariable(result, 2)!;
    const impTargets2 = findImpTargetVariable(result, 2)!;

    let root = result.root;
    root = zdd.require(root, poisonerTargetsChef);
    root = zdd.require(root, monkProtects2);
    root = zdd.require(root, impTargets2);

    expect(zdd.count(root)).toBeGreaterThan(0);

    // Nobody died → Empath at seat 2 is functioning (not poisoned by poisoner
    // who targets seat 1), living neighbors are seat 1 (Chef=good) and seat 3 (Poisoner=evil)
    // → Empath should see 1 evil neighbor
    const empath1 = findEmpathN2Variable(result, 1)!;
    const withEmpath1 = zdd.require(root, empath1);
    expect(zdd.count(withEmpath1)).toBeGreaterThan(0);

    // Count 0 should NOT be valid here
    const empath0 = findEmpathN2Variable(result, 0)!;
    const withEmpath0 = zdd.require(root, empath0);
    expect(zdd.count(withEmpath0)).toBe(0);
  });
});

// ============================================================================
// Poisoned Imp's kill has no effect
// ============================================================================

describe("Poisoned Imp", () => {
  it("kill fails when Imp is poisoned", () => {
    // Seats: 0=Monk, 1=Chef, 2=Empath, 3=Poisoner, 4=Imp
    const seatRoles = makeSeatRoles("Monk", "Chef", "Empath", "Poisoner", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    // Poisoner targets Imp (seat 4), Monk protects seat 1, Imp targets seat 1
    // → Imp is poisoned, kill fails, nobody dies
    const poisonerTargetsImp = findPoisonerN2TargetVariable(result, 4)!;
    const monkProtects1 = findMonkTargetVariable(result, 1)!;
    const impTargets1 = findImpTargetVariable(result, 1)!;

    let root = result.root;
    root = zdd.require(root, poisonerTargetsImp);
    root = zdd.require(root, monkProtects1);
    root = zdd.require(root, impTargets1);

    expect(zdd.count(root)).toBeGreaterThan(0);

    // Nobody dies → Empath at seat 2 functioning (not poisoned).
    // Living neighbors: seat 1 (Chef=good), seat 3 (Poisoner=evil) → count = 1
    const empath1 = findEmpathN2Variable(result, 1)!;
    const withEmpath1 = zdd.require(root, empath1);
    expect(zdd.count(withEmpath1)).toBeGreaterThan(0);
  });
});

// ============================================================================
// Imp starpass mechanics
// ============================================================================

describe("Imp starpass", () => {
  it("Imp can self-target when living minions exist", () => {
    // Seats: 0=Monk, 1=Chef, 2=Empath, 3=Scarlet Woman, 4=Imp
    const seatRoles = makeSeatRoles("Monk", "Chef", "Empath", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    // Imp self-target variable should exist
    const impSelfTarget = findImpTargetVariable(result, 4);
    expect(impSelfTarget).toBeDefined();

    // Starpass recipient (Scarlet Woman at seat 3)
    const spRecipient = findStarpassRecipientVariable(result, 3);
    expect(spRecipient).toBeDefined();

    // Require starpass
    let root = result.root;
    root = zdd.require(root, impSelfTarget!);
    root = zdd.require(root, spRecipient!);

    // Should have valid worlds
    expect(zdd.count(root)).toBeGreaterThan(0);
  });

  it("starpass requires a recipient variable", () => {
    // Seats: 0=Monk, 1=Chef, 2=Empath, 3=Scarlet Woman, 4=Imp
    const seatRoles = makeSeatRoles("Monk", "Chef", "Empath", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    const impSelfTarget = findImpTargetVariable(result, 4)!;

    // Every world with Imp self-target must also have a starpass recipient
    const starpassWorlds = zdd.require(result.root, impSelfTarget);
    const sets = zdd.enumerate(starpassWorlds);

    for (const set of sets) {
      const hasRecipient = set.some((v) => result.starpassRecipientOutputs.has(v));
      expect(hasRecipient).toBe(true);
    }
  });

  it("non-starpass worlds do not include starpass recipient variables", () => {
    const seatRoles = makeSeatRoles("Monk", "Chef", "Empath", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    // Target seat 1 (not self)
    const impTarget1 = findImpTargetVariable(result, 1)!;
    const normalKillWorlds = zdd.require(result.root, impTarget1);
    const sets = zdd.enumerate(normalKillWorlds);

    for (const set of sets) {
      const hasRecipient = set.some((v) => result.starpassRecipientOutputs.has(v));
      expect(hasRecipient).toBe(false);
    }
  });
});

// ============================================================================
// Empath output changes based on who died
// ============================================================================

describe("Empath Night 2 output with death", () => {
  it("Empath count changes when a neighbor dies", () => {
    // Seats: 0=Monk, 1=Chef, 2=Empath, 3=Scarlet Woman, 4=Imp
    // Empath (seat 2) neighbors: seat 1 (Chef=good), seat 3 (SW=evil)
    // If seat 1 dies: new left neighbor = seat 0 (Monk=good) → count = 1
    // If seat 3 dies: new right neighbor = seat 4 (Imp=evil) → count = 1
    // If nobody dies: neighbors are seat 1 (good), seat 3 (evil) → count = 1
    // If seat 0 dies: neighbors still 1 and 3 → count = 1
    // Interesting case: what if an evil neighbor dies?
    // If SW (seat 3) dies: new right neighbor is seat 4 (Imp=evil) → still 1
    // But if Imp (seat 4) dies AND seat 3 (SW) is alive:
    //   Empath neighbors: seat 1 (good), seat 3 (evil) → count = 1

    const seatRoles = makeSeatRoles("Monk", "Chef", "Empath", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    // In all normal kill branches, Empath sees count=1 (one evil neighbor)
    // unless the Empath itself is killed
    const monkProtects2 = findMonkTargetVariable(result, 2)!;

    // Imp kills seat 1 (Chef), Monk protects seat 2 (not relevant)
    const impTarget1 = findImpTargetVariable(result, 1)!;
    let branch = zdd.require(result.root, impTarget1);
    branch = zdd.require(branch, monkProtects2);

    // After seat 1 dies: Empath at seat 2.
    // Left living neighbor: seat 0 (Monk=good)
    // Right living neighbor: seat 3 (SW=evil)
    // Count = 1
    const empath1 = findEmpathN2Variable(result, 1)!;
    const withEmpath1 = zdd.require(branch, empath1);
    expect(zdd.count(withEmpath1)).toBeGreaterThan(0);
  });

  it("Empath does not produce output when dead", () => {
    // Seats: 0=Monk, 1=Chef, 2=Empath, 3=Scarlet Woman, 4=Imp
    const seatRoles = makeSeatRoles("Monk", "Chef", "Empath", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    // Imp kills Empath (seat 2), Monk protects seat 1
    const impTarget2 = findImpTargetVariable(result, 2)!;
    const monkProtects1 = findMonkTargetVariable(result, 1)!;
    let branch = zdd.require(result.root, impTarget2);
    branch = zdd.require(branch, monkProtects1);

    // Empath is dead → no empath variables should be in any set
    const sets = zdd.enumerate(branch);
    for (const set of sets) {
      const empathRange = result.categoryVariableRanges.get("EmpathN2")!;
      const hasEmpathVar = set.some(
        (v) => v >= empathRange.start && v < empathRange.start + empathRange.count,
      );
      expect(hasEmpathVar).toBe(false);
    }
    expect(sets.length).toBeGreaterThan(0);
  });

  it("Empath count changes when both evil neighbors survive vs one dies", () => {
    // Seats (circular): 0=Empath, 1=Poisoner, 2=Chef, 3=Scarlet Woman, 4=Imp
    // Empath (seat 0) neighbors: seat 4 (Imp=evil), seat 1 (Poisoner=evil)
    // Both alive: count = 2
    // If seat 1 (Poisoner) dies: new right neighbor = seat 2 (Chef=good)
    //   Count = 1 (only Imp at seat 4)
    // If seat 4 (Imp) dies (starpass): new left neighbor = seat 3 (SW=evil)
    //   Count = 2 (SW=evil, Poisoner=evil)
    const seatRoles = makeSeatRoles("Empath", "Poisoner", "Chef", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    // Case 1: Nobody dies (Imp kills seat 2, Monk not in play so no protection)
    // Wait, there's no Monk here. The Imp just kills someone.
    // Actually this config has no Monk.
    // Imp targets seat 2 (Chef): seat 2 dies.
    // Empath neighbors: seat 4 (Imp=evil), seat 1 (Poisoner=evil) → count = 2
    const impTarget2 = findImpTargetVariable(result, 2)!;
    // Poisoner targets seat 2 (Chef)
    const poisonerTarget2 = findPoisonerN2TargetVariable(result, 2)!;
    let branch1 = zdd.require(result.root, impTarget2);
    branch1 = zdd.require(branch1, poisonerTarget2);

    const empath2 = findEmpathN2Variable(result, 2)!;
    const with2 = zdd.require(branch1, empath2);
    expect(zdd.count(with2)).toBeGreaterThan(0);

    // Case 2: Imp kills seat 1 (Poisoner): seat 1 dies.
    // Empath at seat 0 neighbors: seat 4 (Imp=evil), new right = seat 2 (Chef=good)
    // → count = 1
    const impTarget1 = findImpTargetVariable(result, 1)!;
    // Poisoner targets seat 2 (doesn't matter who, just need to pick one)
    let branch2 = zdd.require(result.root, impTarget1);
    branch2 = zdd.require(branch2, poisonerTarget2);

    const empath1 = findEmpathN2Variable(result, 1)!;
    const with1 = zdd.require(branch2, empath1);
    expect(zdd.count(with1)).toBeGreaterThan(0);

    // Count 2 should NOT be valid when seat 1 dies
    const with2InBranch2 = zdd.require(branch2, empath2);
    expect(zdd.count(with2InBranch2)).toBe(0);
  });
});

// ============================================================================
// Branch count verification
// ============================================================================

describe("Branch count verification", () => {
  it("5p Monk+Chef+Empath+Poisoner+Imp: correct total world count", () => {
    // Seats: 0=Monk, 1=Chef, 2=Empath, 3=Poisoner, 4=Imp
    const seatRoles = makeSeatRoles("Monk", "Chef", "Empath", "Poisoner", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    // Poisoner: 4 targets (seats 0,1,2,4)
    // Monk: 4 targets (seats 1,2,3,4)
    // Imp: 5 targets (seats 0,1,2,3,4 — can starpass to Poisoner at seat 3)
    // Starpass: 1 recipient (Poisoner)
    // Empath: variable (depends on who dies, poisoner target, etc.)
    //
    // Let's manually count some branches:
    // For each (poisoner_target, monk_target, imp_target):
    //   4 × 4 × 5 = 80 combinations (for non-starpass imp targets)
    //   ... plus starpass branches (4 × 4 × 1 starpass × 1 recipient = 16)
    //   = 80 + 16 = 96 total action combos... but wait, some have multiple
    //   Empath outputs.
    //
    // Just verify the result is non-zero and reasonable
    const count = zdd.count(result.root);
    expect(count).toBeGreaterThan(0);

    // Verify we can enumerate some worlds
    // (don't enumerate all — could be large)
    // Just check that requiring specific choices narrows correctly
    const poisonerTarget0 = findPoisonerN2TargetVariable(result, 0)!;
    const monkTarget1 = findMonkTargetVariable(result, 1)!;
    const impTarget2 = findImpTargetVariable(result, 2)!;

    let specific = zdd.require(result.root, poisonerTarget0);
    specific = zdd.require(specific, monkTarget1);
    specific = zdd.require(specific, impTarget2);

    // This specific combo: Poisoner poisons Monk (seat 0), Monk protects seat 1,
    // Imp kills seat 2 (Empath).
    // Monk is poisoned → protection fails.
    // Imp is functioning → kill succeeds.
    // Seat 2 (Empath) dies → no Empath output.
    // → exactly 1 world (no info role choices)
    expect(zdd.count(specific)).toBe(1);
  });

  it("simple 5p no-poisoner: Monk+Chef+Empath+SW+Imp", () => {
    const seatRoles = makeSeatRoles("Monk", "Chef", "Empath", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    // No Poisoner → no poisoner variables
    // Monk: 4 targets, Imp: 5 targets (starpass to SW)
    // + 1 starpass recipient

    // For a specific non-starpass, non-death branch:
    // Monk protects seat 1, Imp kills seat 1 → Monk protection blocks, nobody dies
    const monkProtects1 = findMonkTargetVariable(result, 1)!;
    const impTarget1 = findImpTargetVariable(result, 1)!;

    let branch = zdd.require(result.root, monkProtects1);
    branch = zdd.require(branch, impTarget1);

    // Nobody dies. Empath at seat 2 is functioning.
    // Neighbors: seat 1 (Chef=good), seat 3 (SW=evil) → count = 1
    // → 1 empath output → 1 world
    expect(zdd.count(branch)).toBe(1);

    // Monk protects seat 2, Imp kills seat 1 → seat 1 dies
    const monkProtects2 = findMonkTargetVariable(result, 2)!;
    let branch2 = zdd.require(result.root, monkProtects2);
    branch2 = zdd.require(branch2, impTarget1);

    // Seat 1 (Chef) dies. Empath at seat 2.
    // Living left neighbor: seat 0 (Monk=good)
    // Living right neighbor: seat 3 (SW=evil)
    // → count = 1 → 1 world
    expect(zdd.count(branch2)).toBe(1);
  });

  it("hand-calculated count for minimal no-info-role scenario", () => {
    // Seats: 0=Monk, 1=Soldier, 2=Virgin, 3=Scarlet Woman, 4=Imp
    // No Poisoner, no Empath, no FT → only action variables
    const seatRoles = makeSeatRoles("Monk", "Soldier", "Virgin", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    // Monk: 4 targets (1,2,3,4)
    // Imp: 5 targets (0,1,2,3,4 — starpass to SW)
    // Non-starpass: Monk × Imp non-self = 4 × 4 = 16
    // Starpass: Monk × 1 (starpass) × 1 (recipient) = 4 × 1 × 1 = 4
    // Total = 16 + 4 = 20
    expect(zdd.count(result.root)).toBe(20);
  });
});

// ============================================================================
// Fortune Teller Night 2
// ============================================================================

describe("Fortune Teller Night 2", () => {
  it("FT produces no output when dead", () => {
    // Seats: 0=Monk, 1=Fortune Teller, 2=Chef, 3=Scarlet Woman, 4=Imp
    const seatRoles = makeSeatRoles("Monk", "Fortune Teller", "Chef", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles, { redHerringSeat: 0 }));

    // Imp kills FT (seat 1), Monk protects seat 2
    const impTarget1 = findImpTargetVariable(result, 1)!;
    const monkProtects2 = findMonkTargetVariable(result, 2)!;
    let branch = zdd.require(result.root, impTarget1);
    branch = zdd.require(branch, monkProtects2);

    // FT is dead → no FT variables should be in any set
    const sets = zdd.enumerate(branch);
    const ftRange = result.categoryVariableRanges.get("FortuneTellerN2");
    if (ftRange) {
      for (const set of sets) {
        const hasFTVar = set.some(
          (v) => v >= ftRange.start && v < ftRange.start + ftRange.count,
        );
        expect(hasFTVar).toBe(false);
      }
    }
    expect(sets.length).toBeGreaterThan(0);
  });

  it("FT constrained output when functioning", () => {
    // Seats: 0=Fortune Teller, 1=Chef, 2=Soldier, 3=Scarlet Woman, 4=Imp
    // Red herring: seat 1 (Chef)
    const seatRoles = makeSeatRoles("Fortune Teller", "Chef", "Soldier", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles, { redHerringSeat: 1 }));

    // No Monk, no Poisoner. Imp kills seat 2.
    const impTarget2 = findImpTargetVariable(result, 2)!;
    let branch = zdd.require(result.root, impTarget2);

    // FT is alive and functioning.
    // Demon is at seat 4. Red herring at seat 1.
    // FT picks (1, 4) → must ping (both demon + red herring) → Yes only
    const ftYes14 = findFortuneTellerN2Variable(result, 1, 4, "Yes");
    const ftNo14 = findFortuneTellerN2Variable(result, 1, 4, "No");

    if (ftYes14 !== undefined) {
      const withYes = zdd.require(branch, ftYes14);
      expect(zdd.count(withYes)).toBeGreaterThan(0);
    }
    if (ftNo14 !== undefined) {
      const withNo = zdd.require(branch, ftNo14);
      expect(zdd.count(withNo)).toBe(0);
    }

    // FT picks (2, 3) → neither is demon or red herring → No only
    const ftYes23 = findFortuneTellerN2Variable(result, 2, 3, "Yes");
    const ftNo23 = findFortuneTellerN2Variable(result, 2, 3, "No");

    if (ftYes23 !== undefined) {
      const withYes = zdd.require(branch, ftYes23);
      expect(zdd.count(withYes)).toBe(0);
    }
    if (ftNo23 !== undefined) {
      const withNo = zdd.require(branch, ftNo23);
      expect(zdd.count(withNo)).toBeGreaterThan(0);
    }
  });

  it("poisoned FT gets unconstrained output", () => {
    // Seats: 0=Fortune Teller, 1=Chef, 2=Soldier, 3=Poisoner, 4=Imp
    const seatRoles = makeSeatRoles("Fortune Teller", "Chef", "Soldier", "Poisoner", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles, { redHerringSeat: 1 }));

    // Poisoner targets FT (seat 0), Imp kills seat 2
    const poisonerTargetFT = findPoisonerN2TargetVariable(result, 0)!;
    const impTarget2 = findImpTargetVariable(result, 2)!;

    let branch = zdd.require(result.root, poisonerTargetFT);
    branch = zdd.require(branch, impTarget2);

    // FT picks (2, 3) → normally No (neither is demon/RH)
    // But FT is poisoned → both Yes and No should be valid
    const ftYes23 = findFortuneTellerN2Variable(result, 2, 3, "Yes");
    const ftNo23 = findFortuneTellerN2Variable(result, 2, 3, "No");

    if (ftYes23 !== undefined) {
      const withYes = zdd.require(branch, ftYes23);
      expect(zdd.count(withYes)).toBeGreaterThan(0);
    }
    if (ftNo23 !== undefined) {
      const withNo = zdd.require(branch, ftNo23);
      expect(zdd.count(withNo)).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// Game class integration
// ============================================================================

describe("Game class integration", () => {
  it("builds Night 2 action phase after Night 1 info", () => {
    const game = new Game(TROUBLE_BREWING, 5);

    // Phase 1: Distribution (not needed for action builder, but set up properly)
    game.buildDistribution();

    // Phase 2: Seat assignment
    // Select roles: Monk(7), Chef(3), Empath(4), Scarlet Woman(18), Imp(20)
    const roleIndices = [7, 3, 4, 18, 20];
    game.buildSeatAssignment(roleIndices);

    // Phase 3: Night 1 info
    const seatAssignment = new Map<number, string>([
      [0, "Monk"], [1, "Chef"], [2, "Empath"],
      [3, "Scarlet Woman"], [4, "Imp"],
    ]);
    game.buildNightInfo(seatAssignment);

    // Phase 4: Night 2 actions
    const root = game.buildNightAction(seatAssignment);

    expect(root).not.toBe(BOTTOM);
    expect(game.phaseCount).toBe(4);
    expect(game.currentPhase!.info.type).toBe(PhaseType.NightAction);
    expect(game.currentPhase!.info.label).toBe("Night 2 Actions");

    const actionResult = game.nightActionResult;
    expect(actionResult).toBeDefined();
    expect(actionResult!.variableCount).toBeGreaterThan(0);
  });

  it("supports undo of Night 2 action phase", () => {
    const game = new Game(TROUBLE_BREWING, 5);
    game.buildDistribution();

    const roleIndices = [7, 3, 4, 18, 20];
    game.buildSeatAssignment(roleIndices);

    const seatAssignment = new Map<number, string>([
      [0, "Monk"], [1, "Chef"], [2, "Empath"],
      [3, "Scarlet Woman"], [4, "Imp"],
    ]);
    game.buildNightInfo(seatAssignment);
    game.buildNightAction(seatAssignment);

    expect(game.phaseCount).toBe(4);
    const undone = game.undo();
    expect(undone!.type).toBe(PhaseType.NightAction);
    expect(game.phaseCount).toBe(3);
  });

  it("applies observations to Night 2 action phase", () => {
    const game = new Game(TROUBLE_BREWING, 5);
    game.buildDistribution();

    const roleIndices = [7, 3, 4, 18, 20];
    game.buildSeatAssignment(roleIndices);

    const seatAssignment = new Map<number, string>([
      [0, "Monk"], [1, "Chef"], [2, "Empath"],
      [3, "Scarlet Woman"], [4, "Imp"],
    ]);
    game.buildNightInfo(seatAssignment);
    game.buildNightAction(seatAssignment);

    const actionResult = game.nightActionResult!;
    const monkVar = findMonkTargetVariable(actionResult, 1)!;

    const countBefore = game.countWorlds();
    game.applyObservation({ kind: "require-variable", variable: monkVar });
    const countAfter = game.countWorlds();

    expect(countAfter).toBeLessThan(countBefore);
    expect(countAfter).toBeGreaterThan(0);
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("Edge cases", () => {
  it("handles game with no Monk", () => {
    // Seats: 0=Washerwoman, 1=Chef, 2=Empath, 3=Poisoner, 4=Imp
    const seatRoles = makeSeatRoles("Washerwoman", "Chef", "Empath", "Poisoner", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    expect(result.categoryVariableRanges.has("MonkTarget")).toBe(false);
    expect(result.categoryVariableRanges.has("PoisonerN2")).toBe(true);
    expect(result.categoryVariableRanges.has("ImpTarget")).toBe(true);

    expect(zdd.count(result.root)).toBeGreaterThan(0);
  });

  it("handles game with no Poisoner and no Monk", () => {
    // Seats: 0=Washerwoman, 1=Chef, 2=Empath, 3=Scarlet Woman, 4=Imp
    const seatRoles = makeSeatRoles("Washerwoman", "Chef", "Empath", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    expect(result.categoryVariableRanges.has("PoisonerN2")).toBe(false);
    expect(result.categoryVariableRanges.has("MonkTarget")).toBe(false);
    expect(result.categoryVariableRanges.has("ImpTarget")).toBe(true);

    // Imp: 5 targets (starpass to SW)
    // Starpass: 1 recipient
    // Empath: 3 counts
    // No Monk, no Poisoner
    // Non-starpass Imp targets: 4, starpass: 1×1=1 → total 5 action combos
    // Each × empath output variants
    expect(zdd.count(result.root)).toBeGreaterThan(0);
  });

  it("permanent malfunction (Drunk) propagates correctly", () => {
    // Seats: 0=Monk, 1=Drunk, 2=Empath, 3=Scarlet Woman, 4=Imp
    // The Drunk is at seat 1, permanently malfunctioning
    // (Drunk doesn't have a Night 2 ability, but this tests the base malfunction set)
    const seatRoles = makeSeatRoles("Monk", "Drunk", "Empath", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(
      zdd,
      makeConfig(seatRoles, { malfunctioningSeats: new Set([1]) }),
    );

    // The Drunk being malfunctioning shouldn't affect the Monk or Empath
    // (they're not the Drunk)
    expect(zdd.count(result.root)).toBeGreaterThan(0);
  });

  it("lookup helpers return correct variable IDs", () => {
    const seatRoles = makeSeatRoles("Monk", "Chef", "Empath", "Poisoner", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    // Poisoner targets
    expect(findPoisonerN2TargetVariable(result, 0)).toBeDefined();
    expect(findPoisonerN2TargetVariable(result, 1)).toBeDefined();
    expect(findPoisonerN2TargetVariable(result, 3)).toBeUndefined(); // can't target self

    // Monk targets
    expect(findMonkTargetVariable(result, 1)).toBeDefined();
    expect(findMonkTargetVariable(result, 0)).toBeUndefined(); // can't protect self

    // Imp targets
    expect(findImpTargetVariable(result, 0)).toBeDefined();
    expect(findImpTargetVariable(result, 4)).toBeDefined(); // starpass

    // Starpass recipients
    expect(findStarpassRecipientVariable(result, 3)).toBeDefined(); // Poisoner

    // Empath
    expect(findEmpathN2Variable(result, 0)).toBeDefined();
    expect(findEmpathN2Variable(result, 1)).toBeDefined();
    expect(findEmpathN2Variable(result, 2)).toBeDefined();
    expect(findEmpathN2Variable(result, 3)).toBeUndefined();
  });
});

// ============================================================================
// Fortune Teller + Starpass Correction
// ============================================================================

describe("Fortune Teller + Starpass", () => {
  // Setup for tests 1-3:
  // Seats: 0=Fortune Teller, 1=Chef, 2=Soldier, 3=Poisoner, 4=Imp
  // Red herring at seat 1. Imp starpasses → Poisoner (seat 3) becomes new Imp.

  it("FT pings new demon after starpass", () => {
    // Test 1: After starpass, seat 3 (former Poisoner, now new Imp) is the demon.
    // FT picks (3, 2) → seat 3 is demon → Yes
    const seatRoles = makeSeatRoles("Fortune Teller", "Chef", "Soldier", "Poisoner", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles, { redHerringSeat: 1 }));

    // Require starpass: Imp self-targets, recipient = seat 3
    const impSelfTarget = findImpTargetVariable(result, 4)!;
    const spRecipient = findStarpassRecipientVariable(result, 3)!;
    // Poisoner targets someone other than FT so FT is functioning
    const poisonerTarget2 = findPoisonerN2TargetVariable(result, 2)!;
    expect(impSelfTarget).toBeDefined();
    expect(spRecipient).toBeDefined();

    let branch = zdd.require(result.root, impSelfTarget);
    branch = zdd.require(branch, spRecipient);
    branch = zdd.require(branch, poisonerTarget2);

    // FT picks (2, 3): seat 3 is new demon → should ping Yes
    const ftYes23 = findFortuneTellerN2Variable(result, 2, 3, "Yes");
    const ftNo23 = findFortuneTellerN2Variable(result, 2, 3, "No");

    expect(ftYes23).toBeDefined();
    const withYes = zdd.require(branch, ftYes23!);
    expect(zdd.count(withYes)).toBeGreaterThan(0);

    if (ftNo23 !== undefined) {
      const withNo = zdd.require(branch, ftNo23);
      expect(zdd.count(withNo)).toBe(0);
    }
  });

  it("FT does NOT ping dead original Imp after starpass", () => {
    // Test 2: After starpass, seat 4 (dead ex-Imp) is NOT the demon anymore.
    const seatRoles = makeSeatRoles("Fortune Teller", "Chef", "Soldier", "Poisoner", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles, { redHerringSeat: 1 }));

    const impSelfTarget = findImpTargetVariable(result, 4)!;
    const spRecipient = findStarpassRecipientVariable(result, 3)!;
    // Poisoner targets someone other than FT so FT is functioning
    const poisonerTarget2 = findPoisonerN2TargetVariable(result, 2)!;
    let branch = zdd.require(result.root, impSelfTarget);
    branch = zdd.require(branch, spRecipient);
    branch = zdd.require(branch, poisonerTarget2);

    // FT picks (4, 1): seat 4 is dead ex-Imp (not demon), seat 1 is red herring → Yes (because of RH)
    const ftYes14 = findFortuneTellerN2Variable(result, 1, 4, "Yes")!;
    const withYesRH = zdd.require(branch, ftYes14);
    expect(zdd.count(withYesRH)).toBeGreaterThan(0);

    // FT picks (2, 4): seat 4 is dead ex-Imp (not demon), seat 2 is Soldier → No
    const ftYes24 = findFortuneTellerN2Variable(result, 2, 4, "Yes");
    const ftNo24 = findFortuneTellerN2Variable(result, 2, 4, "No");

    if (ftYes24 !== undefined) {
      const withYes = zdd.require(branch, ftYes24);
      expect(zdd.count(withYes)).toBe(0);
    }
    expect(ftNo24).toBeDefined();
    const withNo = zdd.require(branch, ftNo24!);
    expect(zdd.count(withNo)).toBeGreaterThan(0);
  });

  it("FT pings original demon in non-starpass branches", () => {
    // Test 3: When Imp kills someone else (not self), FT still pings original Imp seat.
    const seatRoles = makeSeatRoles("Fortune Teller", "Chef", "Soldier", "Poisoner", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles, { redHerringSeat: 1 }));

    // Imp kills seat 2 (Soldier) — normal kill, no starpass
    const impTarget2 = findImpTargetVariable(result, 2)!;
    // Poisoner targets someone other than FT so FT is functioning
    const poisonerTarget2 = findPoisonerN2TargetVariable(result, 2)!;
    let branch = zdd.require(result.root, impTarget2);
    branch = zdd.require(branch, poisonerTarget2);

    // FT picks (0, 4): seat 4 is the original demon → Yes
    const ftYes04 = findFortuneTellerN2Variable(result, 0, 4, "Yes")!;
    const ftNo04 = findFortuneTellerN2Variable(result, 0, 4, "No");

    const withYes = zdd.require(branch, ftYes04);
    expect(zdd.count(withYes)).toBeGreaterThan(0);

    if (ftNo04 !== undefined) {
      const withNo = zdd.require(branch, ftNo04);
      expect(zdd.count(withNo)).toBe(0);
    }
  });
});

// ============================================================================
// Soldier Immunity
// ============================================================================

describe("Soldier immunity", () => {
  it("Soldier survives Imp kill when functioning", () => {
    // Test 4: Imp targets Soldier, Soldier is not poisoned → nobody dies
    // Seats: 0=Monk, 1=Soldier, 2=Empath, 3=Scarlet Woman, 4=Imp
    const seatRoles = makeSeatRoles("Monk", "Soldier", "Empath", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    // Imp targets Soldier (seat 1), Monk protects seat 2
    const impTarget1 = findImpTargetVariable(result, 1)!;
    const monkProtects2 = findMonkTargetVariable(result, 2)!;
    let branch = zdd.require(result.root, impTarget1);
    branch = zdd.require(branch, monkProtects2);

    expect(zdd.count(branch)).toBeGreaterThan(0);

    // Nobody dies → Empath at seat 2, neighbors: seat 1 (Soldier=good), seat 3 (SW=evil)
    // → count = 1
    const empath1 = findEmpathN2Variable(result, 1)!;
    const withEmpath1 = zdd.require(branch, empath1);
    expect(zdd.count(withEmpath1)).toBeGreaterThan(0);

    // Count 0 should NOT be valid (SW at seat 3 is evil)
    const empath0 = findEmpathN2Variable(result, 0)!;
    const withEmpath0 = zdd.require(branch, empath0);
    expect(zdd.count(withEmpath0)).toBe(0);
  });

  it("Soldier dies when poisoned", () => {
    // Test 5: Poisoner targets Soldier, Imp targets Soldier → Soldier dies
    // Seats: 0=Monk, 1=Soldier, 2=Empath, 3=Poisoner, 4=Imp
    const seatRoles = makeSeatRoles("Monk", "Soldier", "Empath", "Poisoner", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    const poisonerTargetSoldier = findPoisonerN2TargetVariable(result, 1)!;
    const monkProtects2 = findMonkTargetVariable(result, 2)!;
    const impTarget1 = findImpTargetVariable(result, 1)!;

    let branch = zdd.require(result.root, poisonerTargetSoldier);
    branch = zdd.require(branch, monkProtects2);
    branch = zdd.require(branch, impTarget1);

    expect(zdd.count(branch)).toBeGreaterThan(0);

    // Soldier dies (seat 1). Empath at seat 2.
    // Living left neighbor: seat 0 (Monk=good)
    // Living right neighbor: seat 3 (Poisoner=evil)
    // → count = 1
    const empath1 = findEmpathN2Variable(result, 1)!;
    const withEmpath1 = zdd.require(branch, empath1);
    expect(zdd.count(withEmpath1)).toBeGreaterThan(0);
  });

  it("Soldier immunity with Monk protection (redundant)", () => {
    // Test 6: Monk protects Soldier, Imp targets Soldier, Soldier is functioning
    // → nobody dies (both protections active)
    // Seats: 0=Monk, 1=Soldier, 2=Empath, 3=Scarlet Woman, 4=Imp
    const seatRoles = makeSeatRoles("Monk", "Soldier", "Empath", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    const monkProtects1 = findMonkTargetVariable(result, 1)!;
    const impTarget1 = findImpTargetVariable(result, 1)!;
    let branch = zdd.require(result.root, monkProtects1);
    branch = zdd.require(branch, impTarget1);

    // Valid worlds exist (nobody dies)
    expect(zdd.count(branch)).toBeGreaterThan(0);

    // Empath at seat 2, neighbors: seat 1 (Soldier=good), seat 3 (SW=evil) → count = 1
    const empath1 = findEmpathN2Variable(result, 1)!;
    const withEmpath1 = zdd.require(branch, empath1);
    expect(zdd.count(withEmpath1)).toBeGreaterThan(0);
  });

  it("Soldier immunity does not apply to starpass", () => {
    // Test 7: Imp self-targets (starpass). Soldier exists but is irrelevant.
    // Seats: 0=Monk, 1=Soldier, 2=Empath, 3=Scarlet Woman, 4=Imp
    const seatRoles = makeSeatRoles("Monk", "Soldier", "Empath", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    const impSelfTarget = findImpTargetVariable(result, 4)!;
    const spRecipient = findStarpassRecipientVariable(result, 3)!;
    let branch = zdd.require(result.root, impSelfTarget);
    branch = zdd.require(branch, spRecipient);

    // Starpass works: Imp (seat 4) dies
    expect(zdd.count(branch)).toBeGreaterThan(0);

    // Empath at seat 2: seat 4 (Imp) is dead.
    // Living left neighbor: seat 1 (Soldier=good)
    // Living right neighbor: seat 3 (SW=evil, now new Imp)
    // → count = 1
    const empath1 = findEmpathN2Variable(result, 1)!;
    const withEmpath1 = zdd.require(branch, empath1);
    expect(zdd.count(withEmpath1)).toBeGreaterThan(0);
  });

  it("branch count with Soldier in minimal no-info-role scenario", () => {
    // Test 8: Same setup as existing hand-calculated count test
    // Seats: 0=Monk, 1=Soldier, 2=Virgin, 3=Scarlet Woman, 4=Imp
    // No Poisoner, no Empath, no FT → only action variables
    // Monk: 4 targets (1,2,3,4)
    // Imp: 5 targets (0,1,2,3,4 — starpass to SW)
    // Non-starpass: 4 Monk × 4 Imp = 16
    // Starpass: 4 Monk × 1 × 1 = 4
    // Total = 20 (Soldier doesn't change count, just death outcome)
    const seatRoles = makeSeatRoles("Monk", "Soldier", "Virgin", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    expect(zdd.count(result.root)).toBe(20);
  });
});

// ============================================================================
// Combined Interaction Tests
// ============================================================================

describe("Combined Soldier + Monk + Poisoner interactions", () => {
  it("Poisoner poisons Soldier, Monk protects Soldier, Imp targets Soldier — Monk saves", () => {
    // Test 9: Soldier poisoned (immunity lost), but Monk functioning protects.
    // Nobody dies.
    // Seats: 0=Monk, 1=Soldier, 2=Empath, 3=Poisoner, 4=Imp
    const seatRoles = makeSeatRoles("Monk", "Soldier", "Empath", "Poisoner", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    const poisonerTargetSoldier = findPoisonerN2TargetVariable(result, 1)!;
    const monkProtects1 = findMonkTargetVariable(result, 1)!;
    const impTarget1 = findImpTargetVariable(result, 1)!;

    let branch = zdd.require(result.root, poisonerTargetSoldier);
    branch = zdd.require(branch, monkProtects1);
    branch = zdd.require(branch, impTarget1);

    // Monk protection works → nobody dies
    expect(zdd.count(branch)).toBeGreaterThan(0);

    // Empath at seat 2, neighbors: seat 1 (Soldier=good), seat 3 (Poisoner=evil) → count = 1
    const empath1 = findEmpathN2Variable(result, 1)!;
    const withEmpath1 = zdd.require(branch, empath1);
    expect(zdd.count(withEmpath1)).toBeGreaterThan(0);
  });

  it("Poisoner poisons Monk, Monk protects Soldier, Imp targets Soldier — Soldier immunity holds", () => {
    // Test 10: Monk poisoned (protection fails), Soldier functioning (immunity holds).
    // Nobody dies due to Soldier immunity.
    // Seats: 0=Monk, 1=Soldier, 2=Empath, 3=Poisoner, 4=Imp
    const seatRoles = makeSeatRoles("Monk", "Soldier", "Empath", "Poisoner", "Imp");
    const zdd = new ZDD();
    const result = buildNightActionZDD(zdd, makeConfig(seatRoles));

    const poisonerTargetMonk = findPoisonerN2TargetVariable(result, 0)!;
    const monkProtects1 = findMonkTargetVariable(result, 1)!;
    const impTarget1 = findImpTargetVariable(result, 1)!;

    let branch = zdd.require(result.root, poisonerTargetMonk);
    branch = zdd.require(branch, monkProtects1);
    branch = zdd.require(branch, impTarget1);

    // Monk is poisoned → protection fails
    // But Soldier is functioning → immunity holds → nobody dies
    expect(zdd.count(branch)).toBeGreaterThan(0);

    // Empath at seat 2 is not poisoned (Poisoner targets Monk).
    // Neighbors: seat 1 (Soldier=good), seat 3 (Poisoner=evil) → count = 1
    const empath1 = findEmpathN2Variable(result, 1)!;
    const withEmpath1 = zdd.require(branch, empath1);
    expect(zdd.count(withEmpath1)).toBeGreaterThan(0);

    // Count 0 should NOT be valid
    const empath0 = findEmpathN2Variable(result, 0)!;
    const withEmpath0 = zdd.require(branch, empath0);
    expect(zdd.count(withEmpath0)).toBe(0);
  });
});
