/**
 * Blood on the Clocktower role distribution engine built on ZDDs.
 *
 * Models role distributions as a family-of-sets problem: each "set"
 * in the ZDD is one valid assignment of roles to a game, where each
 * element is a variable representing "role X is in the game."
 */

import { ZDD, BOTTOM, TOP, type NodeId } from "./zdd.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export enum RoleType {
  Townsfolk = "Townsfolk",
  Outsider = "Outsider",
  Minion = "Minion",
  Demon = "Demon",
}

/**
 * Declares how a role modifies the base distribution when in play.
 *
 * `outsiderDelta` is the number of extra outsiders (townsfolk adjusts
 * by the negative).  For games below `smallGameThreshold` players,
 * `reducedOutsiderDelta` is used instead.
 */
export interface DistributionModifier {
  outsiderDelta: number;
  smallGameThreshold?: number;
  reducedOutsiderDelta?: number;
}

/**
 * Registration capabilities for roles that can mis-register to info roles.
 *
 * `roleTypes` lists the role types the character can register as.
 * `alignments` lists the alignments the character can register as.
 *
 * For example, the Spy (a Minion) can register as Townsfolk, Outsider, or
 * Minion (NOT Demon), and as Good or Evil.
 */
export interface RegistrationCapability {
  roleTypes: RoleType[];
  alignments: Array<"Good" | "Evil">;
}

export interface Role {
  name: string;
  type: RoleType;
  distributionModifier?: DistributionModifier;
  registersAs?: RegistrationCapability;
}

export interface Script {
  name: string;
  roles: Role[];
}

/** Distribution counts per role type for a given player count. */
export interface Distribution {
  townsfolk: number;
  outsiders: number;
  minions: number;
  demons: number;
}

// ---------------------------------------------------------------------------
// Distribution rules
// ---------------------------------------------------------------------------

/**
 * Base distribution for a given player count (5–15), before any
 * role-specific modifiers like Baron.
 */
export function baseDistribution(playerCount: number): Distribution {
  if (playerCount < 5 || playerCount > 15) {
    throw new Error(`Player count ${playerCount} out of range 5–15`);
  }

  // The BotC distribution table. The first bracket [5,6] has 2 entries,
  // then [7,8,9], [10,11,12], [13,14,15] each have 3 entries.
  // Within each bracket: outsiders go 0,1,(2); townsfolk and minions
  // are fixed. Each new bracket adds +2 townsfolk and +1 minion.
  let minions: number;
  let outsiders: number;

  if (playerCount <= 6) {
    // First bracket: [5, 6]
    minions = 1;
    outsiders = playerCount - 5;
  } else {
    // Subsequent brackets of 3: [7,8,9], [10,11,12], [13,14,15]
    const offset = playerCount - 7;
    const bracket = Math.floor(offset / 3);
    minions = 1 + bracket;
    outsiders = offset % 3;
  }

  const demons = 1;
  const townsfolk = playerCount - outsiders - minions - demons;

  return { townsfolk, outsiders, minions, demons };
}

// ---------------------------------------------------------------------------
// Trouble Brewing script data
// ---------------------------------------------------------------------------

export const TROUBLE_BREWING: Script = {
  name: "Trouble Brewing",
  roles: [
    // Townsfolk (13)
    { name: "Washerwoman", type: RoleType.Townsfolk },
    { name: "Librarian", type: RoleType.Townsfolk },
    { name: "Investigator", type: RoleType.Townsfolk },
    { name: "Chef", type: RoleType.Townsfolk },
    { name: "Empath", type: RoleType.Townsfolk },
    { name: "Fortune Teller", type: RoleType.Townsfolk },
    { name: "Undertaker", type: RoleType.Townsfolk },
    { name: "Monk", type: RoleType.Townsfolk },
    { name: "Ravenkeeper", type: RoleType.Townsfolk },
    { name: "Virgin", type: RoleType.Townsfolk },
    { name: "Slayer", type: RoleType.Townsfolk },
    { name: "Soldier", type: RoleType.Townsfolk },
    { name: "Mayor", type: RoleType.Townsfolk },
    // Outsiders (4)
    { name: "Butler", type: RoleType.Outsider },
    { name: "Drunk", type: RoleType.Outsider },
    { name: "Recluse", type: RoleType.Outsider, registersAs: { roleTypes: [RoleType.Outsider, RoleType.Minion, RoleType.Demon], alignments: ["Good", "Evil"] } },
    { name: "Saint", type: RoleType.Outsider },
    // Minions (4)
    { name: "Poisoner", type: RoleType.Minion },
    { name: "Spy", type: RoleType.Minion, registersAs: { roleTypes: [RoleType.Townsfolk, RoleType.Outsider, RoleType.Minion], alignments: ["Good", "Evil"] } },
    { name: "Scarlet Woman", type: RoleType.Minion },
    { name: "Baron", type: RoleType.Minion, distributionModifier: { outsiderDelta: 2, smallGameThreshold: 7, reducedOutsiderDelta: 1 } },
    // Demons (1)
    { name: "Imp", type: RoleType.Demon },
  ],
};

// ---------------------------------------------------------------------------
// ZDD builder
// ---------------------------------------------------------------------------

/**
 * Assign a variable ID to each role. We use 0-based indices matching
 * the role's position in the script's role array.
 */
function roleVarId(script: Script, roleName: string): number {
  const idx = script.roles.findIndex((r) => r.name === roleName);
  if (idx === -1) throw new Error(`Role "${roleName}" not found in script`);
  return idx;
}

/**
 * Build a ZDD of all k-element subsets chosen from a set of variables.
 *
 * `vars` must be sorted in ascending order.
 * Returns a ZDD family where every member set has exactly `k` elements,
 * all drawn from `vars`.
 */
function chooseK(zdd: ZDD, vars: number[], k: number): NodeId {
  if (k === 0) return TOP;
  if (k > vars.length) return BOTTOM;
  if (k === vars.length) {
    // Must take all — single set
    return zdd.singleSet(vars);
  }

  // Cache key: use the remaining vars and k
  // We build bottom-up using the standard recurrence:
  //   C(vars, k) = include(vars[0]) × C(vars[1..], k-1)
  //              ∪ skip(vars[0])    × C(vars[1..], k)
  //
  // But we implement it recursively (with ZDD structural sharing via
  // the unique table providing implicit memoization on structure).

  const memo = new Map<string, NodeId>();

  function go(start: number, remaining: number): NodeId {
    if (remaining === 0) return TOP;
    const available = vars.length - start;
    if (remaining > available) return BOTTOM;
    if (remaining === available) {
      // Must include all remaining vars
      return zdd.singleSet(vars.slice(start));
    }

    const key = `${start},${remaining}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    const v = vars[start];
    const lo = go(start + 1, remaining); // skip v
    const hi = go(start + 1, remaining - 1); // include v

    const node = zdd.getNode(v, lo, hi);
    memo.set(key, node);
    return node;
  }

  return go(0, k);
}

/**
 * Build the ZDD representing all valid role distributions for a given
 * player count on the given script.
 *
 * The approach:
 *  1. Compute the base distribution (how many of each role type).
 *  2. For each role type, build a "choose k from n" ZDD over that
 *     type's variable IDs.
 *  3. Take the cross-product of all four ZDDs (since role types are
 *     disjoint sets of variables, cross-product = all combinations).
 *
 * Roles with a distributionModifier are excluded from the base pool.
 * Use buildDistributionZDDWithModifiers to include modifier variants.
 */
export function buildDistributionZDD(
  zdd: ZDD,
  script: Script,
  playerCount: number,
): NodeId {
  const dist = baseDistribution(playerCount);

  const byType = new Map<RoleType, number[]>();
  for (const type of Object.values(RoleType)) {
    byType.set(type, []);
  }
  for (let i = 0; i < script.roles.length; i++) {
    byType.get(script.roles[i].type)!.push(i);
  }

  // Roles with distribution modifiers must be excluded from the base pool —
  // they are only valid with the modified outsider/townsfolk counts applied,
  // which is handled by buildDistributionZDDWithModifiers.
  for (let i = 0; i < script.roles.length; i++) {
    if (script.roles[i].distributionModifier) {
      const typeList = byType.get(script.roles[i].type)!;
      byType.set(script.roles[i].type, typeList.filter((v) => v !== i));
    }
  }

  // Each group's vars are already in ascending order (by construction).
  const townsfolkZDD = chooseK(zdd, byType.get(RoleType.Townsfolk)!, dist.townsfolk);
  const outsiderZDD = chooseK(zdd, byType.get(RoleType.Outsider)!, dist.outsiders);
  const minionZDD = chooseK(zdd, byType.get(RoleType.Minion)!, dist.minions);
  const demonZDD = chooseK(zdd, byType.get(RoleType.Demon)!, dist.demons);

  // Cross-product: since the variable sets are disjoint, this gives us
  // all valid combinations.
  let result = zdd.product(townsfolkZDD, outsiderZDD);
  result = zdd.product(result, minionZDD);
  result = zdd.product(result, demonZDD);

  return result;
}

/**
 * Build the ZDD of all valid distributions, including variants for each
 * role that declares a distributionModifier.
 *
 * For each modifier role the distribution shifts by its effective delta
 * (outsiders increase, townsfolk decrease). The modifier role is forced
 * into every set it produces. The final result is the union of the base
 * distribution with one variant per modifier role.
 */
export function buildDistributionZDDWithModifiers(
  zdd: ZDD,
  script: Script,
  playerCount: number,
): NodeId {
  const base = buildDistributionZDD(zdd, script, playerCount);

  // Collect roles that have distribution modifiers
  const modifierRoles: { idx: number; mod: DistributionModifier }[] = [];
  for (let i = 0; i < script.roles.length; i++) {
    const m = script.roles[i].distributionModifier;
    if (m) modifierRoles.push({ idx: i, mod: m });
  }
  if (modifierRoles.length === 0) return base;

  // Build the full byType map (including modifier roles — they are forced
  // into their own variant, and excluded from each other's).
  const byType = new Map<RoleType, number[]>();
  for (const type of Object.values(RoleType)) {
    byType.set(type, []);
  }
  for (let i = 0; i < script.roles.length; i++) {
    byType.get(script.roles[i].type)!.push(i);
  }

  const dist = baseDistribution(playerCount);
  let result = base;

  for (const { idx, mod } of modifierRoles) {
    // Compute effective delta for this player count
    const delta =
      mod.smallGameThreshold != null &&
      mod.reducedOutsiderDelta != null &&
      playerCount < mod.smallGameThreshold
        ? mod.reducedOutsiderDelta
        : mod.outsiderDelta;

    const modifiedDist: Distribution = {
      townsfolk: dist.townsfolk - delta,
      outsiders: dist.outsiders + delta,
      minions: dist.minions,
      demons: dist.demons,
    };

    // Validate modified distribution is feasible
    if (
      modifiedDist.townsfolk < 0 ||
      modifiedDist.outsiders > byType.get(RoleType.Outsider)!.length
    ) {
      continue; // Can't apply this modifier at this player count
    }

    // Build modified distribution: the modifier role must be included.
    // Choose the remaining same-type roles from the pool minus this role.
    const roleType = script.roles[idx].type;
    const sameTypeVars = byType.get(roleType)!;
    const otherSameType = sameTypeVars.filter((v) => v !== idx);

    const typeCount = roleType === RoleType.Minion ? modifiedDist.minions
                    : roleType === RoleType.Outsider ? modifiedDist.outsiders
                    : roleType === RoleType.Townsfolk ? modifiedDist.townsfolk
                    : modifiedDist.demons;

    const forcedSingle = zdd.singleSet([idx]);
    const otherSameTypeZDD = chooseK(zdd, otherSameType, typeCount - 1);
    const forcedTypeZDD = zdd.product(forcedSingle, otherSameTypeZDD);

    // Build the other type ZDDs normally
    let variant = forcedTypeZDD;
    for (const type of Object.values(RoleType)) {
      if (type === roleType) continue;
      const count = type === RoleType.Townsfolk ? modifiedDist.townsfolk
                  : type === RoleType.Outsider ? modifiedDist.outsiders
                  : type === RoleType.Minion ? modifiedDist.minions
                  : modifiedDist.demons;
      const typeZDD = chooseK(zdd, byType.get(type)!, count);
      variant = zdd.product(variant, typeZDD);
    }

    result = zdd.union(result, variant);
  }

  return result;
}

/**
 * Resolve a set of variable IDs back to role names.
 */
export function resolveRoles(script: Script, varIds: number[]): string[] {
  return varIds.map((id) => script.roles[id].name);
}
