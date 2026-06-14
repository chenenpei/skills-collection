import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { parse as parseYaml } from "yaml";
import { loadSpecBundle } from "../../src/spec/loader.js";
import type { SpecBundle } from "../../src/spec/types.js";
import { runFunnel } from "../../src/funnel/run.js";
import type { SecurityRecord } from "../../src/funnel/kill-gates.js";

const SPEC_DIR = path.resolve(import.meta.dirname, "../../../spec");
const FIXTURE = path.resolve(import.meta.dirname, "../fixtures/universe-cn.json");

describe("runFunnel", () => {
  let bundle: SpecBundle;
  let universe: SecurityRecord[];

  beforeAll(async () => {
    bundle = await loadSpecBundle(SPEC_DIR);
    universe = JSON.parse(await fs.readFile(FIXTURE, "utf8")) as SecurityRecord[];
  });

  it("writes CN candidates and excluded YAML from fixture universe", async () => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "screener-test-"));

    const result = await runFunnel({
      bundle,
      universe,
      quarter: "2026-Q2",
      marketScope: "CN",
      outputDir: outDir,
    });

    expect(result).toEqual({
      candidateCount: 2,
      deferredCount: 0,
      excludedCount: 1,
    });

    const candidates = parseYaml(
      await fs.readFile(path.join(outDir, "CN/candidates.yaml"), "utf8")
    ) as {
      candidates: Array<{
        ticker: string;
        passed_track: string;
        winning_template: string;
        track_confluence: boolean;
        seat_source: string;
        rank: number;
        routed_templates?: string[];
        audit_hints?: string[];
        metric_snapshot?: Record<string, unknown>;
      }>;
    };
    expect(candidates.candidates).toHaveLength(2);
    const winningTemplates = new Set(candidates.candidates.map((c) => c.winning_template));
    expect(winningTemplates.size).toBeGreaterThanOrEqual(2);
    const moutai = candidates.candidates.find((c) => c.ticker === "600519");
    const pharma = candidates.candidates.find((c) => c.ticker === "600276");
    expect(moutai).toMatchObject({
      passed_track: "quality",
      winning_template: "consumer",
    });
    expect(pharma).toMatchObject({
      passed_track: "quality",
      winning_template: "healthcare",
    });
    expect(pharma!.routed_templates).toEqual(["healthcare"]);
    expect(pharma!.routed_templates).not.toContain("consumer");
    expect(pharma!.audit_hints).toContain("verify_patent_cliff_if_margin_declining");
    expect(pharma!.audit_hints).toContain("apply_classification_biotech_sector_exception");
    expect(pharma!.metric_snapshot?.gross_margin).toBeDefined();
    expect(candidates.candidates.map((c) => c.rank).sort()).toEqual([1, 2]);

    const excluded = parseYaml(
      await fs.readFile(path.join(outDir, "CN/excluded.yaml"), "utf8")
    ) as { excluded: Array<{ ticker: string; kill_reason: string }> };
    expect(excluded.excluded).toHaveLength(1);
    expect(excluded.excluded[0]).toMatchObject({
      ticker: "000001",
      kill_reason: "kill_status_excluded",
    });

    const diagnostics = parseYaml(
      await fs.readFile(path.join(outDir, "CN/routing-diagnostics.yaml"), "utf8")
    ) as {
      summary: { total_routed: number; fallback_rate: number };
    };
    expect(diagnostics.summary.total_routed).toBe(2);
    expect(diagnostics.summary.fallback_rate).toBeGreaterThanOrEqual(0);

    const funnelDiagnostics = parseYaml(
      await fs.readFile(path.join(outDir, "CN/funnel-diagnostics.yaml"), "utf8")
    ) as {
      stages: { kill_survivors: number; sector_passed: number };
      sector_by_template: Record<string, { routed: number }>;
    };
    expect(funnelDiagnostics.stages.kill_survivors).toBe(2);
    expect(funnelDiagnostics.stages.sector_passed).toBe(2);
    expect(Object.keys(funnelDiagnostics.sector_by_template).length).toBeGreaterThan(0);
    const funnelDiagnosticsFull = parseYaml(
      await fs.readFile(path.join(outDir, "CN/funnel-diagnostics.yaml"), "utf8")
    ) as { by_pool_selected?: Record<string, number> };
    expect(funnelDiagnosticsFull.by_pool_selected).toBeDefined();
  });

  it("includes capex_to_revenue in metric_snapshot when manufacturing fixture provides it", async () => {
    const mfgRecord: SecurityRecord = {
      ticker: "301626",
      market: "CN",
      companyName: "Mfg Fixture Co",
      currency: "CNY",
      status: "active",
      marketCap: 5e9,
      listingAgeYears: 10,
      industryProxy: "电子-消费电子-消费电子零部件及组装",
      metrics: {
        roic_5y_avg: { value: 0.16, dataConfidence: "high" },
        fcf_conversion_5y: { value: 1.0, dataConfidence: "high" },
        gross_margin_3y_max_decline_pp: { value: 3, dataConfidence: "high" },
        net_debt_to_ebitda: { value: 1.0, dataConfidence: "high" },
        roe_5y_avg: { value: 0.18, dataConfidence: "high" },
        revenue_3y_cagr: { value: 0.1, dataConfidence: "high" },
        gross_margin: { value: 0.37, dataConfidence: "high" },
        capex_to_revenue: { value: 0.08, dataConfidence: "high" },
        revenue: { value: 1e9, dataConfidence: "high" },
        net_income: { value: 1e8, dataConfidence: "high" },
        operating_cash_flow: { value: 2e8, dataConfidence: "high" },
      },
      revenueYoyHistory: [0.05, 0.04, 0.03],
      ocfNegativeYears: 0,
      netLossWidening: false,
      nonStandardAudit: false,
      latestFinancialMonthsOld: 6,
    };

    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "screener-mfg-"));
    await runFunnel({
      bundle,
      universe: [...universe, mfgRecord],
      quarter: "2026-Q2",
      marketScope: "CN",
      outputDir: outDir,
    });

    const candidates = parseYaml(
      await fs.readFile(path.join(outDir, "CN/candidates.yaml"), "utf8")
    ) as {
      candidates: Array<{
        ticker: string;
        metric_snapshot: Record<string, unknown>;
      }>;
    };

    const mfg = candidates.candidates.find((c) => c.ticker === "301626");
    expect(mfg).toBeDefined();
    expect(mfg!.metric_snapshot.capex_to_revenue).toBeDefined();
  });

  it("ranks track confluence above same-pool single-track with lower pool score", async () => {
    const consumerBase = universe.find((r) => r.ticker === "600519")!;
    const confluenceRecord: SecurityRecord = {
      ...consumerBase,
      ticker: "CONFLU",
      companyName: "Confluence Fixture",
      metrics: {
        ...consumerBase.metrics,
        fcf_yield: { value: 0.06, dataConfidence: "high" },
        graham_composite: { value: 18, dataConfidence: "high" },
        pe_vs_5y_median: { value: 0.7, dataConfidence: "high" },
        fcf_yield_vs_risk_free: { value: 0.05, dataConfidence: "high" },
        price_vs_52w_high: { value: 0.6, dataConfidence: "high" },
      },
    };
    const singleTrackRecord: SecurityRecord = {
      ...consumerBase,
      ticker: "SINGLE",
      companyName: "Single Track Fixture",
      metrics: {
        ...consumerBase.metrics,
        roe_5y_avg: { value: 0.5, dataConfidence: "high" },
        roic_5y_avg: { value: 0.4, dataConfidence: "high" },
        gross_margin_vs_industry: { value: 0.4, dataConfidence: "high" },
        operating_margin_vs_industry: { value: 0.3, dataConfidence: "high" },
        revenue_3y_cagr: { value: 0.2, dataConfidence: "high" },
        fcf_yield: { value: 0.01, dataConfidence: "high" },
      },
    };

    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "screener-confluence-"));
    await runFunnel({
      bundle,
      universe: [confluenceRecord, singleTrackRecord],
      quarter: "2026-Q2",
      marketScope: "CN",
      outputDir: outDir,
    });

    const candidates = parseYaml(
      await fs.readFile(path.join(outDir, "CN/candidates.yaml"), "utf8")
    ) as {
      candidates: Array<{
        ticker: string;
        rank: number;
        track_confluence: boolean;
        winning_template: string;
      }>;
    };

    expect(candidates.candidates.length).toBeLessThanOrEqual(20);
    expect(candidates.candidates[0]?.ticker).toBe("CONFLU");
    expect(candidates.candidates[0]?.track_confluence).toBe(true);
    expect(candidates.candidates[0]?.winning_template).toBe("consumer");
    const single = candidates.candidates.find((c) => c.ticker === "SINGLE");
    expect(single?.track_confluence).toBe(false);
    expect(single!.rank).toBeGreaterThan(candidates.candidates[0]!.rank);
  });

  it("caps candidates at 20 and deferred at 20 with sector_pass_overflow in diagnostics", async () => {
    const base = universe.find((r) => r.ticker === "600519")!;
    const passers: SecurityRecord[] = Array.from({ length: 50 }, (_, i) => ({
      ...base,
      ticker: `CAP${String(i + 1).padStart(4, "0")}`,
      companyName: `Cap Fixture ${i + 1}`,
    }));

    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "screener-cap-"));
    const result = await runFunnel({
      bundle,
      universe: passers,
      quarter: "2026-Q2",
      marketScope: "CN",
      outputDir: outDir,
    });

    expect(result.candidateCount).toBe(20);
    expect(result.deferredCount).toBe(20);

    const candidates = parseYaml(
      await fs.readFile(path.join(outDir, "CN/candidates.yaml"), "utf8")
    ) as { candidates: unknown[] };
    const deferred = parseYaml(
      await fs.readFile(path.join(outDir, "CN/deferred.yaml"), "utf8")
    ) as { deferred: unknown[] };
    expect(candidates.candidates).toHaveLength(20);
    expect(deferred.deferred).toHaveLength(20);

    const funnelDiagnostics = parseYaml(
      await fs.readFile(path.join(outDir, "CN/funnel-diagnostics.yaml"), "utf8")
    ) as {
      stages: { sector_passed: number; sector_pass_overflow: number };
      deferred_watchlist_cap: number;
      run_metadata: { funnel_soft_cap: number; deferred_watchlist_cap: number };
    };
    expect(funnelDiagnostics.stages.sector_passed).toBe(50);
    expect(funnelDiagnostics.stages.sector_pass_overflow).toBeGreaterThan(0);
    expect(funnelDiagnostics.stages.sector_pass_overflow).toBe(10);
    expect(funnelDiagnostics.deferred_watchlist_cap).toBe(20);
    expect(funnelDiagnostics.run_metadata.funnel_soft_cap).toBe(20);
    expect(funnelDiagnostics.run_metadata.deferred_watchlist_cap).toBe(20);
  });
});
