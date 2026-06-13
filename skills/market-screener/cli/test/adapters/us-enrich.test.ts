import { describe, it, expect } from "vitest";
import { mergeUsEnrichment } from "../../src/adapters/us/enrich.js";
import type { SecurityRecord } from "../../src/engine/kill-gates.js";
import type { AnnualFinancialRow } from "../../src/metrics/derive.js";

describe("mergeUsEnrichment", () => {
  const base: SecurityRecord = {
    ticker: "AAPL",
    market: "US",
    companyName: "Apple Inc.",
    currency: "USD",
    status: "active",
    marketCap: 3e12,
    listingAgeYears: 40,
    metrics: {},
    revenueYoyHistory: [],
    ocfNegativeYears: 0,
    netLossWidening: false,
    nonStandardAudit: false,
    latestFinancialMonthsOld: 0,
  };

  const rows: AnnualFinancialRow[] = [
    {
      year: 2023,
      revenue: 383e9,
      grossProfit: 170e9,
      netIncome: 97e9,
      operatingCashFlow: 110e9,
      roe: 1.47,
      assetLiabilityRatio: 0.82,
    },
    {
      year: 2024,
      revenue: 391e9,
      grossProfit: 180e9,
      netIncome: 94e9,
      operatingCashFlow: 118e9,
      roe: 1.52,
      assetLiabilityRatio: 0.80,
    },
  ];

  it("merges annual rows and industry into SecurityRecord", () => {
    const merged = mergeUsEnrichment(base, rows, "Electronic Computers");
    expect(merged.industryProxy).toBe("Electronic Computers");
    expect(merged.metrics.roe_5y_avg?.value).toBeGreaterThan(1);
  });

  it("preserves quote-only metrics while derived financials win on overlap", () => {
    const withQuote: SecurityRecord = {
      ...base,
      metrics: {
        trailing_pe: { value: 28.5, dataConfidence: "high" },
        roe_5y_avg: { value: 0.42, dataConfidence: "high" },
      },
    };

    const merged = mergeUsEnrichment(withQuote, rows, "Electronic Computers");
    expect(merged.metrics.trailing_pe?.value).toBe(28.5);
    expect(merged.metrics.roe_5y_avg?.value).toBeGreaterThan(1);
    expect(merged.metrics.roe_5y_avg?.dataConfidence).toBe("medium");
  });

  it("returns record unchanged when annual rows are empty", () => {
    const merged = mergeUsEnrichment(base, [], "Electronic Computers");
    expect(merged).toBe(base);
  });
});
