import { describe, it, expect } from "vitest";
import {
  ddmin,
  minimize,
  StochasticOracle,
  BudgetExhaustedError,
  type Oracle,
} from "../src/minimize.js";

describe("ddmin", () => {
  it("finds the minimal subset with a deterministic oracle", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const minimalSet = new Set([3, 7]);

    const result = await ddmin(items, async (subset) => {
      return minimalSet.size > 0 &&
        [...minimalSet].every((x) => subset.includes(x));
    });

    expect(result).toEqual(expect.arrayContaining([3, 7]));
    expect(result.length).toBeLessThanOrEqual(3);
    for (const x of [3, 7]) {
      expect(result).toContain(x);
    }
  });

  it("returns the single item when input has one element", async () => {
    const result = await ddmin([42], async () => true);
    expect(result).toEqual([42]);
  });

  it("returns full set when every item is required", async () => {
    const items = [1, 2, 3];
    const result = await ddmin(items, async (subset) => {
      return subset.length === items.length;
    });
    expect(result).toEqual(items);
  });

  it("handles a single necessary item in a large set", async () => {
    const items = Array.from({ length: 16 }, (_, i) => i);
    const result = await ddmin(items, async (subset) => {
      return subset.includes(7);
    });
    expect(result).toEqual([7]);
  });
});

describe("StochasticOracle", () => {
  it("accepts when m-of-k succeed", async () => {
    let callCount = 0;
    const inner: Oracle<number> = {
      async test() {
        callCount++;
        return callCount % 2 === 1;
      },
    };

    const oracle = new StochasticOracle(inner, {
      k: 3,
      m: 2,
      budgetDollars: 10,
      costPerCall: 0.01,
    });

    const result = await oracle.test([1, 2, 3]);
    expect(typeof result).toBe("boolean");
    expect(oracle.getSpend()).toBeGreaterThan(0);
  });

  it("rejects when fewer than m succeed", async () => {
    let callCount = 0;
    const inner: Oracle<number> = {
      async test() {
        callCount++;
        return callCount === 1;
      },
    };

    const oracle = new StochasticOracle(inner, {
      k: 3,
      m: 3,
      budgetDollars: 10,
      costPerCall: 0.01,
    });

    const result = await oracle.test([1]);
    expect(result).toBe(false);
  });

  it("throws BudgetExhaustedError when budget exceeded", async () => {
    const inner: Oracle<number> = {
      async test() { return true; },
    };

    const oracle = new StochasticOracle(inner, {
      k: 3,
      m: 2,
      budgetDollars: 0.25,
      costPerCall: 0.10,
    });

    await oracle.test([1]);
    await expect(oracle.test([1])).rejects.toThrow(BudgetExhaustedError);
    expect(oracle.getSpend()).toBeLessThanOrEqual(0.30);
  });
});

describe("minimize", () => {
  it("budget enforcement stops early and reports partial result", async () => {
    let oracleCallCount = 0;
    const inner: Oracle<number> = {
      async test() {
        oracleCallCount++;
        return true;
      },
    };

    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = await minimize(items, inner, {
      k: 1,
      m: 1,
      budgetDollars: 0.25,
      costPerCall: 0.10,
    });

    expect(result.spend).toBeLessThanOrEqual(0.30);
    expect(result.budgetExhausted).toBe(true);
    expect(result.originalCount).toBe(8);
    expect(oracleCallCount).toBeLessThanOrEqual(3);
  });

  it("low reproduction rate returns original set", async () => {
    const inner: Oracle<number> = {
      async test() { return false; },
    };

    const items = [1, 2, 3, 4, 5];
    const result = await minimize(items, inner, {
      k: 3,
      m: 2,
      budgetDollars: 10,
      costPerCall: 0.01,
    });

    expect(result.reproductionRate).toBe(0);
    expect(result.minimalCount).toBe(items.length);
    expect(result.minimal).toEqual(items);
  });

  it("finds minimal set end-to-end", async () => {
    const target = new Set([2, 5]);
    const inner: Oracle<number> = {
      async test(subset) {
        return [...target].every((x) => subset.includes(x));
      },
    };

    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = await minimize(items, inner, {
      k: 1,
      m: 1,
      budgetDollars: 100,
      costPerCall: 0.01,
    });

    expect(result.budgetExhausted).toBe(false);
    expect(result.reproductionRate).toBe(1.0);
    for (const x of [2, 5]) {
      expect(result.minimal).toContain(x);
    }
    expect(result.minimalCount).toBeLessThanOrEqual(3);
    expect(result.originalCount).toBe(8);
  });
});
