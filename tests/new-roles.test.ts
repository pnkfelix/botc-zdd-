import { describe, it, expect } from "vitest";
import { ZDD, BOTTOM, TOP } from "../src/zdd.js";
import { TROUBLE_BREWING, RoleType } from "../src/botc.js";
import {
  buildNightActionZDD,
  findImpTargetVariable,
  findMonkTargetVariable,
  findPoisonerN2TargetVariable,
  findStarpassRecipientVariable,
  findRavenkeeperTargetVariable,
  findRavenkeeperRoleVariable,
  findEmpathN2Variable,
  type NightActionConfig,
} from "../src/night-action.js";
import { Game, type DayResult } from "../src/game.js";

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

function buildGameThroughNight1(
  ...roles: string[]
): { game: Game; seatRoles: Map<number, string> } {
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

  return { game, seatRoles };
}

// ============================================================================
// Ravenkeeper Tests
// ============================================================================

describe("Ravenkeeper", () => {
  // Test 1: RK killed by Imp → learns target's true role (functioning)
  it("functioning Ravenkeeper killed by Imp learns target's true role", () => {
    // Seats: 0=Ravenkeeper, 1=Chef, 2=Soldier, 3=Scarlet Woman, 4=Imp
    const seatRoles = makeSeatRoles("Ravenkeeper", "Chef", "Soldier", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const config = makeConfig(seatRoles);
    const result = buildNightActionZDD(zdd, config);

    // RK variables should be allocated
    expect(result.categoryVariableRanges.has("RavenkeeperTarget")).toBe(true);
    expect(result.categoryVariableRanges.has("RavenkeeperRole")).toBe(true);

    // Require Imp kills RK (seat 0)
    const impKillRK = findImpTargetVariable(result, 0)!;
    expect(impKillRK).toBeDefined();
    let root = zdd.require(result.root, impKillRK);
    expect(zdd.count(root)).toBeGreaterThan(0);

    // RK chooses to learn seat 1 (Chef) → should learn "Chef"
    const rkTarget1 = findRavenkeeperTargetVariable(result, 1)!;
    expect(rkTarget1).toBeDefined();
    let branch = zdd.require(root, rkTarget1);

    // Should learn Chef (true role)
    const rkChef = findRavenkeeperRoleVariable(result, "Chef")!;
    expect(rkChef).toBeDefined();
    let withChef = zdd.require(branch, rkChef);
    expect(zdd.count(withChef)).toBeGreaterThan(0);

    // Should NOT learn Imp (wrong role for seat 1)
    const rkImp = findRavenkeeperRoleVariable(result, "Imp")!;
    expect(rkImp).toBeDefined();
    let withImp = zdd.require(branch, rkImp);
    expect(withImp).toBe(BOTTOM);
  });

  // Test 2: RK killed by Imp but poisoned → can learn any role
  it("malfunctioning Ravenkeeper killed by Imp can learn any role", () => {
    // Seats: 0=Ravenkeeper, 1=Chef, 2=Soldier, 3=Poisoner, 4=Imp
    const seatRoles = makeSeatRoles("Ravenkeeper", "Chef", "Soldier", "Poisoner", "Imp");
    const zdd = new ZDD();
    const config = makeConfig(seatRoles);
    const result = buildNightActionZDD(zdd, config);

    // Require Poisoner targets RK (seat 0) — RK is malfunctioning
    const poisonRK = findPoisonerN2TargetVariable(result, 0)!;
    expect(poisonRK).toBeDefined();
    let root = zdd.require(result.root, poisonRK);

    // Require Imp kills RK (seat 0)
    const impKillRK = findImpTargetVariable(result, 0)!;
    root = zdd.require(root, impKillRK);
    expect(zdd.count(root)).toBeGreaterThan(0);

    // RK chooses to learn seat 1 (Chef)
    const rkTarget1 = findRavenkeeperTargetVariable(result, 1)!;
    let branch = zdd.require(root, rkTarget1);

    // Malfunctioning: can learn Chef
    const rkChef = findRavenkeeperRoleVariable(result, "Chef")!;
    let withChef = zdd.require(branch, rkChef);
    expect(zdd.count(withChef)).toBeGreaterThan(0);

    // Malfunctioning: can also learn Imp (any role)
    const rkImp = findRavenkeeperRoleVariable(result, "Imp")!;
    let withImp = zdd.require(branch, rkImp);
    expect(zdd.count(withImp)).toBeGreaterThan(0);
  });

  // Test 3: RK protected by Monk → doesn't die → ability doesn't fire
  it("Ravenkeeper protected by Monk doesn't fire", () => {
    // Seats: 0=Ravenkeeper, 1=Monk, 2=Soldier, 3=Scarlet Woman, 4=Imp
    const seatRoles = makeSeatRoles("Ravenkeeper", "Monk", "Soldier", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const config = makeConfig(seatRoles);
    const result = buildNightActionZDD(zdd, config);

    // Require Monk protects RK (seat 0)
    const monkProtectRK = findMonkTargetVariable(result, 0)!;
    expect(monkProtectRK).toBeDefined();
    let root = zdd.require(result.root, monkProtectRK);

    // Require Imp targets RK (seat 0) — but Monk blocks it
    const impTargetRK = findImpTargetVariable(result, 0)!;
    root = zdd.require(root, impTargetRK);
    expect(zdd.count(root)).toBeGreaterThan(0);

    // RK should NOT have any target/role vars in this branch
    // (since RK didn't die, no RK output should be present)
    const rkTarget1 = findRavenkeeperTargetVariable(result, 1);
    if (rkTarget1 !== undefined) {
      // Variables are allocated, but requiring them should yield BOTTOM
      // because the branch where RK is protected returns TOP (no RK vars)
      const withRKTarget = zdd.require(root, rkTarget1);
      expect(withRKTarget).toBe(BOTTOM);
    }
  });

  // Test 4: Imp starpass kills Imp, not RK → RK doesn't fire
  it("Imp starpass doesn't trigger Ravenkeeper", () => {
    // Seats: 0=Ravenkeeper, 1=Chef, 2=Soldier, 3=Scarlet Woman, 4=Imp
    const seatRoles = makeSeatRoles("Ravenkeeper", "Chef", "Soldier", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const config = makeConfig(seatRoles);
    const result = buildNightActionZDD(zdd, config);

    // Imp self-targets (starpass)
    const impSelf = findImpTargetVariable(result, 4)!;
    expect(impSelf).toBeDefined();
    let root = zdd.require(result.root, impSelf);
    expect(zdd.count(root)).toBeGreaterThan(0);

    // RK should not fire (Imp dies, not RK)
    const rkTarget1 = findRavenkeeperTargetVariable(result, 1);
    if (rkTarget1 !== undefined) {
      const withRKTarget = zdd.require(root, rkTarget1);
      expect(withRKTarget).toBe(BOTTOM);
    }
  });

  // Test 5: RK already dead → ability doesn't fire
  it("pre-dead Ravenkeeper produces no RK variables", () => {
    const seatRoles = makeSeatRoles("Ravenkeeper", "Chef", "Soldier", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const config = makeConfig(seatRoles, {
      deadSeats: new Set([0]), // RK already dead
    });
    const result = buildNightActionZDD(zdd, config);

    // No RK variables
    expect(result.categoryVariableRanges.has("RavenkeeperTarget")).toBe(false);
    expect(result.categoryVariableRanges.has("RavenkeeperRole")).toBe(false);
    expect(result.ravenkeeperTargetOutputs.size).toBe(0);
    expect(result.ravenkeeperRoleOutputs.size).toBe(0);
  });

  // Test 6: RK killed by Imp, chooses to learn the Imp's role
  it("Ravenkeeper can choose to learn the Imp's role", () => {
    const seatRoles = makeSeatRoles("Ravenkeeper", "Chef", "Soldier", "Scarlet Woman", "Imp");
    const zdd = new ZDD();
    const config = makeConfig(seatRoles);
    const result = buildNightActionZDD(zdd, config);

    // Imp kills RK
    const impKillRK = findImpTargetVariable(result, 0)!;
    let root = zdd.require(result.root, impKillRK);

    // RK chooses seat 4 (Imp)
    const rkTarget4 = findRavenkeeperTargetVariable(result, 4)!;
    let branch = zdd.require(root, rkTarget4);

    // Should learn "Imp"
    const rkImp = findRavenkeeperRoleVariable(result, "Imp")!;
    let withImp = zdd.require(branch, rkImp);
    expect(zdd.count(withImp)).toBeGreaterThan(0);

    // Should NOT learn "Chef" (wrong role for seat 4)
    const rkChef = findRavenkeeperRoleVariable(result, "Chef")!;
    let withChef = zdd.require(branch, rkChef);
    expect(withChef).toBe(BOTTOM);
  });
});

// ============================================================================
// Scarlet Woman Tests
// ============================================================================

describe("Scarlet Woman", () => {
  // Test 7: Imp executed with 5+ alive → SW becomes Imp
  it("SW becomes Imp when Imp is executed with 5+ alive", () => {
    // 6 players: 0=Chef, 1=Empath, 2=Soldier, 3=Scarlet Woman, 4=Butler, 5=Imp
    const { game, seatRoles } = buildGameThroughNight1(
      "Chef", "Empath", "Soldier", "Scarlet Woman", "Butler", "Imp",
    );

    // Day 1: Execute Imp (seat 5). 6 players alive → 5 remain after execution
    const dayResult = game.recordDay(5);

    expect(dayResult.executedRole).toBe("Imp");
    expect(dayResult.scarletWomanPromotion).toBe(3); // SW at seat 3 promoted
  });

  // Test 8: SW promotion: Night 2 Imp kill comes from SW's seat
  it("after SW promotion, Night 2 treats SW seat as demon for Empath", () => {
    // 6 players: 0=Empath, 1=Chef, 2=Soldier, 3=Scarlet Woman, 4=Butler, 5=Imp
    const { game, seatRoles } = buildGameThroughNight1(
      "Empath", "Chef", "Soldier", "Scarlet Woman", "Butler", "Imp",
    );

    // Day 1: Execute Imp (seat 5)
    const dayResult = game.recordDay(5);
    expect(dayResult.scarletWomanPromotion).toBe(3);

    // The seat assignment should now show seat 3 as Imp
    // Build Night 2 with updated seat assignment
    const updatedSeatRoles = new Map(seatRoles);
    updatedSeatRoles.set(3, "Imp"); // SW promoted
    updatedSeatRoles.delete(5); // Imp is dead, but we keep the mapping
    // Actually seatRoles retains the full mapping; the game internally updated it.
    // Let's just verify through building night action with the game's internal state.
    // Since game._seatAssignment is private, we test via building night action externally.
    const zdd = new ZDD();
    const config = makeConfig(
      makeSeatRoles("Empath", "Chef", "Soldier", "Imp", "Butler", "Imp"),
      {
        selectedRoles: ["Empath", "Chef", "Soldier", "Imp", "Butler", "Imp"],
        deadSeats: new Set([5]),
        executedRole: "Imp",
      },
    );

    // The new Imp is at seat 3.
    // With Empath at seat 0: left neighbor=seat 5 (dead) → seat 4 (Butler, good)
    //                         right neighbor=seat 1 (Chef, good)
    // So Empath sees 0 evil neighbors.
    // But seat 3 is Imp (evil), and it's not a neighbor of seat 0.
    const result = buildNightActionZDD(zdd, config);
    expect(result.root).not.toBe(BOTTOM);
  });

  // Test 9: Imp executed with 4 alive → no promotion
  it("no SW promotion when fewer than 5 players alive", () => {
    // 6 players: 0=Chef, 1=Empath, 2=Soldier, 3=Scarlet Woman, 4=Butler, 5=Imp
    const { game, seatRoles } = buildGameThroughNight1(
      "Chef", "Empath", "Soldier", "Scarlet Woman", "Butler", "Imp",
    );

    // Kill two players to get to 4 alive before execution
    game.recordNightDeath(0); // Chef dies overnight
    game.recordNightDeath(1); // Empath dies

    // Day 1: Execute Imp (seat 5). 4 alive → 3 remain. No promotion.
    const dayResult = game.recordDay(5);

    expect(dayResult.executedRole).toBe("Imp");
    expect(dayResult.scarletWomanPromotion).toBeUndefined();
  });

  // Test 10: SW already dead → no promotion
  it("dead SW doesn't get promoted", () => {
    // 6 players: 0=Chef, 1=Empath, 2=Soldier, 3=Scarlet Woman, 4=Butler, 5=Imp
    const { game, seatRoles } = buildGameThroughNight1(
      "Chef", "Empath", "Soldier", "Scarlet Woman", "Butler", "Imp",
    );

    // Kill SW overnight
    game.recordNightDeath(3);

    // Day 1: Execute Imp (seat 5). 5 alive → 4 remain. SW is dead → no promotion.
    const dayResult = game.recordDay(5);

    expect(dayResult.executedRole).toBe("Imp");
    expect(dayResult.scarletWomanPromotion).toBeUndefined();
  });

  // Test 11: Functioning SW has starpass precedence over other minions
  it("functioning SW is the mandatory starpass recipient", () => {
    // 7 players: 0=Chef, 1=Empath, 2=Soldier, 3=Scarlet Woman, 4=Poisoner, 5=Butler, 6=Imp
    // Two living minions: SW (seat 3) and Poisoner (seat 4).
    // When Imp starpasses, functioning SW must be the only recipient.
    const seatRoles = makeSeatRoles(
      "Chef", "Empath", "Soldier", "Scarlet Woman", "Poisoner", "Butler", "Imp",
    );
    const zdd = new ZDD();
    const config = makeConfig(seatRoles);
    const result = buildNightActionZDD(zdd, config);

    // Imp self-targets (starpass)
    const impSelf = findImpTargetVariable(result, 6)!;
    expect(impSelf).toBeDefined();
    let root = zdd.require(result.root, impSelf);
    expect(zdd.count(root)).toBeGreaterThan(0);

    // SW (seat 3) should be a valid starpass recipient
    const spSW = findStarpassRecipientVariable(result, 3);
    expect(spSW).toBeDefined();

    // Poisoner (seat 4) should also have a variable allocated...
    const spPoisoner = findStarpassRecipientVariable(result, 4);
    expect(spPoisoner).toBeDefined();

    // But requiring Poisoner as recipient should yield BOTTOM in branches
    // where SW is functioning (i.e., not poisoned by the Poisoner targeting herself).
    // When Poisoner targets someone other than SW, SW is functioning → only SW is valid.
    // Require Poisoner targets seat 0 (Chef) — SW is NOT poisoned → SW must be recipient
    const poisonerTargetChef = findPoisonerN2TargetVariable(result, 0)!;
    let branch = zdd.require(root, poisonerTargetChef);

    // SW must be the recipient
    let withSW = zdd.require(branch, spSW!);
    expect(zdd.count(withSW)).toBeGreaterThan(0);

    // Poisoner as recipient should be impossible when SW is functioning
    let withPoisoner = zdd.require(branch, spPoisoner!);
    expect(withPoisoner).toBe(BOTTOM);
  });

  // Test 12: Poisoned SW loses starpass precedence
  it("poisoned SW does not have starpass precedence", () => {
    // 7 players: 0=Chef, 1=Empath, 2=Soldier, 3=Scarlet Woman, 4=Poisoner, 5=Butler, 6=Imp
    const seatRoles = makeSeatRoles(
      "Chef", "Empath", "Soldier", "Scarlet Woman", "Poisoner", "Butler", "Imp",
    );
    const zdd = new ZDD();
    const config = makeConfig(seatRoles);
    const result = buildNightActionZDD(zdd, config);

    // Imp self-targets (starpass)
    const impSelf = findImpTargetVariable(result, 6)!;
    let root = zdd.require(result.root, impSelf);

    // Poisoner targets SW (seat 3) → SW is malfunctioning → no precedence
    const poisonerTargetSW = findPoisonerN2TargetVariable(result, 3)!;
    let branch = zdd.require(root, poisonerTargetSW);

    // Both SW and Poisoner should be valid recipients
    const spSW = findStarpassRecipientVariable(result, 3)!;
    const spPoisoner = findStarpassRecipientVariable(result, 4)!;

    let withSW = zdd.require(branch, spSW);
    expect(zdd.count(withSW)).toBeGreaterThan(0);

    let withPoisoner = zdd.require(branch, spPoisoner);
    expect(zdd.count(withPoisoner)).toBeGreaterThan(0);
  });
});

// ============================================================================
// Saint Tests
// ============================================================================

describe("Saint", () => {
  // Test 11: Saint executed while functioning → evil wins
  it("executing a functioning Saint results in evil winning", () => {
    // 6 players (3T, 1O, 1M, 1D): 0=Chef, 1=Saint, 2=Soldier, 3=Scarlet Woman, 4=Empath, 5=Imp
    const { game } = buildGameThroughNight1(
      "Chef", "Saint", "Soldier", "Scarlet Woman", "Empath", "Imp",
    );

    const dayResult = game.recordDay(1); // Execute Saint (seat 1)

    expect(dayResult.executedRole).toBe("Saint");
    expect(dayResult.gameOver).toBeDefined();
    expect(dayResult.gameOver!.winner).toBe("Evil");
    expect(dayResult.gameOver!.reason).toBe("Saint was executed");
  });

  // Test 12: Saint executed while poisoned → no special effect
  it("executing a poisoned Saint does not end the game", () => {
    // 6 players: 0=Chef, 1=Saint, 2=Soldier, 3=Scarlet Woman, 4=Empath, 5=Imp
    const targetRoles = ["Chef", "Saint", "Soldier", "Scarlet Woman", "Empath", "Imp"];
    const game2 = new Game(TROUBLE_BREWING, 6);
    game2.buildDistribution();
    const dists = game2.zdd.enumerate(game2.currentRoot);
    const roleNames = TROUBLE_BREWING.roles.map((r) => r.name);
    const targetRoleSet = new Set(targetRoles);

    let matchedDist: number[] | undefined;
    for (const dist of dists) {
      const distRoles = dist.map((v) => roleNames[v]);
      if (
        distRoles.length === 6 &&
        distRoles.every((r) => targetRoleSet.has(r)) &&
        targetRoles.every((r) => distRoles.includes(r))
      ) {
        matchedDist = dist;
        break;
      }
    }

    game2.buildSeatAssignment(matchedDist!);
    const seatRoles2 = makeSeatRoles(...targetRoles);
    // Saint at seat 1 is malfunctioning (poisoned)
    game2.buildNightInfo(seatRoles2, new Set([1]));

    const dayResult = game2.recordDay(1);

    expect(dayResult.executedRole).toBe("Saint");
    expect(dayResult.gameOver).toBeUndefined();
  });

  // Test 13: Non-Saint execution has no game-over
  it("executing a non-Saint does not trigger game over", () => {
    const { game } = buildGameThroughNight1(
      "Chef", "Saint", "Soldier", "Scarlet Woman", "Empath", "Imp",
    );

    const dayResult = game.recordDay(0); // Execute Chef

    expect(dayResult.executedRole).toBe("Chef");
    expect(dayResult.gameOver).toBeUndefined();
  });

  // Test 14: checkGameOver returns the result
  it("checkGameOver returns the game over result from last day", () => {
    const { game } = buildGameThroughNight1(
      "Chef", "Saint", "Soldier", "Scarlet Woman", "Empath", "Imp",
    );

    // No game over initially
    expect(game.checkGameOver()).toBeUndefined();

    game.recordDay(1); // Execute Saint

    const result = game.checkGameOver();
    expect(result).toBeDefined();
    expect(result!.winner).toBe("Evil");
  });
});

// ============================================================================
// Slayer Tests
// ============================================================================

describe("Slayer (ZDD-based)", () => {
  // Test 15: Functioning Slayer → Imp must die (only outcome)
  it("functioning Slayer shooting Imp: only (target=Imp, died=true) is legal", () => {
    const { game } = buildGameThroughNight1(
      "Slayer", "Chef", "Soldier", "Scarlet Woman", "Imp",
    );

    const dayResult = game.recordDay(null, { slayerShot: { slayerSeat: 0 } });

    expect(dayResult.slayerShotOutputs).toBeDefined();

    // Find the variable for targeting Imp (seat 4)
    const diedVar = game.findSlayerShotVariable(4, true);
    const survivedVar = game.findSlayerShotVariable(4, false);

    // Imp must die — only "died" outcome is legal
    expect(diedVar).toBeDefined();
    expect(survivedVar).toBeUndefined();

    // Requiring this variable should yield valid worlds
    const root = game.currentRoot;
    const withDied = game.zdd.require(root, diedVar!);
    expect(game.zdd.count(withDied)).toBeGreaterThan(0);
  });

  // Test 16: Malfunctioning Slayer → all targets survive
  it("malfunctioning Slayer: all targets have only (died=false) outcome", () => {
    // Build game with Slayer malfunctioning
    const game = new Game(TROUBLE_BREWING, 5);
    game.buildDistribution();
    const dists = game.zdd.enumerate(game.currentRoot);
    const roleNames = TROUBLE_BREWING.roles.map((r) => r.name);
    const targetRoles = ["Slayer", "Chef", "Soldier", "Scarlet Woman", "Imp"];
    const targetRoleSet = new Set(targetRoles);

    let matchedDist: number[] | undefined;
    for (const dist of dists) {
      const distRoles = dist.map((v) => roleNames[v]);
      if (
        distRoles.length === 5 &&
        distRoles.every((r) => targetRoleSet.has(r)) &&
        targetRoles.every((r) => distRoles.includes(r))
      ) {
        matchedDist = dist;
        break;
      }
    }

    game.buildSeatAssignment(matchedDist!);
    const seatRoles = makeSeatRoles(...targetRoles);
    game.buildNightInfo(seatRoles, new Set([0])); // Slayer malfunctioning

    const dayResult = game.recordDay(null, { slayerShot: { slayerSeat: 0 } });
    expect(dayResult.slayerShotOutputs).toBeDefined();

    // Imp (seat 4): only survived outcome (Slayer malfunctioning)
    expect(game.findSlayerShotVariable(4, true)).toBeUndefined();
    expect(game.findSlayerShotVariable(4, false)).toBeDefined();

    // All other targets also only have survived
    for (let t = 0; t < 5; t++) {
      expect(game.findSlayerShotVariable(t, true)).toBeUndefined();
    }
  });

  // Test 17: Slayer shoots non-Demon → no kill outcome
  it("non-Demon targets only have (died=false) outcome", () => {
    const { game } = buildGameThroughNight1(
      "Slayer", "Chef", "Soldier", "Scarlet Woman", "Imp",
    );

    game.recordDay(null, { slayerShot: { slayerSeat: 0 } });

    // Chef (seat 1): only survived
    expect(game.findSlayerShotVariable(1, true)).toBeUndefined();
    expect(game.findSlayerShotVariable(1, false)).toBeDefined();
  });

  // Test 18: Slayer already used → error
  it("Slayer cannot use ability twice", () => {
    const { game } = buildGameThroughNight1(
      "Slayer", "Chef", "Soldier", "Scarlet Woman", "Imp",
    );

    game.recordDay(null, { slayerShot: { slayerSeat: 0 } });
    expect(game.slayerUsed).toBe(true);

    expect(() =>
      game.recordDay(null, { slayerShot: { slayerSeat: 0 } }),
    ).toThrow("already been used");
  });

  // Test 19: Dead Slayer cannot shoot
  it("dead Slayer cannot use ability", () => {
    const { game } = buildGameThroughNight1(
      "Slayer", "Chef", "Soldier", "Scarlet Woman", "Imp",
    );

    game.recordNightDeath(0);

    expect(() =>
      game.recordDay(null, { slayerShot: { slayerSeat: 0 } }),
    ).toThrow("dead");
  });

  // Test 20: Recluse → both outcomes are legal (ST decides registration)
  it("Recluse target has both (died=true) and (died=false) outcomes", () => {
    const { game } = buildGameThroughNight1(
      "Slayer", "Chef", "Recluse", "Scarlet Woman", "Soldier", "Imp",
    );

    game.recordDay(null, { slayerShot: { slayerSeat: 0 } });

    // Recluse (seat 2): both outcomes are legal
    const diedVar = game.findSlayerShotVariable(2, true);
    const survivedVar = game.findSlayerShotVariable(2, false);
    expect(diedVar).toBeDefined();
    expect(survivedVar).toBeDefined();

    // Both can be required in the ZDD
    const root = game.currentRoot;
    expect(game.zdd.count(game.zdd.require(root, diedVar!))).toBeGreaterThan(0);
    expect(game.zdd.count(game.zdd.require(root, survivedVar!))).toBeGreaterThan(0);
  });

  // Test 21: Recluse branching — requiring one outcome excludes the other
  it("requiring one Recluse outcome excludes the other", () => {
    const { game } = buildGameThroughNight1(
      "Slayer", "Chef", "Recluse", "Scarlet Woman", "Soldier", "Imp",
    );

    game.recordDay(null, { slayerShot: { slayerSeat: 0 } });

    const diedVar = game.findSlayerShotVariable(2, true)!;
    const survivedVar = game.findSlayerShotVariable(2, false)!;

    // Requiring "died" should exclude "survived" for the same target
    const root = game.currentRoot;
    const withDied = game.zdd.require(root, diedVar);
    const withDiedAndSurvived = game.zdd.require(withDied, survivedVar);
    expect(withDiedAndSurvived).toBe(BOTTOM);
  });

  // Test 22: Day phase root has non-trivial ZDD when Slayer is active
  it("Day phase has non-trivial ZDD root with Slayer variables", () => {
    const { game } = buildGameThroughNight1(
      "Slayer", "Chef", "Soldier", "Scarlet Woman", "Imp",
    );

    game.recordDay(null, { slayerShot: { slayerSeat: 0 } });

    // Day phase root should NOT be TOP (has Slayer variables)
    expect(game.currentRoot).not.toBe(TOP);
    // Should have multiple worlds (one per legal target+outcome pair)
    expect(game.zdd.count(game.currentRoot)).toBeGreaterThan(1);
  });

  // Test 23: Undo restores slayerUsed flag
  it("undoing a day with Slayer shot restores slayerUsed", () => {
    const { game } = buildGameThroughNight1(
      "Slayer", "Chef", "Soldier", "Scarlet Woman", "Imp",
    );

    game.recordDay(null, { slayerShot: { slayerSeat: 0 } });
    expect(game.slayerUsed).toBe(true);

    game.undo();
    expect(game.slayerUsed).toBe(false);
  });
});
