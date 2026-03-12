/**
 * Zero-suppressed Decision Diagram (ZDD) implementation.
 *
 * A ZDD represents a family of sets over a universe of variables.
 * Unlike BDDs, ZDDs use the "zero-suppressed" reduction rule: a node
 * whose HI edge points to the empty family (⊥) is removed, and its
 * incoming edge is redirected to its LO child. This makes ZDDs
 * particularly efficient for representing sparse sets — exactly what
 * we need for BotC role distributions where most roles are absent.
 *
 * Terminal nodes:
 *   ⊥ (Bottom / empty family) — represents no sets at all
 *   ⊤ (Top / unit family)     — represents the family containing
 *                                only the empty set: { ∅ }
 */

// ---------------------------------------------------------------------------
// Node representation
// ---------------------------------------------------------------------------

/** Terminal node IDs. */
export const BOTTOM = 0; // ⊥  — the empty family
export const TOP = 1; // ⊤  — { ∅ }

/** Internal node ID (index into the node table). */
export type NodeId = number;

interface InternalNode {
  /** Variable index (lower = closer to root in the ordering). */
  variable: number;
  /** LO child — subfamilies of sets that do NOT contain this variable. */
  lo: NodeId;
  /** HI child — subfamilies of sets that DO contain this variable. */
  hi: NodeId;
}

// ---------------------------------------------------------------------------
// Unique table (hash-consing)
// ---------------------------------------------------------------------------

export class ZDD {
  private nodes: InternalNode[] = [];
  private uniqueTable = new Map<string, NodeId>();
  private opCache = new Map<string, NodeId>();

  /** Number of allocated internal nodes (excludes terminals). */
  get size(): number {
    return this.nodes.length;
  }

  /**
   * Get or create a node. Enforces the ZDD zero-suppression rule:
   * if hi === BOTTOM the node is suppressed and we return lo directly.
   */
  getNode(variable: number, lo: NodeId, hi: NodeId): NodeId {
    // Zero-suppression rule
    if (hi === BOTTOM) return lo;

    const key = `${variable},${lo},${hi}`;
    const existing = this.uniqueTable.get(key);
    if (existing !== undefined) return existing;

    const id = this.nodes.length + 2; // +2 because 0=BOTTOM, 1=TOP
    this.nodes.push({ variable, lo, hi });
    this.uniqueTable.set(key, id);
    return id;
  }

  /** Look up a node by ID. Throws for terminal IDs. */
  private node(id: NodeId): InternalNode {
    if (id < 2) throw new Error(`Cannot look up terminal node ${id}`);
    return this.nodes[id - 2];
  }

  private isTerminal(id: NodeId): boolean {
    return id < 2;
  }

  private varOf(id: NodeId): number {
    return this.node(id).variable;
  }

  private loOf(id: NodeId): NodeId {
    return this.node(id).lo;
  }

  private hiOf(id: NodeId): NodeId {
    return this.node(id).hi;
  }

  // -----------------------------------------------------------------------
  // Cache helpers
  // -----------------------------------------------------------------------

  private cacheKey(op: string, ...args: NodeId[]): string {
    return `${op}:${args.join(",")}`;
  }

  /** Clear the operation cache (useful between independent builds). */
  clearCache(): void {
    this.opCache.clear();
  }

  // -----------------------------------------------------------------------
  // Constructors for single-element / single-set families
  // -----------------------------------------------------------------------

  /** Family containing exactly one set: { {v} }. */
  single(v: number): NodeId {
    return this.getNode(v, BOTTOM, TOP);
  }

  /**
   * Family containing exactly one set that is the given sorted array
   * of variables: { {v1, v2, …} }.  Variables must be in ascending order.
   */
  singleSet(vars: number[]): NodeId {
    let node: NodeId = TOP;
    for (let i = vars.length - 1; i >= 0; i--) {
      node = this.getNode(vars[i], BOTTOM, node);
    }
    return node;
  }

  // -----------------------------------------------------------------------
  // Core family-algebra operations
  // -----------------------------------------------------------------------

  /** Union of two families: P ∪ Q. */
  union(p: NodeId, q: NodeId): NodeId {
    if (p === BOTTOM) return q;
    if (q === BOTTOM) return p;
    if (p === q) return p;

    // Canonical ordering for cache
    const a = Math.min(p, q);
    const b = Math.max(p, q);
    const ck = this.cacheKey("U", a, b);
    const cached = this.opCache.get(ck);
    if (cached !== undefined) return cached;

    let result: NodeId;

    if (p === TOP && q === TOP) {
      result = TOP;
    } else if (p === TOP) {
      // TOP ∪ Q: add the empty set to Q
      const qn = this.node(q);
      result = this.getNode(qn.variable, this.union(TOP, qn.lo), qn.hi);
    } else if (q === TOP) {
      result = this.union(q, p);
    } else {
      const pv = this.varOf(p);
      const qv = this.varOf(q);

      if (pv < qv) {
        result = this.getNode(pv, this.union(this.loOf(p), q), this.hiOf(p));
      } else if (pv > qv) {
        result = this.getNode(qv, this.union(p, this.loOf(q)), this.hiOf(q));
      } else {
        result = this.getNode(
          pv,
          this.union(this.loOf(p), this.loOf(q)),
          this.union(this.hiOf(p), this.hiOf(q)),
        );
      }
    }

    this.opCache.set(ck, result);
    return result;
  }

  /** Intersection of two families: P ∩ Q. */
  intersection(p: NodeId, q: NodeId): NodeId {
    if (p === BOTTOM || q === BOTTOM) return BOTTOM;
    if (p === q) return p;

    const a = Math.min(p, q);
    const b = Math.max(p, q);
    const ck = this.cacheKey("I", a, b);
    const cached = this.opCache.get(ck);
    if (cached !== undefined) return cached;

    let result: NodeId;

    if (p === TOP && q === TOP) {
      result = TOP;
    } else if (p === TOP) {
      // TOP ∩ Q: keep only the empty set if Q contains it
      const qn = this.node(q);
      result = this.intersection(TOP, qn.lo);
    } else if (q === TOP) {
      result = this.intersection(q, p);
    } else {
      const pv = this.varOf(p);
      const qv = this.varOf(q);

      if (pv < qv) {
        result = this.intersection(this.loOf(p), q);
      } else if (pv > qv) {
        result = this.intersection(p, this.loOf(q));
      } else {
        result = this.getNode(
          pv,
          this.intersection(this.loOf(p), this.loOf(q)),
          this.intersection(this.hiOf(p), this.hiOf(q)),
        );
      }
    }

    this.opCache.set(ck, result);
    return result;
  }

  /** Difference of two families: P \ Q (sets in P but not in Q). */
  difference(p: NodeId, q: NodeId): NodeId {
    if (p === BOTTOM) return BOTTOM;
    if (q === BOTTOM) return p;
    if (p === q) return BOTTOM;

    const ck = this.cacheKey("D", p, q);
    const cached = this.opCache.get(ck);
    if (cached !== undefined) return cached;

    let result: NodeId;

    if (p === TOP && q === TOP) {
      result = BOTTOM;
    } else if (p === TOP) {
      const qn = this.node(q);
      result = this.difference(TOP, qn.lo);
    } else if (q === TOP) {
      const pn = this.node(p);
      result = this.getNode(pn.variable, this.difference(pn.lo, TOP), pn.hi);
    } else {
      const pv = this.varOf(p);
      const qv = this.varOf(q);

      if (pv < qv) {
        result = this.getNode(
          pv,
          this.difference(this.loOf(p), q),
          this.hiOf(p),
        );
      } else if (pv > qv) {
        result = this.difference(p, this.loOf(q));
      } else {
        result = this.getNode(
          pv,
          this.difference(this.loOf(p), this.loOf(q)),
          this.difference(this.hiOf(p), this.hiOf(q)),
        );
      }
    }

    this.opCache.set(ck, result);
    return result;
  }

  // -----------------------------------------------------------------------
  // Subset / restriction operations
  // -----------------------------------------------------------------------

  /**
   * Restrict: remove variable `v` from every set in the family.
   * Returns the family where `v` is treated as "don't care":
   *   { S \ {v} | S ∈ F }
   */
  removeVar(f: NodeId, v: number): NodeId {
    if (this.isTerminal(f)) return f;

    const ck = this.cacheKey("RV", f, v);
    const cached = this.opCache.get(ck);
    if (cached !== undefined) return cached;

    const fv = this.varOf(f);
    let result: NodeId;

    if (fv > v) {
      result = f; // v not present anywhere below
    } else if (fv === v) {
      result = this.union(this.loOf(f), this.hiOf(f));
    } else {
      result = this.getNode(
        fv,
        this.removeVar(this.loOf(f), v),
        this.removeVar(this.hiOf(f), v),
      );
    }

    this.opCache.set(ck, result);
    return result;
  }

  /**
   * Onset: keep only the sets that contain variable `v`, then remove `v`
   * from each of those sets.
   */
  onset(f: NodeId, v: number): NodeId {
    if (this.isTerminal(f)) return BOTTOM;

    const ck = this.cacheKey("ON", f, v);
    const cached = this.opCache.get(ck);
    if (cached !== undefined) return cached;

    const fv = this.varOf(f);
    let result: NodeId;

    if (fv > v) {
      result = BOTTOM;
    } else if (fv === v) {
      result = this.hiOf(f);
    } else {
      result = this.getNode(
        fv,
        this.onset(this.loOf(f), v),
        this.onset(this.hiOf(f), v),
      );
    }

    this.opCache.set(ck, result);
    return result;
  }

  /**
   * Offset: keep only the sets that do NOT contain variable `v`.
   */
  offset(f: NodeId, v: number): NodeId {
    if (this.isTerminal(f)) return f;

    const ck = this.cacheKey("OF", f, v);
    const cached = this.opCache.get(ck);
    if (cached !== undefined) return cached;

    const fv = this.varOf(f);
    let result: NodeId;

    if (fv > v) {
      result = f;
    } else if (fv === v) {
      result = this.loOf(f);
    } else {
      result = this.getNode(
        fv,
        this.offset(this.loOf(f), v),
        this.offset(this.hiOf(f), v),
      );
    }

    this.opCache.set(ck, result);
    return result;
  }

  /**
   * Require variable: keep only the sets that contain `v` (but keep `v`
   * in the sets, unlike onset).
   */
  require(f: NodeId, v: number): NodeId {
    const sub = this.onset(f, v);
    if (sub === BOTTOM) return BOTTOM;
    // Re-add v to every set
    return this.getNode(v, BOTTOM, sub);
  }

  /**
   * Cross product of two families: { A ∪ B | A ∈ P, B ∈ Q }.
   * Requires that P and Q operate on disjoint variable sets.
   */
  product(p: NodeId, q: NodeId): NodeId {
    if (p === BOTTOM || q === BOTTOM) return BOTTOM;
    if (p === TOP) return q;
    if (q === TOP) return p;

    const ck = this.cacheKey("P", p, q);
    const cached = this.opCache.get(ck);
    if (cached !== undefined) return cached;

    const pv = this.varOf(p);
    const qv = this.varOf(q);
    let result: NodeId;

    if (pv < qv) {
      result = this.getNode(
        pv,
        this.product(this.loOf(p), q),
        this.product(this.hiOf(p), q),
      );
    } else {
      result = this.getNode(
        qv,
        this.product(p, this.loOf(q)),
        this.product(p, this.hiOf(q)),
      );
    }

    this.opCache.set(ck, result);
    return result;
  }

  // -----------------------------------------------------------------------
  // Counting & enumeration
  // -----------------------------------------------------------------------

  /** Count the number of sets in the family. */
  count(f: NodeId): number {
    if (f === BOTTOM) return 0;
    if (f === TOP) return 1;

    const memo = new Map<NodeId, number>();
    const go = (id: NodeId): number => {
      if (id === BOTTOM) return 0;
      if (id === TOP) return 1;
      const cached = memo.get(id);
      if (cached !== undefined) return cached;
      const n = this.node(id);
      const c = go(n.lo) + go(n.hi);
      memo.set(id, c);
      return c;
    };
    return go(f);
  }

  /** Enumerate all sets in the family. Use with care on large families. */
  enumerate(f: NodeId): number[][] {
    if (f === BOTTOM) return [];
    if (f === TOP) return [[]];

    const results: number[][] = [];
    const path: number[] = [];

    const go = (id: NodeId): void => {
      if (id === BOTTOM) return;
      if (id === TOP) {
        results.push([...path]);
        return;
      }
      const n = this.node(id);
      // LO branch: variable not included
      go(n.lo);
      // HI branch: variable included
      path.push(n.variable);
      go(n.hi);
      path.pop();
    };

    go(f);
    return results;
  }
}
