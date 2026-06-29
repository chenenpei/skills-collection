import { describe, it, expect } from "vitest";
import {
  CN_QUOTE_HISTORY_SCHEMA,
  enrichRecordFromCachePayload,
  mergeEnrichment,
  updatedQuoteHistory,
} from "../../src/data/merge-enrichment.js";
import type { SecurityRecord } from "../../src/funnel/kill-gates.js";

describe("mergeEnrichment quote history overlays", () => {
  const base: SecurityRecord = {
    ticker: "TEST",
    market: "CN",
    companyName: "Test",
    currency: "CNY",
    status: "active",
    marketCap: 1000,
    listingAgeYears: 10,
    metrics: { pe_ttm: { value: 10, dataConfidence: "high" } },
    revenueYoyHistory: [],
    ocfNegativeYears: 0,
    netLossWidening: false,
    nonStandardAudit: false,
    latestFinancialMonthsOld: 0,
  };

  const rows = Array.from({ length: 7 }, (_, i) => ({
    year: 2019 + i,
    revenue: 100,
    grossProfit: 40,
    netIncome: 10 + i,
    operatingCashFlow: 12,
    operatingProfit: 15 + i,
    roe: 0.1,
    assetLiabilityRatio: 0.4,
    totalLiabilities: 50,
    totalEquity: 100,
    monetaryFunds: 20,
    roic: 0.12,
  }));

  it("derives fcf_yield from the latest fiscal year when annualRows are reverse-sorted", () => {
    const reverseRows = [
      {
        year: 2025,
        revenue: 200,
        grossProfit: 80,
        netIncome: 60,
        operatingCashFlow: 600,
        capex: 0,
        operatingProfit: 80,
        roe: 0.2,
        assetLiabilityRatio: 0.4,
        totalLiabilities: 50,
        totalEquity: 100,
        monetaryFunds: 20,
        roic: 0.12,
      },
      {
        year: 2023,
        revenue: 100,
        grossProfit: 40,
        netIncome: 10,
        operatingCashFlow: 272,
        capex: 0,
        operatingProfit: 15,
        roe: 0.1,
        assetLiabilityRatio: 0.4,
        totalLiabilities: 50,
        totalEquity: 100,
        monetaryFunds: 20,
        roic: 0.12,
      },
    ];

    const merged = mergeEnrichment({ ...base, marketCap: 10_000 }, reverseRows);
    expect(merged.metrics.fcf_yield?.value).toBeCloseTo(0.06, 4);
  });

  it("derives mid_cycle_pe_vs_10y_median from quote history not annual derive", () => {
    const merged = mergeEnrichment(base, rows, undefined, undefined, {
      quarter: "2026-Q1",
      quoteHistory: [
        { quarter: "2024-Q1", pe: 20, asOf: "2024-01-01" },
        { quarter: "2025-Q1", pe: 16, asOf: "2025-01-01" },
      ],
    });
    expect(merged.metrics.mid_cycle_pe?.value).toBeGreaterThan(0);
    expect(merged.metrics.mid_cycle_pe_vs_10y_median?.value).toBeGreaterThan(0);
  });
});

describe("enrichRecordFromCachePayload quoteHistory hygiene", () => {
  const replayBase: SecurityRecord = {
    ticker: "TEST",
    market: "CN",
    companyName: "Test",
    currency: "CNY",
    status: "active",
    marketCap: 1000,
    listingAgeYears: 10,
    metrics: {},
    revenueYoyHistory: [],
    ocfNegativeYears: 0,
    netLossWidening: false,
    nonStandardAudit: false,
    latestFinancialMonthsOld: 0,
  };

  const replayRows = [
    {
      year: 2025,
      revenue: 100,
      grossProfit: 40,
      netIncome: 10,
      operatingCashFlow: 12,
      roe: 0.1,
      assetLiabilityRatio: 0.4,
      operatingProfit: 15,
      roic: 0.12,
    },
  ];

  it("does not replay legacy quoteHistory without the corrected schema marker", () => {
    const record = {
      ...replayBase,
      metrics: { price: { value: 38.35, dataConfidence: "medium" } },
    };
    const payload = {
      annualRows: replayRows,
      quoteHistory: [
        { quarter: "2026-Q2", pe: 38.35, pb: 16.34, asOf: "2026-06-27T00:00:00.000Z" },
      ],
    };

    const enriched = enrichRecordFromCachePayload(record, payload, "2026-Q2");
    expect(enriched.metrics.pe_ttm).toBeUndefined();
  });

  it("replays corrected quoteHistory when schema marker is present", () => {
    const record = {
      ...replayBase,
      metrics: { price: { value: 38.35, dataConfidence: "medium" } },
    };
    const payload = {
      annualRows: replayRows,
      quoteHistorySchema: CN_QUOTE_HISTORY_SCHEMA,
      quoteHistory: [
        { quarter: "2026-Q2", pe: 16.65, pb: 4.81, ps: 4.32, asOf: "2026-06-28T00:00:00.000Z" },
      ],
    };

    const enriched = enrichRecordFromCachePayload(record, payload, "2026-Q2");
    expect(enriched.metrics.pe_ttm?.value).toBe(16.65);
    expect(enriched.metrics.pb?.value).toBe(4.81);
  });

  it("replays US quoteHistory without CN schema marker", () => {
    const record: SecurityRecord = {
      ...replayBase,
      market: "US",
      currency: "USD",
      metrics: {},
    };
    const payload = {
      annualRows: replayRows,
      quoteHistory: [
        { quarter: "2026-Q2", pe: 18.5, pb: 3.2, asOf: "2026-06-28T00:00:00.000Z" },
      ],
    };

    const enriched = enrichRecordFromCachePayload(record, payload, "2026-Q2");
    expect(enriched.metrics.pe_ttm?.value).toBe(18.5);
    expect(enriched.metrics.pb?.value).toBe(3.2);
  });
});

describe("updatedQuoteHistory", () => {
  it("drops the current quarter when no quote snapshot is available", () => {
    const history = [
      { quarter: "2026-Q1", pe: 15, asOf: "2026-03-01T00:00:00.000Z" },
      { quarter: "2026-Q2", pe: 38.35, pb: 16.34, asOf: "2026-06-27T00:00:00.000Z" },
    ];

    expect(updatedQuoteHistory(history, "2026-Q2")).toEqual([
      { quarter: "2026-Q1", pe: 15, asOf: "2026-03-01T00:00:00.000Z" },
    ]);
  });
});
