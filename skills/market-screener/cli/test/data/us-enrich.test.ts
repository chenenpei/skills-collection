import { describe, it, expect } from "vitest";
import { mergeUsEnrichment } from "../../src/data/us/enrich.js";
import type { SecurityRecord } from "../../src/funnel/kill-gates.js";
import type { AnnualFinancialRow } from "../../src/data/metrics.js";

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
      roe: 0.176,
      assetLiabilityRatio: 0.35,
      operatingProfit: 115e9,
      totalEquity: 62e9,
      totalLiabilities: 290e9,
      monetaryFunds: 30e9,
      roic: 0.28,
      capex: 10e9,
    },
    {
      year: 2024,
      revenue: 391e9,
      grossProfit: 180e9,
      netIncome: 94e9,
      operatingCashFlow: 118e9,
      roe: 0.162,
      assetLiabilityRatio: 0.33,
      operatingProfit: 120e9,
      totalEquity: 65e9,
      totalLiabilities: 280e9,
      monetaryFunds: 35e9,
      roic: 0.27,
      capex: 11e9,
    },
  ];

  it("merges annual rows and industry into SecurityRecord", () => {
    const merged = mergeUsEnrichment(base, rows, "Electronic Computers");
    expect(merged.industryProxy).toBe("Electronic Computers");
    expect(merged.metrics.roe_5y_avg?.value).toBeGreaterThan(0.1);
    expect(merged.metrics.roe_5y_avg?.value).toBeLessThan(2);
    expect(merged.metrics.roic_ttm?.value).toBeCloseTo(0.27, 2);
    expect(merged.metrics.debt_to_equity?.value).toBeCloseTo(280e9 / 65e9, 2);
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
    expect(merged.metrics.roe_5y_avg?.value).toBeGreaterThan(0.1);
    expect(merged.metrics.roe_5y_avg?.value).toBeLessThan(0.2);
    expect(merged.metrics.roe_5y_avg?.dataConfidence).toBe("medium");
  });

  it("returns record unchanged when annual rows are empty", () => {
    const merged = mergeUsEnrichment(base, [], "Electronic Computers");
    expect(merged).toBe(base);
  });
});
