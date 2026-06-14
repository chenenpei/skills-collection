import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  aggregateByIndustry,
  formatFilterBreakdownReport,
  loadFilterBreakdown,
  loadTemplateTrackBreakdown,
  parseIndustryLevels,
} from "../../src/funnel/filter-breakdown.js";
import { loadSpecBundle } from "../../src/spec/loader.js";

const SPEC_DIR = path.resolve(import.meta.dirname, "../../../spec");

describe("parseIndustryLevels", () => {
  it("splits Shenwan L1-L2-L3", () => {
    expect(parseIndustryLevels("医药生物-化学制药-化学制剂")).toEqual({
      l1: "医药生物",
      l2: "医药生物-化学制药",
      l3: "医药生物-化学制药-化学制剂",
    });
  });

  it("returns null for empty proxy", () => {
    expect(parseIndustryLevels("")).toBeNull();
  });
});

describe("loadFilterBreakdown", () => {
  it("classifies tickers by funnel stage and aggregates by L1", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "filter-breakdown-"));
    const outDir = path.join(tmp, "2026-Q2", "CN");
    const cacheDir = path.join(tmp, "cache");
    await fs.mkdir(outDir, { recursive: true });
    await fs.mkdir(path.join(cacheDir, "2026-Q2", "CN"), { recursive: true });

    await fs.writeFile(
      path.join(outDir, "candidates.yaml"),
      `run_metadata:
  quarter: 2026-Q2
  universe_count: 5
candidates:
  - ticker: "600276"
    industry_proxy: 医药生物-化学制药-化学制剂
    routed_templates: [healthcare]
`
    );
    await fs.writeFile(
      path.join(outDir, "deferred.yaml"),
      `deferred:
  - ticker: "000001"
    industry_proxy: 银行-国有大型银行Ⅱ-国有大型银行Ⅲ
    routed_templates: [financials]
`
    );
    await fs.writeFile(
      path.join(outDir, "excluded.yaml"),
      `excluded:
  - ticker: "000002"
    kill_reason: kill_revenue_decline_3y_consecutive
`
    );
    await fs.writeFile(
      path.join(outDir, "prefilter-excluded.yaml"),
      `prefilter_excluded:
  - ticker: "000003"
    kill_reason: kill_market_cap_below_floor
`
    );
    await fs.writeFile(
      path.join(cacheDir, "2026-Q2", "CN", "600276.json"),
      JSON.stringify({ industryProxy: "医药生物-化学制药-化学制剂" })
    );
    await fs.writeFile(
      path.join(cacheDir, "2026-Q2", "CN", "000001.json"),
      JSON.stringify({ industryProxy: "银行-国有大型银行Ⅱ-国有大型银行Ⅲ" })
    );
    await fs.writeFile(
      path.join(cacheDir, "2026-Q2", "CN", "000002.json"),
      JSON.stringify({ industryProxy: "房地产-房地产开发-住宅开发" })
    );
    await fs.writeFile(
      path.join(cacheDir, "2026-Q2", "CN", "000004.json"),
      JSON.stringify({ industryProxy: "电子-半导体-集成电路" })
    );

    const doc = loadFilterBreakdown({
      outputDir: outDir,
      cacheDir,
      quarter: "2026-Q2",
      market: "CN",
    });

    expect(doc.tickers).toHaveLength(5);
    expect(doc.tickers.find((t) => t.ticker === "600276")?.stage).toBe("candidate");
    expect(doc.tickers.find((t) => t.ticker === "000001")?.stage).toBe("deferred");
    expect(doc.tickers.find((t) => t.ticker === "000002")?.stage).toBe("kill_excluded");
    expect(doc.tickers.find((t) => t.ticker === "000003")?.stage).toBe("prefilter_excluded");
    expect(doc.tickers.find((t) => t.ticker === "000004")?.stage).toBe("sector_filtered");

    const l1 = aggregateByIndustry(doc.tickers, 1);
    const pharma = l1.find((b) => b.key === "医药生物");
    expect(pharma?.byStage.candidate).toBe(1);
    expect(l1.find((b) => b.key === "(预筛剔除 / 无 enrichment)")?.total).toBe(1);

    const report = formatFilterBreakdownReport(doc);
    expect(report).toContain("Filter breakdown — CN");
    expect(report).toContain("医药生物");
  });

  it("replays template-track failures when cache + spec are available", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-breakdown-"));
    const outDir = path.join(tmp, "2026-Q2", "CN");
    const cacheDir = path.join(tmp, "cache");
    await fs.mkdir(outDir, { recursive: true });
    await fs.mkdir(path.join(cacheDir, "2026-Q2", "CN"), { recursive: true });

    await fs.writeFile(
      path.join(outDir, "candidates.yaml"),
      `run_metadata:
  quarter: 2026-Q2
  universe_count: 1
candidates: []
`
    );
    await fs.writeFile(path.join(outDir, "deferred.yaml"), "deferred: []\n");
    await fs.writeFile(path.join(outDir, "excluded.yaml"), "excluded: []\n");
    await fs.writeFile(path.join(outDir, "prefilter-excluded.yaml"), "prefilter_excluded: []\n");
    await fs.writeFile(
      path.join(cacheDir, "2026-Q2", "CN", "600001.json"),
      JSON.stringify({
        industryProxy: "机械设备-专用设备-能源及重型设备",
        annualRows: [
          {
            year: 2023,
            revenue: 1e10,
            grossProfit: 2e9,
            netIncome: 5e8,
            operatingCashFlow: 6e8,
            roe: 0.08,
          },
          {
            year: 2024,
            revenue: 1.1e10,
            grossProfit: 2.1e9,
            netIncome: 5.5e8,
            operatingCashFlow: 6.5e8,
            roe: 0.09,
          },
        ],
      })
    );

    const bundle = await loadSpecBundle(SPEC_DIR);
    const trackDoc = loadTemplateTrackBreakdown({
      outputDir: outDir,
      cacheDir,
      quarter: "2026-Q2",
      market: "CN",
      bundle,
      filters: { stages: ["sector_filtered"], templates: ["manufacturing"] },
    });

    expect(trackDoc.analyzedCount).toBe(1);
    expect(trackDoc.tickers[0]?.primaryFailure).toMatch(/^required:/);

    const report = formatFilterBreakdownReport(
      loadFilterBreakdown({ outputDir: outDir, cacheDir, quarter: "2026-Q2", market: "CN" }),
      { templateTrack: trackDoc }
    );
    expect(report).toContain("Template track breakdown");
    expect(report).toContain("manufacturing");
  });
});
