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

  it("sets pe_ttm and pb peer/industry overlays as value/median ratios", () => {
    const mk = (ticker: string, pe: number, pb: number, ps: number): SecurityRecord => ({
      ticker,
      market: "CN",
      companyName: ticker,
      currency: "CNY",
      status: "active",
      marketCap: 5e9,
      listingAgeYears: 10,
      industryProxy: "软件",
      metrics: {
        pe_ttm: { value: pe, dataConfidence: "medium" },
        pb: { value: pb, dataConfidence: "medium" },
        ps: { value: ps, dataConfidence: "medium" },
      },
      revenueYoyHistory: [],
      ocfNegativeYears: 0,
      netLossWidening: false,
      nonStandardAudit: false,
      latestFinancialMonthsOld: 6,
    });

    const out = applyIndustryBenchmarks([
      mk("A", 10, 1.0, 2),
      mk("B", 20, 2.0, 4),
      mk("C", 30, 3.0, 6),
    ]);
    const leader = out.find((r) => r.ticker === "C")!;
    expect(leader.metrics.pe_ttm_vs_peer_median?.value).toBeCloseTo(1.5, 2);
    expect(leader.metrics.pb_vs_peer_median?.value).toBeCloseTo(1.5, 2);
    expect(leader.metrics.ps_vs_industry_median?.value).toBeCloseTo(1.5, 2);
  });

  it("sets roe_vs_industry_median and revenue_yield_vs_peer overlays", () => {
    const mk = (
      ticker: string,
      roe: number,
      revenueYield: number,
      industry: string
    ): SecurityRecord => ({
      ticker,
      market: "CN",
      companyName: ticker,
      currency: "CNY",
      status: "active",
      marketCap: 5e9,
      listingAgeYears: 10,
      industryProxy: industry,
      metrics: {
        roe_ttm: { value: roe, dataConfidence: "medium" },
        revenue_yield: { value: revenueYield, dataConfidence: "medium" },
      },
      revenueYoyHistory: [],
      ocfNegativeYears: 0,
      netLossWidening: false,
      nonStandardAudit: false,
      latestFinancialMonthsOld: 6,
    });

    const out = applyIndustryBenchmarks([
      mk("A", 0.10, 0.05, "银行"),
      mk("B", 0.12, 0.06, "银行"),
      mk("C", 0.16, 0.09, "银行"),
    ]);
    const leader = out.find((r) => r.ticker === "C")!;
    expect(leader.metrics.roe_vs_industry_median?.value).toBeCloseTo(0.04, 2);
    expect(leader.metrics.revenue_yield_vs_peer?.value).toBeCloseTo(1.5, 2);
  });

  it("sets mid_cycle_ev_ebitda_vs_peer as ratio to industry median", () => {
    const mk = (ticker: string, evEbitda: number): SecurityRecord => ({
      ticker,
      market: "CN",
      companyName: ticker,
      currency: "CNY",
      status: "active",
      marketCap: 5e9,
      listingAgeYears: 10,
      industryProxy: "钢铁",
      metrics: {
        mid_cycle_ev_ebitda: { value: evEbitda, dataConfidence: "medium" },
      },
      revenueYoyHistory: [],
      ocfNegativeYears: 0,
      netLossWidening: false,
      nonStandardAudit: false,
      latestFinancialMonthsOld: 6,
    });

    const out = applyIndustryBenchmarks([mk("A", 4), mk("B", 6), mk("C", 8)]);
    const leader = out.find((r) => r.ticker === "C")!;
    expect(leader.metrics.mid_cycle_ev_ebitda_vs_peer?.value).toBeCloseTo(8 / 6, 2);
  });
});
