import { describe, it, expect } from "vitest";
import { ZDD, BOTTOM, TOP } from "../src/zdd.js";
import { TROUBLE_BREWING } from "../src/botc.js";
import {
  buildNightActionZDD,
  findPoisonerN2TargetVariable,
  findMonkTargetVariable,
  findImpTargetVariable,
  findStarpassRecipientVariable,
  findEmpathN2Variable,
  findFortuneTellerN2Variable,
  findUndertakerVariable,
  type NightActionConfig,
} from "../src/night-action.js";
import { Game, type DayResult } from "../src/game.js";
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
    deadSeats?: Set<number>;
    executedRole?: string | null;
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
    deadSeats: opts?.deadSeats,
    executedRole: opts?.executedRole,
  };
}

/**
 * Helper: Build a Game through Night 1 with the given seat assignment.
 * Returns the game and seatRoles map.
 */
function buildGameThroughNight1(
  ...roles: string[]
): { game: Game; seatRoles: Map<number, string> } {
  const game = new Game(TROUBLE_BREWING, roles.length);
  game.buildDistribution();

  // Find a distribution that matches these roles
  const dists = game.zdd.enumerate(game.currentRoot);
  const targetRoleSet = new Set(roles);
  // Find a distribution containing exactly these role indices
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

  // Build night info (minimal — no malfunctioning for simplicity)
  game.buildNightInfo(seatRoles);

  return { game, seatRoles };
}

// ============================================================================
// Day Phase Tests (1–5)
// ============================================================================

describe("Day Phase", () => {
  // Test 1: Record execution
  it("records execution with correct seat, role, and dead set", () => {
    // Seats: 0=Washerwoman, 1=Chef, 2=Empath, 3=Poisoner, 4=Imp
    const { game, seatRoles } = buildGameThroughNight1(
      "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
    );

    const dayResult = game.recordDay(1); // Execute seat 1 (Chef)

    expect(dayResult.dayNumber).toBe(1);
    expect(dayResult.executedSeat).toBe(1);
    expect(dayResult.executedRole).toBe("Chef");
    expect(dayResult.otherDeaths).toEqual([]);
    expect(dayResult.deadSeats.has(1)).toBe(true);
    expect(dayResult.deadSeats.size).toBe(1);
  });

  // Test 2: Record no execution
  it("records no execution with null seat and unchanged dead set", () => {
    const { game } = buildGameThroughNight1(
      "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
    );

    const dayResult = game.recordDay(null);

    expect(dayResult.dayNumber).toBe(1);
    expect(dayResult.executedSeat).toBeNull();
    expect(dayResult.executedRole).toBeNull();
    expect(dayResult.deadSeats.size).toBe(0);
  });

  // Test 3: Record other deaths
  it("records other deaths (e.g., Virgin trigger) in dead set", () => {
    const { game } = buildGameThroughNight1(
      "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
    );

    const dayResult = game.recordDay(null, [2]); // seat 2 dies from other cause

    expect(dayResult.executedSeat).toBeNull();
    expect(dayResult.otherDeaths).toEqual([2]);
    expect(dayResult.deadSeats.has(2)).toBe(true);
    expect(dayResult.deadSeats.size).toBe(1);
  });

  // Test 4: Undo Day phase
  it("undo restores the dead set and removes the phase", () => {
    const { game } = buildGameThroughNight1(
      "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
    );

    const phaseCountBefore = game.phaseCount;
    game.recordDay(1); // Execute seat 1

    expect(game.deadSeats.has(1)).toBe(true);
    expect(game.phaseCount).toBe(phaseCountBefore + 1);

    const popped = game.undo();
    expect(popped).toBeDefined();
    expect(popped!.type).toBe(PhaseType.DayAction);
    expect(game.deadSeats.has(1)).toBe(false);
    expect(game.deadSeats.size).toBe(0);
    expect(game.phaseCount).toBe(phaseCountBefore);
  });

  // Test 5: Phase ordering
  it("creates a DayAction phase with correct sequence", () => {
    const { game } = buildGameThroughNight1(
      "Washerwoman", "Chef", "Empath", "Poisoner", "Imp",
    );

    game.recordDay(1);

    const infos = game.phaseInfos;
    // Distribution -> SeatAssignment -> NightInfo -> DayAction
    expect(infos.length).toBe(4);
    expect(infos[0].type).toBe(PhaseType.Distribution);
    expect(infos[1].type).toBe(PhaseType.SeatAssignment);
    expect(infos[2].type).toBe(PhaseType.NightInfo);
    expect(infos[3].type).toBe(PhaseType.DayAction);
    expect(infos[3].label).toBe("Day 1");
    expect(infos[3].variableCount).toBe(0);

    // The current root should be TOP (trivial phase)
    expect(game.currentRoot).toBe(TOP);
  });
});

// ============================================================================
// Dead Seats in Night Action Tests (6–10)
// ============================================================================

describe("Dead seats in Night Action", () => {
  // Test 6: Dead Poisoner skipped
  it("produces no Poisoner variables when Poisoner is dead", () => {
    // Seats: 0=Monk, 1=Chef, 2=Empath, 3=Poisoner, 4=Imp
    const seatRoles = makeSeatRoles("Monk", "Chef", "Empath", "Poisoner", "Imp");
    const zdd = new ZDD();
    const config = makeConfig(seatRoles, {
      deadSeats: new Set([3]), // Poisoner dead
    });
    const result = buildNightActionZDD(zdd, config);

    expect(result.categoryVariableRanges.has("PoisonerN2")).toBe(false);
    expect(result.poisonerN2TargetOutputs.size).toBe(0);
  });

  // Test 7: Dead Monk skipped
  it("produces no Monk variables when Monk is dead", () => {
    const seatRoles = makeSeatRoles("Monk", "Chef", "Empath", "Poisoner", "Imp");
    const zdd = new ZDD();
    const config = makeConfig(seatRoles, {
      deadSeats: new Set([0]), // Monk dead
    });
    const result = buildNightActionZDD(zdd, config);

    expect(result.categoryVariableRanges.has("MonkTarget")).toBe(false);
    expect(result.monkTargetOutputs.size).toBe(0);
  });

  // Test 8: Dead player excluded from targets
  it("excludes dead players from Poisoner/Monk/Imp targets", () => {
    const seatRoles = makeSeatRoles("Monk", "Chef", "Empath", "Poisoner", "Imp");
    const zdd = new ZDD();
    const config = makeConfig(seatRoles, {
      deadSeats: new Set([1]), // Chef dead
    });
    const result = buildNightActionZDD(zdd, config);

    // Poisoner should not have seat 1 as target
    expect(findPoisonerN2TargetVariable(result, 1)).toBeUndefined();
    // Monk should not have seat 1 as target
    expect(findMonkTargetVariable(result, 1)).toBeUndefined();
    // Imp should not have seat 1 as target
    expect(findImpTargetVariable(result, 1)).toBeUndefined();

    // But other living targets should still exist
    expect(findPoisonerN2TargetVariable(result, 0)).toBeDefined();
    expect(findMonkTargetVariable(result, 2)).toBeDefined();
    expect(findImpTargetVariable(result, 2)).toBeDefined();
  });

  // Test 9: Dead minion excluded from starpass
  it("excludes dead minions from starpass recipients", () => {
    // Seats: 0=Monk, 1=Chef, 2=Empath, 3=Poisoner, 4=Imp
    const seatRoles = makeSeatRoles("Monk", "Chef", "Empath", "Poisoner", "Imp");
    const zdd = new ZDD();
    const config = makeConfig(seatRoles, {
      deadSeats: new Set([3]), // Poisoner (only minion) dead
    });
    const result = buildNightActionZDD(zdd, config);

    // No starpass possible (only minion is dead)
    expect(result.categoryVariableRanges.has("StarpassRecipient")).toBe(false);
    // Imp also cannot self-target (no starpass)
    expect(findImpTargetVariable(result, 4)).toBeUndefined();
  });

  // Test 10: Empath neighbors skip pre-dead seats
  it("Empath skips pre-dead neighbors and night-dead neighbors", () => {
    // Seats: 0=Empath, 1=Poisoner, 2=Chef, 3=Soldier, 4=Imp
    // If seat 4 (Imp, evil) is dead pre-night, Empath's right neighbor
    // wraps to seat 3 (Soldier, good).
    // Left neighbor of seat 0 = seat 4, but seat 4 is dead, so skip to seat 3.
    // Right neighbor of seat 0 = seat 1 (Poisoner, evil).
    // So Empath sees: right=Poisoner(evil), left=seat3... wait let's think about layout.
    //
    // Actually for a cleaner test:
    // Seats: 0=Chef, 1=Poisoner, 2=Empath, 3=Scarlet Woman, 4=Imp
    // Pre-dead: seat 3 (SW, evil). Imp kills seat 1 (Poisoner) this night.
    // Empath at seat 2: left neighbor skips dead seat 1 → seat 0 (Chef, good)
    //                    right neighbor skips dead seat 3 → seat 4 (Imp, evil)
    // So Empath sees 1 evil neighbor.
    const seatRoles = makeSeatRoles("Chef", "Poisoner", "Empath", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const config = makeConfig(seatRoles, {
      deadSeats: new Set([3]), // SW dead from Day 1
    });
    const result = buildNightActionZDD(zdd, config);

    // Require Imp kills seat 1 (Poisoner)
    const impVar = findImpTargetVariable(result, 1)!;
    expect(impVar).toBeDefined();
    let root = zdd.require(result.root, impVar);

    // Pre-dead: seat 3, night-dead: seat 1
    // Empath at seat 2: neighbors are seat 0 (Chef, good) and seat 4 (Imp, evil)
    // Empath should report 1 evil neighbor
    const empath1 = findEmpathN2Variable(result, 1)!;
    expect(empath1).toBeDefined();
    const withEmpath1 = zdd.require(root, empath1);
    expect(zdd.count(withEmpath1)).toBeGreaterThan(0);

    // Empath count 0 should be invalid for this branch
    const empath0 = findEmpathN2Variable(result, 0)!;
    // We need to also fix the poisoner target to ensure Empath is NOT poisoned
    const poisonerTargets0 = findPoisonerN2TargetVariable(result, 0)!;
    let branchWith0 = zdd.require(root, poisonerTargets0);
    branchWith0 = zdd.require(branchWith0, empath0);
    expect(branchWith0).toBe(BOTTOM);
  });
});

// ============================================================================
// Undertaker Tests (11–15)
// ============================================================================

describe("Undertaker", () => {
  // Test 11: Functioning Undertaker learns correct role
  it("functioning Undertaker learns the executed player's role", () => {
    // Seats: 0=Undertaker, 1=Chef, 2=Soldier, 3=Scarlet Woman, 4=Imp
    // Day 1: Execute seat 1 (Chef)
    const seatRoles = makeSeatRoles("Undertaker", "Chef", "Soldier", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const config = makeConfig(seatRoles, {
      deadSeats: new Set([1]), // Chef dead from Day 1
      executedRole: "Chef",    // Chef was executed
    });
    const result = buildNightActionZDD(zdd, config);

    // Undertaker variables should exist
    expect(result.categoryVariableRanges.has("UndertakerN2")).toBe(true);
    expect(result.undertakerOutputs.size).toBeGreaterThan(0);

    // The correct role (Chef) should have valid worlds
    const chefVar = findUndertakerVariable(result, "Chef")!;
    expect(chefVar).toBeDefined();
    let withChef = zdd.require(result.root, chefVar);
    expect(zdd.count(withChef)).toBeGreaterThan(0);

    // An incorrect role should have zero worlds
    const impVar = findUndertakerVariable(result, "Imp")!;
    expect(impVar).toBeDefined();
    let withImp = zdd.require(result.root, impVar);
    expect(withImp).toBe(BOTTOM);
  });

  // Test 12: Malfunctioning Undertaker gets any role
  it("malfunctioning Undertaker can learn any role", () => {
    // Seats: 0=Undertaker, 1=Chef, 2=Soldier, 3=Poisoner, 4=Imp
    // Day 1: Execute seat 1 (Chef)
    // Poisoner targets Undertaker → Undertaker malfunctions
    const seatRoles = makeSeatRoles("Undertaker", "Chef", "Soldier", "Poisoner", "Imp");
    const zdd = new ZDD();
    const config = makeConfig(seatRoles, {
      deadSeats: new Set([1]), // Chef dead
      executedRole: "Chef",
    });
    const result = buildNightActionZDD(zdd, config);

    // Require Poisoner targets Undertaker (seat 0) → Undertaker malfunctions
    const poisonUT = findPoisonerN2TargetVariable(result, 0)!;
    expect(poisonUT).toBeDefined();
    let root = zdd.require(result.root, poisonUT);

    // Any role should be valid for the Undertaker
    const chefVar = findUndertakerVariable(result, "Chef")!;
    let withChef = zdd.require(root, chefVar);
    expect(zdd.count(withChef)).toBeGreaterThan(0);

    // Even a different role should be valid when malfunctioning
    const impVar = findUndertakerVariable(result, "Imp")!;
    let withImp = zdd.require(root, impVar);
    expect(zdd.count(withImp)).toBeGreaterThan(0);

    const soldierVar = findUndertakerVariable(result, "Soldier")!;
    let withSoldier = zdd.require(root, soldierVar);
    expect(zdd.count(withSoldier)).toBeGreaterThan(0);
  });

  // Test 13: Dead Undertaker produces no output
  it("dead Undertaker produces no Undertaker variables in any world", () => {
    // Seats: 0=Undertaker, 1=Chef, 2=Soldier, 3=Scarlet Woman, 4=Imp
    // Day 1: Execute the Undertaker (seat 0)
    const seatRoles = makeSeatRoles("Undertaker", "Chef", "Soldier", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const config = makeConfig(seatRoles, {
      deadSeats: new Set([0]),  // Undertaker dead
      executedRole: "Undertaker",
    });
    const result = buildNightActionZDD(zdd, config);

    // No Undertaker variables should be allocated
    expect(result.categoryVariableRanges.has("UndertakerN2")).toBe(false);
    expect(result.undertakerOutputs.size).toBe(0);
  });

  // Test 14: No execution means no Undertaker output
  it("no execution means no Undertaker variables", () => {
    // Seats: 0=Undertaker, 1=Chef, 2=Soldier, 3=Scarlet Woman, 4=Imp
    // Day 1: No execution
    const seatRoles = makeSeatRoles("Undertaker", "Chef", "Soldier", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const config = makeConfig(seatRoles, {
      executedRole: null, // No execution
    });
    const result = buildNightActionZDD(zdd, config);

    // No Undertaker variables
    expect(result.categoryVariableRanges.has("UndertakerN2")).toBe(false);
    expect(result.undertakerOutputs.size).toBe(0);
  });

  // Test 15: Undertaker + Empath interaction
  it("Undertaker and Empath produce consistent outputs after evil player execution", () => {
    // Seats: 0=Undertaker, 1=Empath, 2=Soldier, 3=Poisoner, 4=Imp
    // Day 1: Execute Poisoner (seat 3, evil)
    // Night 2:
    // - Undertaker learns "Poisoner" (functioning)
    // - Empath has neighbors: left=seat 0 (Undertaker, good), right=seat 2 (Soldier, good)
    //   Wait — seat 3 is dead, so Empath's right neighbor skips seat 3 → seat 4 (Imp, evil)
    //   Left neighbor of seat 1 = seat 0 (Undertaker, good)
    //   So Empath functioning sees 1 evil neighbor (Imp).
    const seatRoles = makeSeatRoles("Undertaker", "Empath", "Soldier", "Poisoner", "Imp");
    const zdd = new ZDD();
    const config = makeConfig(seatRoles, {
      deadSeats: new Set([3]), // Poisoner dead
      executedRole: "Poisoner",
    });
    const result = buildNightActionZDD(zdd, config);

    // Both Undertaker and Empath should have variables
    expect(result.categoryVariableRanges.has("UndertakerN2")).toBe(true);
    expect(result.categoryVariableRanges.has("EmpathN2")).toBe(true);

    // Require Undertaker learns "Poisoner"
    const utVar = findUndertakerVariable(result, "Poisoner")!;
    expect(utVar).toBeDefined();
    let root = zdd.require(result.root, utVar);
    expect(zdd.count(root)).toBeGreaterThan(0);

    // Now also check Empath. When nobody is poisoned (no Poisoner alive),
    // Empath is functioning. Left neighbor = seat 0 (Undertaker, good).
    // Right neighbor: seat 2 (Soldier, good), seat 3 dead, seat 4 (Imp, evil).
    // Actually right neighbor of seat 1 is seat 2 (Soldier, good)!
    // Let me re-check: neighbors are the closest LIVING seats.
    // Left: seat 0 (Undertaker, good)
    // Right: seat 2 (Soldier, good) — seat 2 is alive
    // Imp is at seat 4, but seat 2 is closer.
    // So Empath sees 0 evil neighbors? Wait no...
    // The Empath has exactly 2 neighbors (left and right). Not all neighbors.
    // Left neighbor of seat 1 = seat 0 (alive, good). Right neighbor = seat 2 (alive, good).
    // So count = 0... unless Imp kills one of them this night.

    // With no night death affecting neighbors, Empath sees 0.
    // Let's require Imp targets seat 2 (Soldier, immune), so no death.
    const impTargetSoldier = findImpTargetVariable(result, 2)!;
    expect(impTargetSoldier).toBeDefined();
    let branch = zdd.require(root, impTargetSoldier);

    // Empath count 0 should be valid (both neighbors good, nobody dies)
    const empath0 = findEmpathN2Variable(result, 0)!;
    let withEmpath0 = zdd.require(branch, empath0);
    expect(zdd.count(withEmpath0)).toBeGreaterThan(0);
  });
});

// ============================================================================
// Branch Count Tests (16–17)
// ============================================================================

describe("Branch count tests", () => {
  // Test 16: Minimal scenario with Undertaker
  it("5p game with Undertaker and no Poisoner produces expected world count", () => {
    // Seats: 0=Undertaker, 1=Chef, 2=Soldier, 3=Scarlet Woman, 4=Imp
    // Day 1: Execute seat 1 (Chef)
    // Night 2:
    //   No Poisoner → no poisoner variables
    //   Monk absent → no monk variables
    //   Imp: targets 0, 2, 3 (living, non-self, unless starpass)
    //     SW at seat 3 is living minion → starpass possible
    //     So Imp targets: 0, 2, 3, 4 (self)  (seat 1 is dead, so excluded)
    //   Starpass: 1 recipient (SW at seat 3)
    //   Undertaker: 5 role variables (one per role in selectedRoles)
    //     Functioning → exactly "Chef"
    //   No Empath, no FT
    //
    // Imp has 4 targets:
    //   - Seat 0: kill (no protection). 1 world (Chef undertaker output) = 1
    //   - Seat 2: kill Soldier? Soldier is functioning → immune. No death. 1 world = 1
    //   - Seat 3: kill SW. 1 world = 1
    //   - Seat 4 (self): starpass → 1 recipient (SW). 1 world = 1
    // Total: 4 worlds
    const seatRoles = makeSeatRoles("Undertaker", "Chef", "Soldier", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const config = makeConfig(seatRoles, {
      deadSeats: new Set([1]),
      executedRole: "Chef",
    });
    const result = buildNightActionZDD(zdd, config);

    expect(zdd.count(result.root)).toBe(4);
  });

  // Test 17: Dead Poisoner reduces branches
  it("dead Poisoner produces fewer branches than living Poisoner", () => {
    // Seats: 0=Monk, 1=Chef, 2=Empath, 3=Poisoner, 4=Imp
    const seatRoles = makeSeatRoles("Monk", "Chef", "Empath", "Poisoner", "Imp");

    // Living Poisoner
    const zdd1 = new ZDD();
    const configAlive = makeConfig(seatRoles);
    const resultAlive = buildNightActionZDD(zdd1, configAlive);
    const countAlive = zdd1.count(resultAlive.root);

    // Dead Poisoner (executed Day 1)
    const zdd2 = new ZDD();
    const configDead = makeConfig(seatRoles, {
      deadSeats: new Set([3]), // Poisoner dead
      executedRole: "Poisoner",
    });
    const resultDead = buildNightActionZDD(zdd2, configDead);
    const countDead = zdd2.count(resultDead.root);

    // Dead Poisoner should have fewer branches (no Poisoner target variables)
    expect(countDead).toBeLessThan(countAlive);
    expect(resultDead.categoryVariableRanges.has("PoisonerN2")).toBe(false);
    expect(resultAlive.categoryVariableRanges.has("PoisonerN2")).toBe(true);
  });
});

// ============================================================================
// Game class integration
// ============================================================================

describe("Game class Day + Night Action integration", () => {
  it("full pipeline: Night 1 → Day 1 → Night 2 with Undertaker", () => {
    // Seats: 0=Undertaker, 1=Chef, 2=Soldier, 3=Scarlet Woman, 4=Imp
    const { game, seatRoles } = buildGameThroughNight1(
      "Undertaker", "Chef", "Soldier", "Scarlet Woman", "Imp",
    );

    // Record Day 1: execute seat 1 (Chef)
    const dayResult = game.recordDay(1);
    expect(dayResult.executedRole).toBe("Chef");
    expect(game.deadSeats.has(1)).toBe(true);

    // Build Night 2
    game.buildNightAction(seatRoles);

    const actionResult = game.nightActionResult!;
    expect(actionResult).toBeDefined();

    // Undertaker should have variables
    expect(actionResult.categoryVariableRanges.has("UndertakerN2")).toBe(true);

    // Require Undertaker learns "Chef" — should have valid worlds
    const chefVar = findUndertakerVariable(actionResult, "Chef")!;
    expect(chefVar).toBeDefined();
  });

  it("recordNightDeath updates dead set for subsequent day", () => {
    const { game, seatRoles } = buildGameThroughNight1(
      "Washerwoman", "Chef", "Soldier", "Scarlet Woman", "Imp",
    );

    // No day death
    game.recordDay(null);
    expect(game.deadSeats.size).toBe(0);

    // Record night death (e.g., Imp killed seat 1 overnight)
    game.recordNightDeath(1);
    expect(game.deadSeats.has(1)).toBe(true);
    expect(game.deadSeats.size).toBe(1);
  });

  it("validates that executed seat is alive", () => {
    const { game } = buildGameThroughNight1(
      "Washerwoman", "Chef", "Soldier", "Scarlet Woman", "Imp",
    );

    game.recordDay(1); // Execute seat 1

    // Seat 1 is now dead — trying to record a night death for seat 1 should fail
    expect(() => game.recordNightDeath(1)).toThrow("already dead");
  });
});
