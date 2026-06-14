import { describe, it, expect } from "vitest";
import { deriveFromAnnualRows, type AnnualFinancialRow } from "../../src/data/metrics.js";

const moutaiLike: AnnualFinancialRow[] = [
  { year: 2021, revenue: 109_464_278_564, grossProfit: 97_206_777_034, netIncome: 52_460_144_378, operatingCashFlow: 64_028_676_147, roe: 0.2989, assetLiabilityRatio: 0.2281 },
  { year: 2022, revenue: 127_553_959_356, grossProfit: 114_006_375_155, netIncome: 62_717_467_870, operatingCashFlow: 36_698_595_830, roe: 0.3026, assetLiabilityRatio: 0.1947 },
  { year: 2023, revenue: 150_560_330_316, grossProfit: 135_826_331_142, netIncome: 74_734_071_551, operatingCashFlow: 66_593_247_721, roe: 0.3419, assetLiabilityRatio: 0.1798 },
  { year: 2024, revenue: 174_144_069_958, grossProfit: 157_109_669_908, netIncome: 86_228_146_422, operatingCashFlow: 92_463_692_168, roe: 0.3602, assetLiabilityRatio: 0.1904 },
  { year: 2025, revenue: 172_054_171_891, grossProfit: 153_945_824_944, netIncome: 82_320_067_102, operatingCashFlow: 61_522_204_989, roe: 0.3253, assetLiabilityRatio: 0.1642 },
];

describe("deriveFromAnnualRows", () => {
  it("derives consumer-quality metrics for strong compounder", () => {
    const derived = deriveFromAnnualRows(moutaiLike, { marketCap: 2e12, currency: "CNY" });

    expect(derived.metrics.roe_5y_avg?.value).toBeGreaterThan(0.28);
    expect(derived.metrics.gross_margin?.value).toBeGreaterThan(0.85);
    expect(derived.metrics.fcf_conversion_5y?.value).toBeGreaterThan(0.8);
    expect(derived.metrics.revenue_3y_cagr?.value).toBeGreaterThan(0.05);
    expect(derived.revenueYoyHistory.length).toBeGreaterThanOrEqual(3);
    expect(derived.metrics.revenue?.value).toBe(moutaiLike[4].revenue);
  });

  it("derives capex_to_revenue as 3-year average ratio", () => {
    const rows = [2022, 2023, 2024].map((year, i) => ({
      year,
      revenue: 100,
      grossProfit: 40,
      netIncome: 10,
      operatingCashFlow: 12,
      roe: 0.1,
      assetLiabilityRatio: 0.4,
      capex: 10 + i * 2,
    }));
    const derived = deriveFromAnnualRows(rows, { marketCap: 1e9, currency: "CNY" });
    expect(derived.metrics.capex_to_revenue?.value).toBeCloseTo(0.12, 4);
    expect(derived.metrics.capex_to_revenue?.dataConfidence).toBe("high");
  });

  it("derives capex_to_revenue with 2 years at medium confidence", () => {
    const rows = [2024, 2025].map((year, i) => ({
      year,
      revenue: 100,
      grossProfit: 40,
      netIncome: 10,
      operatingCashFlow: 12,
      roe: 0.1,
      assetLiabilityRatio: 0.4,
      capex: 10 + i * 2,
    }));
    const derived = deriveFromAnnualRows(rows, { marketCap: 1e9, currency: "CNY" });
    expect(derived.metrics.capex_to_revenue?.value).toBeCloseTo(0.11, 4);
    expect(derived.metrics.capex_to_revenue?.dataConfidence).toBe("medium");
  });

  it("omits capex_to_revenue when only one capex year", () => {
    const rows = [
      {
        year: 2025,
        revenue: 100,
        grossProfit: 40,
        netIncome: 10,
        operatingCashFlow: 12,
        roe: 0.1,
        assetLiabilityRatio: 0.4,
        capex: 15,
      },
    ];
    const derived = deriveFromAnnualRows(rows, { marketCap: 1e9, currency: "CNY" });
    expect(derived.metrics.capex_to_revenue).toBeUndefined();
  });

  it("derives mid_cycle_pe from 7y average EPS", () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      year: 2019 + i,
      revenue: 100 + i * 10,
      grossProfit: 40,
      netIncome: 10 + i,
      operatingCashFlow: 12 + i,
      roe: 0.1,
      assetLiabilityRatio: 0.4,
    }));
    const marketCap = 140;
    const derived = deriveFromAnnualRows(rows, { marketCap, currency: "CNY" });
    const avgEps = (10 + 11 + 12 + 13 + 14 + 15 + 16) / 7;
    expect(derived.metrics.mid_cycle_pe?.value).toBeCloseTo(marketCap / avgEps, 4);
  });

  it("derives revenue_10y_cagr over ten fiscal years", () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({
      year: 2015 + i,
      revenue: 100 * Math.pow(1.08, i),
      grossProfit: 40,
      netIncome: 10,
      operatingCashFlow: 12,
      roe: 0.1,
      assetLiabilityRatio: 0.4,
    }));
    const derived = deriveFromAnnualRows(rows, { marketCap: 1e9, currency: "CNY" });
    expect(derived.metrics.revenue_10y_cagr?.value).toBeCloseTo(0.08, 3);
  });

  it("derives rule_of_40 as (revenue growth + fcf margin) * 100", () => {
    const rows = [
      {
        year: 2024,
        revenue: 100,
        grossProfit: 40,
        netIncome: 10,
        operatingCashFlow: 30,
        roe: 0.1,
        assetLiabilityRatio: 0.4,
        capex: 3,
      },
      {
        year: 2025,
        revenue: 115,
        grossProfit: 46,
        netIncome: 12,
        operatingCashFlow: 35,
        roe: 0.11,
        assetLiabilityRatio: 0.4,
        capex: 3,
      },
    ];
    const derived = deriveFromAnnualRows(rows, { marketCap: 1e9, currency: "USD" });
    const revenueGrowth = (115 - 100) / 100;
    const fcfMargin = (35 - 3) / 115;
    expect(derived.metrics.rule_of_40?.value).toBeCloseTo((revenueGrowth + fcfMargin) * 100, 4);
  });
});
