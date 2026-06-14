import { describe, it, expect } from "vitest";
import { applyIndustryBenchmarks } from "../../src/data/metrics.js";
import type { SecurityRecord } from "../../src/funnel/kill-gates.js";

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

  it("sets operating_margin_vs_industry from operating_margin median", () => {
    const mk = (ticker: string, om: number): SecurityRecord => ({
      ticker,
      market: "CN",
      companyName: ticker,
      currency: "CNY",
      status: "active",
      marketCap: 5e9,
      listingAgeYears: 10,
      industryProxy: "白酒",
      metrics: {
        gross_margin: { value: 0.4, dataConfidence: "medium" },
        operating_margin: { value: om, dataConfidence: "medium" },
      },
      revenueYoyHistory: [],
      ocfNegativeYears: 0,
      netLossWidening: false,
      nonStandardAudit: false,
      latestFinancialMonthsOld: 6,
    });

    const out = applyIndustryBenchmarks([mk("A", 0.10), mk("B", 0.20), mk("C", 0.30)]);
    const leader = out.find((r) => r.ticker === "C")!;
    expect(leader.metrics.operating_margin_vs_industry?.value).toBeCloseTo(0.10, 2);
  });

  it("sets inventory_turnover_vs_industry from inventory_turnover median", () => {
    const mk = (ticker: string, turnover: number): SecurityRecord => ({
      ticker,
      market: "CN",
      companyName: ticker,
      currency: "CNY",
      status: "active",
      marketCap: 5e9,
      listingAgeYears: 10,
      industryProxy: "零部件",
      metrics: {
        inventory_turnover: { value: turnover, dataConfidence: "medium" },
      },
      revenueYoyHistory: [],
      ocfNegativeYears: 0,
      netLossWidening: false,
      nonStandardAudit: false,
      latestFinancialMonthsOld: 6,
    });

    const out = applyIndustryBenchmarks([mk("A", 4), mk("B", 6), mk("C", 8)]);
    const leader = out.find((r) => r.ticker === "C")!;
    expect(leader.metrics.inventory_turnover_vs_industry?.value).toBeCloseTo(2, 2);
  });
});
