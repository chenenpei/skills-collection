import { describe, it, expect } from "vitest";
import { mergeCnEnrichment } from "../../src/data/cn/enrich.js";
import type { SecurityRecord } from "../../src/funnel/kill-gates.js";
import type { AnnualFinancialRow } from "../../src/data/metrics.js";

describe("mergeCnEnrichment", () => {
  it("merges annual rows and industry into SecurityRecord", () => {
    const base: SecurityRecord = {
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
    };

    const rows: AnnualFinancialRow[] = [
      { year: 2023, revenue: 150e9, grossProfit: 135e9, netIncome: 74e9, operatingCashFlow: 66e9, roe: 0.34, assetLiabilityRatio: 0.18 },
      { year: 2024, revenue: 174e9, grossProfit: 157e9, netIncome: 86e9, operatingCashFlow: 92e9, roe: 0.36, assetLiabilityRatio: 0.19 },
    ];

    const merged = mergeCnEnrichment(base, rows, "食品饮料-白酒");
    expect(merged.industryProxy).toBe("食品饮料-白酒");
    expect(merged.metrics.roe_5y_avg?.value).toBeGreaterThan(0.3);
  });
});
