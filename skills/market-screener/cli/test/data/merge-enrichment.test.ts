import { describe, it, expect } from "vitest";
import { mergeEnrichment } from "../../src/data/merge-enrichment.js";
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
