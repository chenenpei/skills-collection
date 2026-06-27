import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyBankScrapeToRecord } from "../../src/data/cn/bank-enrich.js";
import { isCnBankIndustry } from "../../src/data/cn/bank-indicators/is-bank-industry.js";
import { enrichCnRecord } from "../../src/data/cn/enrich.js";
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

vi.mock("../../src/data/cn/bank-indicators/index.js", () => ({
  scrapeBankIndicators: vi.fn(),
}));

import {
  fetchCnAnnualRows,
  fetchCnSupplementalAnnualRows,
  fetchCnIndustryProxy,
} from "../../src/data/cn/eastmoney.js";
import { scrapeBankIndicators } from "../../src/data/cn/bank-indicators/index.js";

const baseRecord: SecurityRecord = {
  ticker: "600036",
  market: "CN",
  companyName: "CMB",
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

describe("isCnBankIndustry", () => {
  it("matches 银行 in industry proxy", () => {
    expect(isCnBankIndustry("银行-股份制银行Ⅱ-股份制银行Ⅲ")).toBe(true);
    expect(isCnBankIndustry("食品饮料-白酒")).toBe(false);
    expect(isCnBankIndustry(undefined)).toBe(false);
  });
});

describe("applyBankScrapeToRecord", () => {
  it("merges scrape metrics with medium confidence", () => {
    const record = {
      ...baseRecord,
      ticker: "600036",
      metrics: { roe_ttm: { value: 0.15, dataConfidence: "high" as const } },
    };
    const out = applyBankScrapeToRecord(record, {
      metrics: { npl_ratio: 0.0095, capital_adequacy: 0.1905 },
      dataConfidence: "medium",
      sourceUrls: ["http://example.com"],
    });
    expect(out.metrics.npl_ratio).toEqual({ value: 0.0095, dataConfidence: "medium" });
    expect(out.metrics.capital_adequacy?.value).toBe(0.1905);
    expect(out.auditHints).toContain("bank_disclosure_scrape:http://example.com");
  });
});

describe("enrichCnRecord bank scrape integration", () => {
  let cacheDir: string;
  const specDir = path.resolve(import.meta.dirname, "../../../spec");

  const bankRows: AnnualFinancialRow[] = [
    {
      year: 2024,
      revenue: 300e9,
      grossProfit: 200e9,
      netIncome: 100e9,
      roe: 0.15,
      roic: 0.12,
      totalEquity: 500e9,
      totalLiabilities: 100e9,
    },
  ];

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "cn-bank-enrich-"));
    vi.mocked(fetchCnAnnualRows).mockReset();
    vi.mocked(fetchCnSupplementalAnnualRows).mockReset();
    vi.mocked(fetchCnIndustryProxy).mockReset();
    vi.mocked(scrapeBankIndicators).mockReset();
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it("applies bank scrape when industry is 银行", async () => {
    vi.mocked(fetchCnAnnualRows).mockResolvedValue(bankRows);
    vi.mocked(fetchCnSupplementalAnnualRows).mockResolvedValue(new Map());
    vi.mocked(fetchCnIndustryProxy).mockResolvedValue("银行-股份制银行Ⅱ-股份制银行Ⅲ");
    vi.mocked(scrapeBankIndicators).mockResolvedValue({
      ticker: "600036",
      fiscalYear: 2024,
      metrics: { npl_ratio: 0.0095, capital_adequacy: 0.1905, provision_coverage: 2.1 },
      rawHits: {},
      missing: [],
      sourceUrls: ["http://example.com/sina", "http://example.com/pdf"],
      dataConfidence: "medium",
      scrapedAt: "2026-06-27T00:00:00.000Z",
    });

    const enriched = await enrichCnRecord(baseRecord, {
      cacheDir,
      quarter: "2026-Q1",
      concurrency: 1,
      skipCache: true,
      specDir,
    });

    expect(scrapeBankIndicators).toHaveBeenCalledWith("600036", 2024, specDir);
    expect(enriched.metrics.npl_ratio?.value).toBeCloseTo(0.0095, 4);
    expect(enriched.metrics.capital_adequacy?.value).toBeCloseTo(0.1905, 4);
    expect(enriched.auditHints).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^bank_disclosure_scrape:/),
      ])
    );
  });

  it("skips bank scrape for non-bank industry", async () => {
    vi.mocked(fetchCnAnnualRows).mockResolvedValue(bankRows);
    vi.mocked(fetchCnSupplementalAnnualRows).mockResolvedValue(new Map());
    vi.mocked(fetchCnIndustryProxy).mockResolvedValue("食品饮料-白酒");

    const enriched = await enrichCnRecord(baseRecord, {
      cacheDir,
      quarter: "2026-Q1",
      concurrency: 1,
      skipCache: true,
      specDir,
    });

    expect(scrapeBankIndicators).not.toHaveBeenCalled();
    expect(enriched.metrics.npl_ratio).toBeUndefined();
  });
});
