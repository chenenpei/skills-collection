/**
 * Counterfactual sector-pass replay from enrichment cache.
 *
 * Usage:
 *   npx tsx scripts/sector-pass-counterfactual.ts --from-output ./funnel-output/2026-Q1/CN
 */
import path from "node:path";
import { loadSpecBundle } from "../src/spec/loader.js";
import { applyIndustryBenchmarks } from "../src/data/metrics.js";
import { loadEnrichedUniverseFromCache } from "../src/data/merge-enrichment.js";
import { applyKillGates, type SecurityRecord } from "../src/funnel/kill-gates.js";
import {
  bestPassingCandidate,
  listTemplateTrackResults,
  routeSecurityRecord,
} from "../src/funnel/run.js";
import { DEFAULT_CACHE_DIR } from "../src/lib/paths.js";
import type { Market } from "../src/funnel/types.js";

const BENCHMARK_OVERLAY_KEYS = [
  "gross_margin_vs_industry",
  "operating_margin_vs_industry",
  "inventory_turnover_vs_industry",
  "pe_ttm_vs_peer_median",
  "pe_ttm_vs_industry_median",
  "pb_vs_peer_median",
  "pb_vs_industry_median",
  "ps_vs_peer_median",
  "ps_vs_industry_median",
  "roe_vs_industry_median",
  "mid_cycle_ev_ebitda_vs_peer",
  "mid_cycle_ev_ebitda_vs_industry",
  "revenue_yield_vs_peer",
  "revenue_yield_vs_industry",
] as const;

const QUOTE_5Y_KEYS = ["pe_vs_5y_median", "pb_vs_5y_median", "ps_vs_5y_median"] as const;

const ADR_0002_KEYS = [
  "mid_cycle_pe_vs_10y_median",
  "mid_cycle_ev_ebitda_vs_peer",
  "mid_cycle_ev_ebitda_vs_industry",
  "ev_ebitda_vs_5y_median",
  "roic",
  "roic_ttm",
  "revenue_yield",
  "revenue_yield_vs_peer",
  "revenue_yield_vs_industry",
  "fcf_yield_vs_risk_free",
  "inventory_growth_minus_revenue",
] as const;

const P1_ENRICH_DERIVE_KEYS = [
  "capex_to_revenue",
  "inventory_turnover",
  "dividend_yield",
] as const;

type Scenario = {
  id: string;
  label: string;
  strip: readonly string[];
  skipBenchmarks?: boolean;
};

const SCENARIOS: Scenario[] = [
  { id: "current", label: "Current (full derive + benchmarks)", strip: [] },
  {
    id: "no_benchmarks",
    label: "Strip industry/peer benchmark overlays only",
    strip: BENCHMARK_OVERLAY_KEYS,
    skipBenchmarks: true,
  },
  {
    id: "no_quote_5y",
    label: "Strip benchmarks + quote 5y medians",
    strip: [...BENCHMARK_OVERLAY_KEYS, ...QUOTE_5Y_KEYS],
    skipBenchmarks: true,
  },
  {
    id: "no_adr0002",
    label: "Strip benchmarks + 5y + ADR 0002 follow-up metrics",
    strip: [...BENCHMARK_OVERLAY_KEYS, ...QUOTE_5Y_KEYS, ...ADR_0002_KEYS],
    skipBenchmarks: true,
  },
  {
    id: "approx_0501",
    label: "Approx 05:01 (also strip P1 capex/inventory/dividend derive)",
    strip: [
      ...BENCHMARK_OVERLAY_KEYS,
      ...QUOTE_5Y_KEYS,
      ...ADR_0002_KEYS,
      ...P1_ENRICH_DERIVE_KEYS,
    ],
    skipBenchmarks: true,
  },
];

function parseArgs(argv: string[]): {
  fromOutput: string;
  cacheDir: string;
  quarter: string;
  market: Market;
} {
  let fromOutput = "";
  let cacheDir = DEFAULT_CACHE_DIR;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--from-output") fromOutput = argv[++i] ?? "";
    if (argv[i] === "--cache-dir") cacheDir = argv[++i] ?? cacheDir;
  }
  if (!fromOutput) {
    throw new Error(
      "Usage: npx tsx scripts/sector-pass-counterfactual.ts --from-output <funnel-output/quarter/MARKET>"
    );
  }
  const resolved = path.resolve(fromOutput);
  const market = path.basename(resolved) as Market;
  const quarter = path.basename(path.dirname(resolved));
  return { fromOutput: resolved, cacheDir, quarter, market };
}

function stripMetrics(record: SecurityRecord, keys: readonly string[]): SecurityRecord {
  if (keys.length === 0) return record;
  const metrics = { ...record.metrics };
  for (const key of keys) delete metrics[key];
  return { ...record, metrics };
}

function countSectorPasses(
  bundle: Awaited<ReturnType<typeof loadSpecBundle>>,
  records: SecurityRecord[]
): { total: number; byTemplate: Record<string, number> } {
  const byTemplate: Record<string, number> = {};
  let total = 0;

  for (const record of records) {
    const kill = applyKillGates(bundle.killGates, record);
    if (kill.excluded) continue;

    const route = routeSecurityRecord(bundle, record);
    const trackResults = listTemplateTrackResults(bundle, record, route);
    const best = bestPassingCandidate(bundle, record, kill, route, trackResults);
    if (!best) continue;

    total += 1;
    byTemplate[best.winning_template] = (byTemplate[best.winning_template] ?? 0) + 1;
  }

  return { total, byTemplate };
}

function pct(n: number, d: number): string {
  return d > 0 ? `${((n / d) * 100).toFixed(2)}%` : "0.00%";
}

async function main(): Promise<void> {
  const { cacheDir, quarter, market } = parseArgs(process.argv.slice(2));
  const specDir = path.resolve(import.meta.dirname, "../../spec");
  const bundle = await loadSpecBundle(specDir);

  const base = loadEnrichedUniverseFromCache({ cacheDir, quarter, market });
  const benchmarked = applyIndustryBenchmarks(base);
  const killSurvivors = benchmarked.length; // all cache tickers are post-prefilter enriched

  const lines: string[] = [];
  lines.push(`# Sector pass counterfactual — ${market} (${quarter})`);
  lines.push("");
  lines.push(`Enriched universe: **${benchmarked.length}** (post-prefilter cache)`);
  lines.push(`Documented 05:01 baseline: **111** sector passes`);
  lines.push(`Documented 07:28 current: **185** sector passes`);
  lines.push("");
  lines.push("| Scenario | Sector pass | vs current | vs ~05:01 |");
  lines.push("|----------|-------------|------------|-----------|");

  let currentTotal = 0;
  const templateRows: Array<{ scenario: string; byTemplate: Record<string, number> }> = [];

  for (const scenario of SCENARIOS) {
    const records = scenario.skipBenchmarks
      ? base.map((r) => stripMetrics(r, scenario.strip))
      : applyIndustryBenchmarks(base).map((r) => stripMetrics(r, scenario.strip));

    const { total, byTemplate } = countSectorPasses(bundle, records);
    if (scenario.id === "current") currentTotal = total;
    templateRows.push({ scenario: scenario.id, byTemplate });

    const vsCurrent =
      scenario.id === "current"
        ? "—"
        : `${total - currentTotal >= 0 ? "+" : ""}${total - currentTotal}`;
    const vs0501 = `${total - 111 >= 0 ? "+" : ""}${total - 111} (${pct(total, killSurvivors)} vs 2.43%)`;

    lines.push(`| ${scenario.label} | **${total}** | ${vsCurrent} | ${vs0501} |`);
  }

  lines.push("");
  lines.push("## By template (sector pass any track)");
  lines.push("");
  const templates = [
    "manufacturing",
    "consumer",
    "healthcare",
    "cyclicals",
    "tech_saas",
    "financials",
  ];
  lines.push("| Template | " + SCENARIOS.map((s) => s.id).join(" | ") + " |");
  lines.push("|" + ["----------", ...SCENARIOS.map(() => "---")].join("|") + "|");
  for (const tpl of templates) {
    const cells = templateRows.map((r) => String(r.byTemplate[tpl] ?? 0));
    lines.push(`| ${tpl} | ${cells.join(" | ")} |`);
  }

  lines.push("");
  lines.push("## Interpretation");
  lines.push("");
  lines.push(
    "- `no_benchmarks`: removes peer/industry overlay metrics (`*_vs_industry`, `*_vs_peer`, etc.)."
  );
  lines.push("- `no_quote_5y`: also removes `pe/pb/ps_vs_5y_median` from quote history.");
  lines.push("- `no_adr0002`: also removes ADR 0002 follow-up derive (mid_cycle overlays, roic, revenue_yield, …).");
  lines.push(
    "- `approx_0501`: also removes P1 `capex_to_revenue`, `inventory_turnover`, `dividend_yield` — lower bound, likely below true 05:01."
  );
  lines.push("- Replay uses cache + stub quote; small drift vs live funnel is possible.");
  lines.push("");

  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
