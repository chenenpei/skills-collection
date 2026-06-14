import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { Market } from "./types.js";
import { pct, sortedEntries } from "../lib/report-format.js";

export type ExitStage =
  | "prefilter_excluded"
  | "kill_excluded"
  | "sector_filtered"
  | "deferred"
  | "candidate";

export interface ClassifiedTicker {
  ticker: string;
  stage: ExitStage;
  reason: string;
  industryProxy: string | null;
  routedTemplate?: string;
}

export interface IndustryBucket {
  key: string;
  level: 1 | 2 | 3;
  total: number;
  byStage: Record<ExitStage, number>;
  byReason: Record<string, number>;
  candidateRate: number;
  killRate: number;
  sectorFilterRate: number;
}

export interface FilterBreakdownDoc {
  market: Market;
  quarter: string;
  universeCount: number;
  tickers: ClassifiedTicker[];
}

const PREFILTER_NO_INDUSTRY = "(预筛剔除 / 无 enrichment)";

export function parseIndustryLevels(
  proxy: string | null | undefined
): { l1: string; l2: string; l3: string } | null {
  if (!proxy?.trim()) return null;
  const parts = proxy.split("-").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const l1 = parts[0];
  const l2 = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : l1;
  const l3 = parts.length >= 3 ? proxy.trim() : l2;
  return { l1, l2, l3 };
}

function industryKey(record: ClassifiedTicker, level: 1 | 2 | 3): string {
  if (record.stage === "prefilter_excluded") return PREFILTER_NO_INDUSTRY;
  const levels = parseIndustryLevels(record.industryProxy);
  if (!levels) return "(missing industry_proxy)";
  if (level === 1) return levels.l1;
  if (level === 2) return levels.l2;
  return levels.l3;
}

function readYamlIfExists<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  return parseYaml(fs.readFileSync(filePath, "utf8")) as T;
}

function tickerFromFilename(name: string): string {
  return name.replace(/\.json$/, "");
}

export function loadFilterBreakdown(opts: {
  outputDir: string;
  cacheDir: string;
  quarter: string;
  market: Market;
}): FilterBreakdownDoc {
  const { outputDir, cacheDir, quarter, market } = opts;
  const marketDir = path.resolve(outputDir);

  const meta =
    readYamlIfExists<{ run_metadata?: { universe_count?: number; quarter?: string } }>(
      path.join(marketDir, "candidates.yaml")
    )?.run_metadata ??
    readYamlIfExists<{ run_metadata?: { universe_count?: number; quarter?: string } }>(
      path.join(marketDir, "funnel-diagnostics.yaml")
    )?.run_metadata;

  const prefilterDoc = readYamlIfExists<{
    prefilter_excluded?: Array<{ ticker: string; kill_reason?: string }>;
  }>(path.join(marketDir, "prefilter-excluded.yaml"));

  const excludedDoc = readYamlIfExists<{
    excluded?: Array<{ ticker: string; kill_reason?: string }>;
  }>(path.join(marketDir, "excluded.yaml"));

  const candidatesDoc = readYamlIfExists<{
    candidates?: Array<{
      ticker: string;
      industry_proxy?: string;
      routed_templates?: string[];
    }>;
  }>(path.join(marketDir, "candidates.yaml"));

  const deferredDoc = readYamlIfExists<{
    deferred?: Array<{
      ticker: string;
      industry_proxy?: string;
      routed_templates?: string[];
    }>;
  }>(path.join(marketDir, "deferred.yaml"));

  const cacheMarketDir = path.join(cacheDir, quarter, market);
  const cacheTickers = new Set<string>();
  const cacheIndustry = new Map<string, string | null>();

  if (fs.existsSync(cacheMarketDir)) {
    for (const file of fs.readdirSync(cacheMarketDir)) {
      if (!file.endsWith(".json")) continue;
      const ticker = tickerFromFilename(file);
      cacheTickers.add(ticker);
      const payload = JSON.parse(
        fs.readFileSync(path.join(cacheMarketDir, file), "utf8")
      ) as { industryProxy?: string };
      cacheIndustry.set(ticker, payload.industryProxy?.trim() ?? null);
    }
  }

  const candidateMap = new Map(
    (candidatesDoc?.candidates ?? []).map((row) => [
      row.ticker,
      {
        industryProxy: row.industry_proxy ?? null,
        routedTemplate: row.routed_templates?.[0],
      },
    ])
  );
  const deferredMap = new Map(
    (deferredDoc?.deferred ?? []).map((row) => [
      row.ticker,
      {
        industryProxy: row.industry_proxy ?? null,
        routedTemplate: row.routed_templates?.[0],
      },
    ])
  );
  const killMap = new Map(
    (excludedDoc?.excluded ?? []).map((row) => [
      row.ticker,
      row.kill_reason ?? "unknown_kill",
    ])
  );

  const tickers: ClassifiedTicker[] = [];

  for (const row of prefilterDoc?.prefilter_excluded ?? []) {
    tickers.push({
      ticker: row.ticker,
      stage: "prefilter_excluded",
      reason: row.kill_reason ?? "kill_prefilter_excluded",
      industryProxy: null,
    });
  }

  for (const ticker of cacheTickers) {
    const industryProxy =
      candidateMap.get(ticker)?.industryProxy ??
      deferredMap.get(ticker)?.industryProxy ??
      cacheIndustry.get(ticker) ??
      null;

    if (killMap.has(ticker)) {
      tickers.push({
        ticker,
        stage: "kill_excluded",
        reason: killMap.get(ticker)!,
        industryProxy,
      });
      continue;
    }

    if (candidateMap.has(ticker)) {
      const meta = candidateMap.get(ticker)!;
      tickers.push({
        ticker,
        stage: "candidate",
        reason: "passed_funnel",
        industryProxy: meta.industryProxy ?? industryProxy,
        routedTemplate: meta.routedTemplate,
      });
      continue;
    }

    if (deferredMap.has(ticker)) {
      const meta = deferredMap.get(ticker)!;
      tickers.push({
        ticker,
        stage: "deferred",
        reason: "deferred_soft_cap",
        industryProxy: meta.industryProxy ?? industryProxy,
        routedTemplate: meta.routedTemplate,
      });
      continue;
    }

    tickers.push({
      ticker,
      stage: "sector_filtered",
      reason: "sector_template_filtered",
      industryProxy,
    });
  }

  return {
    market,
    quarter: meta?.quarter ?? quarter,
    universeCount: meta?.universe_count ?? tickers.length,
    tickers,
  };
}

export function aggregateByIndustry(
  tickers: ClassifiedTicker[],
  level: 1 | 2 | 3
): IndustryBucket[] {
  const buckets = new Map<string, IndustryBucket>();

  for (const record of tickers) {
    const key = industryKey(record, level);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        level,
        total: 0,
        byStage: {
          prefilter_excluded: 0,
          kill_excluded: 0,
          sector_filtered: 0,
          deferred: 0,
          candidate: 0,
        },
        byReason: {},
        candidateRate: 0,
        killRate: 0,
        sectorFilterRate: 0,
      };
      buckets.set(key, bucket);
    }

    bucket.total += 1;
    bucket.byStage[record.stage] += 1;
    bucket.byReason[record.reason] = (bucket.byReason[record.reason] ?? 0) + 1;
  }

  for (const bucket of buckets.values()) {
    bucket.candidateRate = bucket.total > 0 ? bucket.byStage.candidate / bucket.total : 0;
    bucket.killRate = bucket.total > 0 ? bucket.byStage.kill_excluded / bucket.total : 0;
    bucket.sectorFilterRate =
      bucket.total > 0 ? bucket.byStage.sector_filtered / bucket.total : 0;
  }

  return [...buckets.values()].sort((a, b) => b.total - a.total);
}

function topReason(byReason: Record<string, number>): string {
  const [reason, count] = sortedEntries(byReason)[0] ?? ["—", 0];
  return `${reason} (${count})`;
}

function printIndustryTable(
  lines: string[],
  title: string,
  buckets: IndustryBucket[],
  baseUniverse: number,
  limit?: number
): void {
  const rows = limit ? buckets.slice(0, limit) : buckets;
  lines.push(`## ${title}`);
  lines.push("");
  lines.push(
    "| Industry | Total | Cand | Def | Kill | Sector filt | Prefilt | Cand% | Kill% | Sector% | Top reason |"
  );
  lines.push(
    "|----------|-------|------|-----|------|-------------|---------|-------|-------|---------|------------|"
  );
  for (const b of rows) {
    lines.push(
      `| ${b.key} | ${b.total} | ${b.byStage.candidate} | ${b.byStage.deferred} | ` +
        `${b.byStage.kill_excluded} | ${b.byStage.sector_filtered} | ${b.byStage.prefilter_excluded} | ` +
        `${pct(b.byStage.candidate, b.total)} | ${pct(b.byStage.kill_excluded, b.total)} | ` +
        `${pct(b.byStage.sector_filtered, b.total)} | ${topReason(b.byReason)} |`
    );
  }
  if (limit && buckets.length > limit) {
    lines.push("");
    lines.push(`_Showing top ${limit} of ${buckets.length} groups._`);
  }
  lines.push("");
}

function printReasonRanking(
  lines: string[],
  title: string,
  tickers: ClassifiedTicker[],
  base: number
): void {
  const counts: Record<string, number> = {};
  for (const t of tickers) {
    const label = `${t.stage}:${t.reason}`;
    counts[label] = (counts[label] ?? 0) + 1;
  }
  lines.push(`## ${title}`);
  lines.push("");
  lines.push("| Exit | Count | Share |");
  lines.push("|------|-------|-------|");
  for (const [label, count] of sortedEntries(counts)) {
    lines.push(`| ${label} | ${count} | ${pct(count, base)} |`);
  }
  lines.push("");
}

export function formatFilterBreakdownReport(
  doc: FilterBreakdownDoc,
  opts: { topL2?: number; topL3?: number } = {}
): string {
  const topL2 = opts.topL2 ?? 25;
  const topL3 = opts.topL3 ?? 25;
  const lines: string[] = [];
  const { tickers, universeCount, market, quarter } = doc;

  const stageTotals: Record<ExitStage, number> = {
    prefilter_excluded: 0,
    kill_excluded: 0,
    sector_filtered: 0,
    deferred: 0,
    candidate: 0,
  };
  for (const t of tickers) stageTotals[t.stage] += 1;

  lines.push(`# Filter breakdown — ${market} (${quarter})`);
  lines.push("");
  lines.push(`Universe (quote list): **${universeCount}** · Classified rows: **${tickers.length}**`);
  if (tickers.length < universeCount) {
    lines.push(
      `WARN: **${universeCount - tickers.length}** tickers missing from enrichment cache — ` +
        "industry breakdown covers cache + prefilter only."
    );
  }
  lines.push("");
  lines.push("## Funnel exit summary");
  lines.push("");
  lines.push("| Stage | Count | Share of universe |");
  lines.push("|-------|-------|-------------------|");
  for (const [stage, count] of sortedEntries(stageTotals)) {
    lines.push(`| ${stage} | ${count} | ${pct(count, universeCount)} |`);
  }
  lines.push("");

  printReasonRanking(lines, "Global exit reason ranking", tickers, universeCount);

  const enriched = tickers.filter((t) => t.stage !== "prefilter_excluded");
  printReasonRanking(
    lines,
    "Enriched universe exit reasons (excludes prefilter)",
    enriched,
    enriched.length
  );

  const l1 = aggregateByIndustry(tickers, 1);
  const l2 = aggregateByIndustry(tickers, 2);
  const l3 = aggregateByIndustry(tickers, 3);

  printIndustryTable(lines, "By industry L1 (申万一级)", l1, universeCount);
  printIndustryTable(lines, `By industry L2 (申万二级, top ${topL2})`, l2, universeCount, topL2);
  printIndustryTable(lines, `By industry L3 (申万三级, top ${topL3})`, l3, universeCount, topL3);

  const topL1 = l1.filter((b) => b.key !== PREFILTER_NO_INDUSTRY).slice(0, 8);
  for (const bucket of topL1) {
    const group = tickers.filter((t) => industryKey(t, 1) === bucket.key);
    const reasonCounts: Record<string, number> = {};
    for (const t of group) {
      reasonCounts[t.reason] = (reasonCounts[t.reason] ?? 0) + 1;
    }
    lines.push(`## L1 detail: ${bucket.key} (${bucket.total} tickers)`);
    lines.push("");
    lines.push("| Reason | Count | Share of L1 |");
    lines.push("|--------|-------|-------------|");
    for (const [reason, count] of sortedEntries(reasonCounts)) {
      lines.push(`| ${reason} | ${count} | ${pct(count, bucket.total)} |`);
    }
    lines.push("");
  }

  lines.push("## Notes");
  lines.push("");
  lines.push(
    "- `prefilter_excluded` tickers have no enrichment cache; grouped under `(预筛剔除 / 无 enrichment)`."
  );
  lines.push(
    "- `sector_template_filtered` means passed kill gates but failed all sector template tracks."
  );
  lines.push("- `deferred_soft_cap` means passed funnel but ranked below the per-market soft cap (25).");
  lines.push("");

  return lines.join("\n");
}
