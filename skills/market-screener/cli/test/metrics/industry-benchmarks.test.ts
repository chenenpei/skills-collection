import { describe, it, expect } from "vitest";
import { applyIndustryBenchmarks } from "../../src/metrics/industry-benchmarks.js";
import type { SecurityRecord } from "../../src/engine/kill-gates.js";

describe("applyIndustryBenchmarks", () => {
  it("sets gross_margin_vs_industry relative to industry median", () => {
    const mk = (ticker: string, gm: number, industry: string): SecurityRecord => ({
      ticker,
      market: "CN",
      companyName: ticker,
      currency: "CNY",
      status: "active",
      marketCap: 5e9,
      listingAgeYears: 10,
      industryProxy: industry,
      metrics: { gross_margin: { value: gm, dataConfidence: "medium" } },
      revenueYoyHistory: [],
      ocfNegativeYears: 0,
      netLossWidening: false,
      nonStandardAudit: false,
      latestFinancialMonthsOld: 6,
    });

    const records = [
      mk("A", 0.40, "白酒"),
      mk("B", 0.30, "白酒"),
      mk("C", 0.50, "白酒"),
    ];

    const out = applyIndustryBenchmarks(records);
    const leader = out.find((r) => r.ticker === "C")!;
    expect(leader.metrics.gross_margin_vs_industry?.value).toBeCloseTo(0.10, 2);
  });
});
