import { describe, it, expect } from "vitest";
import { ZDD, BOTTOM, TOP } from "../src/zdd.js";

describe("ZDD", () => {
  describe("terminals", () => {
    it("BOTTOM has count 0", () => {
      const zdd = new ZDD();
      expect(zdd.count(BOTTOM)).toBe(0);
    });

    it("TOP has count 1 (the empty set)", () => {
      const zdd = new ZDD();
      expect(zdd.count(TOP)).toBe(1);
    });

    it("BOTTOM enumerates to nothing", () => {
      const zdd = new ZDD();
      expect(zdd.enumerate(BOTTOM)).toEqual([]);
    });

    it("TOP enumerates to [ [] ]", () => {
      const zdd = new ZDD();
      expect(zdd.enumerate(TOP)).toEqual([[]]);
    });
  });

  describe("single element", () => {
    it("single(v) represents { {v} }", () => {
      const zdd = new ZDD();
      const f = zdd.single(3);
      expect(zdd.count(f)).toBe(1);
      expect(zdd.enumerate(f)).toEqual([[3]]);
    });
  });

  describe("singleSet", () => {
    it("creates a single multi-element set", () => {
      const zdd = new ZDD();
      const f = zdd.singleSet([1, 3, 5]);
      expect(zdd.count(f)).toBe(1);
      expect(zdd.enumerate(f)).toEqual([[1, 3, 5]]);
    });
  });

  describe("union", () => {
    it("union with BOTTOM is identity", () => {
      const zdd = new ZDD();
      const f = zdd.single(1);
      expect(zdd.union(f, BOTTOM)).toBe(f);
      expect(zdd.union(BOTTOM, f)).toBe(f);
    });

    it("union of two disjoint singletons", () => {
      const zdd = new ZDD();
      const a = zdd.single(1);
      const b = zdd.single(2);
      const u = zdd.union(a, b);
      expect(zdd.count(u)).toBe(2);
      const sets = zdd.enumerate(u);
      expect(sets).toContainEqual([1]);
      expect(sets).toContainEqual([2]);
    });

    it("union is idempotent", () => {
      const zdd = new ZDD();
      const a = zdd.single(1);
      expect(zdd.union(a, a)).toBe(a);
    });

    it("union with TOP adds empty set", () => {
      const zdd = new ZDD();
      const a = zdd.single(1);
      const u = zdd.union(a, TOP);
      expect(zdd.count(u)).toBe(2);
      expect(zdd.enumerate(u)).toEqual([[], [1]]);
    });
  });

  describe("intersection", () => {
    it("intersection with BOTTOM is BOTTOM", () => {
      const zdd = new ZDD();
      const f = zdd.single(1);
      expect(zdd.intersection(f, BOTTOM)).toBe(BOTTOM);
    });

    it("intersection of disjoint families is BOTTOM", () => {
      const zdd = new ZDD();
      const a = zdd.single(1);
      const b = zdd.single(2);
      expect(zdd.intersection(a, b)).toBe(BOTTOM);
    });

    it("intersection with self is identity", () => {
      const zdd = new ZDD();
      const a = zdd.single(1);
      expect(zdd.intersection(a, a)).toBe(a);
    });

    it("intersection of overlapping families", () => {
      const zdd = new ZDD();
      const a = zdd.single(1);
      const b = zdd.single(2);
      const c = zdd.single(1);
      const ab = zdd.union(a, b);
      const ac = zdd.union(a, zdd.single(3));
      const result = zdd.intersection(ab, ac);
      expect(zdd.count(result)).toBe(1);
      expect(zdd.enumerate(result)).toEqual([[1]]);
    });
  });

  describe("difference", () => {
    it("difference with BOTTOM is identity", () => {
      const zdd = new ZDD();
      const f = zdd.single(1);
      expect(zdd.difference(f, BOTTOM)).toBe(f);
    });

    it("difference with self is BOTTOM", () => {
      const zdd = new ZDD();
      const f = zdd.single(1);
      expect(zdd.difference(f, f)).toBe(BOTTOM);
    });

    it("removes matching sets", () => {
      const zdd = new ZDD();
      const a = zdd.single(1);
      const b = zdd.single(2);
      const ab = zdd.union(a, b);
      const result = zdd.difference(ab, a);
      expect(zdd.count(result)).toBe(1);
      expect(zdd.enumerate(result)).toEqual([[2]]);
    });
  });

  describe("onset / offset / require", () => {
    it("onset keeps sets containing v, removes v", () => {
      const zdd = new ZDD();
      const a = zdd.singleSet([1, 2]);
      const b = zdd.singleSet([2, 3]);
      const f = zdd.union(a, b);
      const result = zdd.onset(f, 1);
      expect(zdd.count(result)).toBe(1);
      expect(zdd.enumerate(result)).toEqual([[2]]);
    });

    it("offset keeps sets not containing v", () => {
      const zdd = new ZDD();
      const a = zdd.singleSet([1, 2]);
      const b = zdd.singleSet([2, 3]);
      const f = zdd.union(a, b);
      const result = zdd.offset(f, 1);
      expect(zdd.count(result)).toBe(1);
      expect(zdd.enumerate(result)).toEqual([[2, 3]]);
    });

    it("require keeps sets containing v, keeps v in them", () => {
      const zdd = new ZDD();
      const a = zdd.singleSet([1, 2]);
      const b = zdd.singleSet([2, 3]);
      const f = zdd.union(a, b);
      const result = zdd.require(f, 1);
      expect(zdd.count(result)).toBe(1);
      expect(zdd.enumerate(result)).toEqual([[1, 2]]);
    });
  });

  describe("product (cross product)", () => {
    it("product of two singleton families", () => {
      const zdd = new ZDD();
      const a = zdd.single(1);
      const b = zdd.single(5);
      const p = zdd.product(a, b);
      expect(zdd.count(p)).toBe(1);
      expect(zdd.enumerate(p)).toEqual([[1, 5]]);
    });

    it("product of multi-element families", () => {
      const zdd = new ZDD();
      // {1} ∪ {2}
      const left = zdd.union(zdd.single(1), zdd.single(2));
      // {10} ∪ {11}
      const right = zdd.union(zdd.single(10), zdd.single(11));
      const p = zdd.product(left, right);
      expect(zdd.count(p)).toBe(4);
      const sets = zdd.enumerate(p);
      expect(sets).toContainEqual([1, 10]);
      expect(sets).toContainEqual([1, 11]);
      expect(sets).toContainEqual([2, 10]);
      expect(sets).toContainEqual([2, 11]);
    });
  });

  describe("choose k from n (via product + union)", () => {
    it("choosing 2 from {0,1,2} gives C(3,2) = 3 sets", () => {
      const zdd = new ZDD();
      // Build all 2-subsets of {0, 1, 2} manually
      const s01 = zdd.singleSet([0, 1]);
      const s02 = zdd.singleSet([0, 2]);
      const s12 = zdd.singleSet([1, 2]);
      const family = zdd.union(zdd.union(s01, s02), s12);
      expect(zdd.count(family)).toBe(3);
    });
  });

  describe("zero-suppression property", () => {
    it("getNode with hi=BOTTOM returns lo directly", () => {
      const zdd = new ZDD();
      const node = zdd.getNode(5, TOP, BOTTOM);
      // Should be suppressed to just TOP
      expect(node).toBe(TOP);
    });

    it("structural sharing via unique table", () => {
      const zdd = new ZDD();
      const a = zdd.getNode(1, BOTTOM, TOP);
      const b = zdd.getNode(1, BOTTOM, TOP);
      expect(a).toBe(b);
    });
  });
});
