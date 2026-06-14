import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readCache, writeCache } from "../../src/lib/cache.js";
import {
  enrichCnRecord,
  mergeCnEnrichment,
} from "../../src/data/cn/enrich.js";
import { annualRowsNeedMetricRefresh } from "../../src/data/metrics.js";
import type { SecurityRecord } from "../../src/funnel/kill-gates.js";
import type { AnnualFinancialRow } from "../../src/data/metrics.js";

vi.mock("../../src/data/cn/eastmoney.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/data/cn/eastmoney.js")>();
  return {
    ...actual,
    fetchCnAnnualRows: vi.fn(),
    fetchCnSupplementalAnnualRows: vi.fn(),
    fetchCnDividendYield: vi.fn(async () => undefined),
    fetchCnIndustryProxy: vi.fn(async () => undefined),
  };
});

import {
  fetchCnAnnualRows,
  fetchCnSupplementalAnnualRows,
} from "../../src/data/cn/eastmoney.js";

const baseRecord: SecurityRecord = {
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

describe("annualRowsNeedMetricRefresh", () => {
  it("returns false when latest row has roic and totalEquity", () => {
    const rows: AnnualFinancialRow[] = [
      { year: 2023, revenue: 1, roic: 0.2, totalEquity: 100 },
      { year: 2024, revenue: 2, roic: 0.25, totalEquity: 110 },
    ];
    expect(annualRowsNeedMetricRefresh(rows)).toBe(false);
  });

  it("returns true when latest row lacks roic or totalEquity (stale cache)", () => {
    const stale: AnnualFinancialRow[] = [
      { year: 2023, revenue: 1, grossProfit: 0.5, netIncome: 0.2, roe: 0.3 },
      { year: 2024, revenue: 2, grossProfit: 0.6, netIncome: 0.25, roe: 0.32 },
    ];
    expect(annualRowsNeedMetricRefresh(stale)).toBe(true);
  });

  it("returns false for empty rows", () => {
    expect(annualRowsNeedMetricRefresh([])).toBe(false);
  });
});

describe("enrichCnRecord cache refresh", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "cn-enrich-cache-"));
    vi.mocked(fetchCnAnnualRows).mockReset();
    vi.mocked(fetchCnSupplementalAnnualRows).mockReset();
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it("refreshes stale cached annualRows and persists updated rows", async () => {
    const staleRows: AnnualFinancialRow[] = [
      { year: 2023, revenue: 150e9, grossProfit: 135e9, netIncome: 74e9, roe: 0.34 },
      { year: 2024, revenue: 174e9, grossProfit: 157e9, netIncome: 86e9, roe: 0.36 },
    ];
    const freshRows: AnnualFinancialRow[] = [
      {
        year: 2024,
        revenue: 174e9,
        grossProfit: 157e9,
        netIncome: 86e9,
        roe: 0.36,
        roic: 0.31,
        totalEquity: 200e9,
        totalLiabilities: 40e9,
      },
    ];

    await writeCache(cacheDir, "2026-Q1", "CN", "600519", {
      annualRows: staleRows,
      industryProxy: "食品饮料-白酒",
    });

    vi.mocked(fetchCnAnnualRows).mockResolvedValue(freshRows);
    vi.mocked(fetchCnSupplementalAnnualRows).mockResolvedValue(new Map());

    const enriched = await enrichCnRecord(baseRecord, {
      cacheDir,
      quarter: "2026-Q1",
      skipCache: false,
    });

    expect(fetchCnAnnualRows).toHaveBeenCalledWith("600519");
    expect(enriched.metrics.roic_ttm?.value).toBeCloseTo(0.31, 2);
    expect(enriched.metrics.debt_to_equity?.value).toBeCloseTo(0.2, 2);

    const cached = await readCache<{ annualRows: AnnualFinancialRow[] }>(
      cacheDir,
      "2026-Q1",
      "CN",
      "600519"
    );
    expect(cached?.annualRows[0]?.roic).toBeCloseTo(0.31, 2);
    expect(cached?.annualRows[0]?.totalEquity).toBe(200e9);
  });

  it("does not refetch when cached rows already have roic and totalEquity", async () => {
    const freshRows: AnnualFinancialRow[] = [
      {
        year: 2024,
        revenue: 174e9,
        grossProfit: 157e9,
        netIncome: 86e9,
        roe: 0.36,
        roic: 0.31,
        totalEquity: 200e9,
        totalLiabilities: 40e9,
        operatingProfit: 120e9,
      },
    ];

    await writeCache(cacheDir, "2026-Q1", "CN", "600519", {
      annualRows: freshRows,
      industryProxy: "食品饮料-白酒",
    });

    const enriched = await enrichCnRecord(baseRecord, {
      cacheDir,
      quarter: "2026-Q1",
      skipCache: false,
    });

    expect(fetchCnAnnualRows).not.toHaveBeenCalled();
    expect(fetchCnSupplementalAnnualRows).not.toHaveBeenCalled();
    expect(enriched.metrics.roic_ttm?.value).toBeCloseTo(0.31, 2);
  });
});

describe("mergeCnEnrichment", () => {
  it("merges annual rows and industry into SecurityRecord", () => {
    const rows: AnnualFinancialRow[] = [
      { year: 2023, revenue: 150e9, grossProfit: 135e9, netIncome: 74e9, operatingCashFlow: 66e9, roe: 0.34, assetLiabilityRatio: 0.18 },
      { year: 2024, revenue: 174e9, grossProfit: 157e9, netIncome: 86e9, operatingCashFlow: 92e9, roe: 0.36, assetLiabilityRatio: 0.19 },
    ];

    const merged = mergeCnEnrichment(baseRecord, rows, "食品饮料-白酒");
    expect(merged.industryProxy).toBe("食品饮料-白酒");
    expect(merged.metrics.roe_5y_avg?.value).toBeGreaterThan(0.3);
  });
});
