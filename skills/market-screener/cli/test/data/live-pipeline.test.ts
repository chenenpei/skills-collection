import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SecurityRecord } from "../../src/domain/types.js";
import { enrichLiveUniverse } from "../../src/data/live.js";
import { loadSpecBundle } from "../../src/spec/loader.js";
import path from "node:path";

const SPEC_DIR = path.resolve(import.meta.dirname, "../../../spec");

vi.mock("../../src/data/cn/enrich.js", () => ({
  enrichCnRecord: vi.fn(async (record: SecurityRecord) => ({
    ...record,
    industryProxy: "白酒",
    metrics: {
      ...record.metrics,
      gross_margin: { value: 0.5, dataConfidence: "medium" },
      operating_margin: { value: 0.2, dataConfidence: "medium" },
      revenue: { value: 1e11, dataConfidence: "medium" },
    },
    revenueYoyHistory: [0.05, 0.06, 0.07],
  })),
}));

vi.mock("../../src/data/us/enrich.js", () => ({
  enrichUsRecord: vi.fn(async (record: SecurityRecord) => record),
}));

describe("enrichLiveUniverse", () => {
  let killGates: Awaited<ReturnType<typeof loadSpecBundle>>["killGates"];

  beforeEach(async () => {
    killGates = (await loadSpecBundle(SPEC_DIR)).killGates;
  });

  const base = (overrides: Partial<SecurityRecord> = {}): SecurityRecord => ({
    ticker: "600519",
    market: "CN",
    companyName: "Moutai",
    currency: "CNY",
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
      killGates,
    });

    expect(result.universe).toHaveLength(1);
    expect(result.universe[0].ticker).toBe("600519");
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
      killGates,
    });

    expect(result.universe.every((r) => r.metrics.gross_margin_vs_industry)).toBe(true);
  });
});

describe("live adapter enrichRecords", () => {
  it("exposes enrichRecords on live adapter", async () => {
    const { createLiveAdapter } = await import("../../src/data/registry.js");
    const adapter = createLiveAdapter("/tmp/screener-cache-test");
    expect(adapter.enrichRecords).toBeDefined();
  });
});
