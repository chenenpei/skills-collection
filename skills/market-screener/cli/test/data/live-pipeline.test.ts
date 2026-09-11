import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SecurityRecord } from "../../src/shared/financial-model.js";
import { enrichLiveUniverse } from "../../src/us/screening.js";
import { loadSpecBundle } from "../../src/policy/loader.js";
import path from "node:path";

const SPEC_DIR = path.resolve(import.meta.dirname, "../../src/policy");

vi.mock("../../src/us/sources/fundamentals.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/us/sources/fundamentals.js")>(),
  resolveCik: vi.fn(async () => "0000000001"),
  fetchUsAnnualRows: vi.fn(async () => [{ year: 2024, revenue: 1e11, grossProfit: 5e10, netIncome: 2e10, operatingCashFlow: 2e10, roe: 0.2, assetLiabilityRatio: 0.4 }]),
  fetchUsIndustryProxy: vi.fn(async () => "Software"),
}));

vi.mock("../../src/us/sources/market-data.js", () => ({
  fetchUsQuoteSnapshot: vi.fn(async () => ({ metrics: {} })),
  createUsYahooAdapter: vi.fn(() => ({ loadUniverse: vi.fn(async () => []) })),
}));

describe("enrichLiveUniverse", () => {
  let exclusionRules: Awaited<ReturnType<typeof loadSpecBundle>>["exclusionRules"];

  beforeEach(async () => {
    exclusionRules = (await loadSpecBundle(SPEC_DIR)).exclusionRules;
  });

  const base = (overrides: Partial<SecurityRecord> = {}): SecurityRecord => ({
    ticker: "AAPL",
    market: "US",
    companyName: "Apple",
    currency: "USD",
    status: "active",
    marketCap: 2e12,
    listingAgeYears: 20,
    metrics: {},
    revenueYoyHistory: [],
    ocfNegativeYears: 0,
    netLossWidening: false,
    nonStandardAudit: false,
    latestFinancialMonthsOld: 0,
    ...overrides,
  });

  it("partitions prefilter failures out of enriched universe", async () => {
    const records = [
      base(),
      base({ ticker: "TINY", marketCap: 1e8 }),
    ];

    const result = await enrichLiveUniverse(records, {
      quarter: "2026-Q1",
      cacheDir: "/tmp/screener-test",
      concurrency: 2,
      skipCache: true,
      exclusionRules,
    });

    expect(result.universe).toHaveLength(1);
    expect(result.universe[0].ticker).toBe("AAPL");
    expect(result.prefilterExcluded).toHaveLength(1);
    expect(result.prefilterExcluded[0].ticker).toBe("TINY");
  });

  it("applies industry benchmarks to enriched survivors only", async () => {
    const records = [
      base({ ticker: "A", metrics: {} }),
      base({ ticker: "B", metrics: {} }),
    ];

    const result = await enrichLiveUniverse(records, {
      quarter: "2026-Q1",
      cacheDir: "/tmp/screener-test",
      concurrency: 2,
      skipCache: true,
      exclusionRules,
    });

    expect(result.universe.every((r) => r.metrics.gross_margin_vs_industry)).toBe(true);
  });
});

describe("live adapter enrichRecords", () => {
  it("exposes enrichRecords on live adapter", async () => {
    const { createLiveAdapter } = await import("../../src/us/screening.js");
    const adapter = createLiveAdapter("/tmp/screener-cache-test");
    expect(adapter.enrichRecords).toBeDefined();
  });
});
