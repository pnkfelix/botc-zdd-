import { describe, it, expect } from "vitest";
import { ZDD } from "../src/zdd.js";
import {
  TROUBLE_BREWING,
  RoleType,
  baseDistribution,
  buildDistributionZDD,
  buildDistributionZDDWithBaron,
  resolveRoles,
} from "../src/botc.js";

describe("baseDistribution", () => {
  it("5 players: 3T 0O 1M 1D", () => {
    const d = baseDistribution(5);
    expect(d).toEqual({ townsfolk: 3, outsiders: 0, minions: 1, demons: 1 });
  });

  it("6 players: 3T 1O 1M 1D", () => {
    const d = baseDistribution(6);
    expect(d).toEqual({ townsfolk: 3, outsiders: 1, minions: 1, demons: 1 });
  });

  it("7 players: 5T 0O 1M 1D", () => {
    const d = baseDistribution(7);
    expect(d).toEqual({ townsfolk: 5, outsiders: 0, minions: 1, demons: 1 });
  });

  it("10 players: 7T 0O 2M 1D", () => {
    const d = baseDistribution(10);
    expect(d).toEqual({ townsfolk: 7, outsiders: 0, minions: 2, demons: 1 });
  });

  it("15 players: 9T 2O 3M 1D", () => {
    const d = baseDistribution(15);
    expect(d).toEqual({ townsfolk: 9, outsiders: 2, minions: 3, demons: 1 });
  });

  it("throws for out-of-range player counts", () => {
    expect(() => baseDistribution(4)).toThrow();
    expect(() => baseDistribution(16)).toThrow();
  });
});

describe("Trouble Brewing script", () => {
  it("has 22 roles", () => {
    expect(TROUBLE_BREWING.roles.length).toBe(22);
  });

  it("has correct type counts", () => {
    const counts = { Townsfolk: 0, Outsider: 0, Minion: 0, Demon: 0 };
    for (const role of TROUBLE_BREWING.roles) {
      counts[role.type]++;
    }
    expect(counts).toEqual({
      Townsfolk: 13,
      Outsider: 4,
      Minion: 4,
      Demon: 1,
    });
  });
});

describe("buildDistributionZDD", () => {
  // Expected counts for Trouble Brewing (base distribution, no modifiers):
  //   C(townsfolk, t) * C(outsiders, o) * C(minions, m) * C(demons, d)
  //
  // 5p: C(13,3)*C(4,0)*C(4,1)*C(1,1) = 286*1*4*1 = 1144
  // 6p: C(13,3)*C(4,1)*C(4,1)*C(1,1) = 286*4*4*1 = 4576
  // 7p: C(13,5)*C(4,0)*C(4,1)*C(1,1) = 1287*1*4*1 = 5148
  // 10p: C(13,7)*C(4,0)*C(4,2)*C(1,1) = 1716*1*6*1 = 10296

  it("5 players: 1144 distributions", () => {
    const zdd = new ZDD();
    const root = buildDistributionZDD(zdd, TROUBLE_BREWING, 5);
    expect(zdd.count(root)).toBe(1144);
  });

  it("6 players: 4576 distributions", () => {
    const zdd = new ZDD();
    const root = buildDistributionZDD(zdd, TROUBLE_BREWING, 6);
    expect(zdd.count(root)).toBe(4576);
  });

  it("7 players: 5148 distributions", () => {
    const zdd = new ZDD();
    const root = buildDistributionZDD(zdd, TROUBLE_BREWING, 7);
    expect(zdd.count(root)).toBe(5148);
  });

  it("10 players: 10296 distributions", () => {
    const zdd = new ZDD();
    const root = buildDistributionZDD(zdd, TROUBLE_BREWING, 10);
    expect(zdd.count(root)).toBe(10296);
  });

  it("every enumerated set has the correct size", () => {
    const zdd = new ZDD();
    const root = buildDistributionZDD(zdd, TROUBLE_BREWING, 5);
    const sets = zdd.enumerate(root);
    for (const s of sets) {
      expect(s.length).toBe(5);
    }
  });

  it("roles can be resolved back to names", () => {
    const zdd = new ZDD();
    const root = buildDistributionZDD(zdd, TROUBLE_BREWING, 5);
    const sets = zdd.enumerate(root);
    const firstSet = sets[0];
    const names = resolveRoles(TROUBLE_BREWING, firstSet);
    expect(names.length).toBe(5);
    for (const name of names) {
      expect(TROUBLE_BREWING.roles.some((r) => r.name === name)).toBe(true);
    }
  });
});

describe("buildDistributionZDDWithBaron", () => {
  it("5 players with Baron: more distributions than base", () => {
    const zdd = new ZDD();
    const base = buildDistributionZDD(zdd, TROUBLE_BREWING, 5);
    const withBaron = buildDistributionZDDWithBaron(zdd, TROUBLE_BREWING, 5);

    const baseCount = zdd.count(base);
    const baronCount = zdd.count(withBaron);
    expect(baronCount).toBeGreaterThan(baseCount);
  });

  it("5 players with Baron: base (1144) + Baron-modified distributions", () => {
    const zdd = new ZDD();
    const root = buildDistributionZDDWithBaron(zdd, TROUBLE_BREWING, 5);
    // Baron at 5p: 1T 2O 1M(Baron) 1D
    // C(13,1)*C(4,2)*C(3,0)*C(1,1) = 13*6*1*1 = 78
    // Total: 1144 + 78 = 1222
    expect(zdd.count(root)).toBe(1222);
  });

  it("7 players with Baron: base + Baron-modified", () => {
    const zdd = new ZDD();
    const root = buildDistributionZDDWithBaron(zdd, TROUBLE_BREWING, 7);
    // Baron at 7p: 3T 2O 1M(Baron) 1D
    // C(13,3)*C(4,2)*C(3,0)*C(1,1) = 286*6*1*1 = 1716
    // Total: 5148 + 1716 = 6864
    expect(zdd.count(root)).toBe(6864);
  });

  it("Baron-modified sets always include Baron", () => {
    const zdd = new ZDD();
    const base = buildDistributionZDD(zdd, TROUBLE_BREWING, 5);
    const withBaron = buildDistributionZDDWithBaron(zdd, TROUBLE_BREWING, 5);
    const baronOnly = zdd.difference(withBaron, base);

    const baronIdx = TROUBLE_BREWING.roles.findIndex(
      (r) => r.name === "Baron",
    );
    const sets = zdd.enumerate(baronOnly);
    for (const s of sets) {
      expect(s).toContain(baronIdx);
    }
  });
});
