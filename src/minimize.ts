export interface MinimizeResult<T> {
  minimal: T[];
  originalCount: number;
  minimalCount: number;
  reproductionRate: number;
  totalCalls: number;
  spend: number;
  budgetExhausted: boolean;
}

export interface OracleOptions {
  k: number;
  m: number;
  budgetDollars: number;
  costPerCall: number;
}

export interface Oracle<T> {
  test(subset: T[]): Promise<boolean>;
}

export class BudgetExhaustedError extends Error {
  constructor(
    public readonly spend: number,
    public readonly budget: number,
  ) {
    super(`Budget exhausted: spent $${spend.toFixed(2)} of $${budget.toFixed(2)}`);
  }
}

export class StochasticOracle<T> {
  private spend = 0;
  private totalCalls = 0;
  private readonly inner: Oracle<T>;
  private readonly opts: OracleOptions;

  constructor(inner: Oracle<T>, opts: OracleOptions) {
    this.inner = inner;
    this.opts = opts;
  }

  async test(subset: T[]): Promise<boolean> {
    let successes = 0;
    for (let i = 0; i < this.opts.k; i++) {
      if (this.spend + this.opts.costPerCall > this.opts.budgetDollars) {
        throw new BudgetExhaustedError(this.spend, this.opts.budgetDollars);
      }
      this.spend += this.opts.costPerCall;
      this.totalCalls++;
      const result = await this.inner.test(subset);
      if (result) successes++;
      if (successes >= this.opts.m) return true;
      if (this.opts.k - i - 1 + successes < this.opts.m) return false;
    }
    return successes >= this.opts.m;
  }

  getSpend(): number {
    return this.spend;
  }

  getTotalCalls(): number {
    return this.totalCalls;
  }
}

export async function ddmin<T>(
  items: T[],
  test: (subset: T[]) => Promise<boolean>,
): Promise<T[]> {
  if (items.length <= 1) return items;

  let n = 2;
  let current = [...items];

  while (current.length >= 2) {
    const chunkSize = Math.ceil(current.length / n);
    let reduced = false;

    for (let i = 0; i < n; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, current.length);
      const complement = [
        ...current.slice(0, start),
        ...current.slice(end),
      ];

      if (complement.length === 0) continue;

      if (await test(complement)) {
        current = complement;
        n = Math.max(n - 1, 2);
        reduced = true;
        break;
      }
    }

    if (!reduced) {
      if (n >= current.length) break;
      n = Math.min(n * 2, current.length);
    }
  }

  return current;
}

export async function minimize<T>(
  items: T[],
  oracle: Oracle<T>,
  opts: OracleOptions,
): Promise<MinimizeResult<T>> {
  const stochastic = new StochasticOracle(oracle, opts);

  let minimal: T[];
  let budgetExhausted = false;
  let reproductionRate = 0;

  const initialResult = await stochastic.test(items);
  if (!initialResult) {
    reproductionRate = 0;
    return {
      minimal: items,
      originalCount: items.length,
      minimalCount: items.length,
      reproductionRate,
      totalCalls: stochastic.getTotalCalls(),
      spend: stochastic.getSpend(),
      budgetExhausted: false,
    };
  }

  try {
    minimal = await ddmin(items, (subset) => stochastic.test(subset));
  } catch (err) {
    if (err instanceof BudgetExhaustedError) {
      budgetExhausted = true;
      minimal = items;
    } else {
      throw err;
    }
  }

  reproductionRate = 1.0;

  return {
    minimal,
    originalCount: items.length,
    minimalCount: minimal.length,
    reproductionRate,
    totalCalls: stochastic.getTotalCalls(),
    spend: stochastic.getSpend(),
    budgetExhausted,
  };
}
