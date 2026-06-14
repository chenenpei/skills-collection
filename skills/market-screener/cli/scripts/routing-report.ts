/**
 * Offline routing distribution report from enrichment cache.
 *
 * Usage:
 *   npx tsx scripts/routing-report.ts --quarter 2026-Q1 --market CN --spec ../spec
 *   npx tsx scripts/routing-report.ts --quarter 2026-Q1 --market CN --write report.md
 */
import fs from "node:fs/promises";
import path from "node:path";
import { routeFromIndustryProxy } from "../src/funnel/router.js";
import type { Market } from "../src/funnel/types.js";
import { mapPool } from "../src/lib/concurrency.js";
import { pct, sortedEntries } from "../src/lib/report-format.js";
import { DEFAULT_CACHE_DIR, DEFAULT_SPEC_DIR } from "../src/lib/paths.js";
import { loadSpecBundle } from "../src/spec/loader.js";

interface CachePayload {
  industryProxy?: string;
}

interface Args {
  quarter: string;
  market: Market;
  specDir: string;
  cacheDir: string;
  write?: string;
}

function parseArgs(argv: string[]): Args {
  let quarter = "";
  let market = "" as Market;
  let specDir = DEFAULT_SPEC_DIR;
  let cacheDir = DEFAULT_CACHE_DIR;
  let write: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--quarter") quarter = argv[++i] ?? "";
    else if (arg === "--market") market = (argv[++i] ?? "") as Market;
    else if (arg === "--spec") specDir = path.resolve(argv[++i] ?? "");
    else if (arg === "--cache-dir") cacheDir = path.resolve(argv[++i] ?? "");
    else if (arg === "--write") write = argv[++i];
  }

  if (!quarter || (market !== "CN" && market !== "US")) {
    throw new Error(
      "Usage: npx tsx scripts/routing-report.ts --quarter YYYY-Qn --market CN|US [--spec ../spec] [--cache-dir ./data/cache] [--write report.md]"
    );
  }

  return { quarter, market, specDir, cacheDir, write };
}

function formatReport(opts: {
  quarter: string;
  market: Market;
  total: number;
  missingProxy: number;
  byMethod: Record<string, number>;
  byTemplate: Record<string, number>;
  fallbackCount: number;
  unmappedByProxy: Record<string, number>;
  consumerMisroute: number;
}): string {
  const lines: string[] = [];
  const fallbackRate = opts.total > 0 ? opts.fallbackCount / opts.total : 0;

  lines.push(`# Routing report — ${opts.market} (${opts.quarter})`);
  lines.push("");
  lines.push(`Cached tickers: **${opts.total}** · Missing industryProxy: **${opts.missingProxy}**`);
  lines.push(
    `Fallback rate: **${pct(opts.fallbackCount, opts.total)}** (${fallbackRate.toFixed(3)})`
  );
  lines.push("");

  lines.push("## By routing_method");
  lines.push("");
  lines.push("| Method | Count | Share |");
  lines.push("|--------|-------|-------|");
  for (const [method, count] of sortedEntries(opts.byMethod)) {
    lines.push(`| ${method} | ${count} | ${pct(count, opts.total)} |`);
  }
  lines.push("");

  lines.push("## By routed template (ambiguous_union may double-count)");
  lines.push("");
  lines.push("| Template | Count | Share |");
  lines.push("|----------|-------|-------|");
  for (const [template, count] of sortedEntries(opts.byTemplate)) {
    lines.push(`| ${template} | ${count} | ${pct(count, opts.total)} |`);
  }
  lines.push("");

  const topUnmapped = sortedEntries(opts.unmappedByProxy).slice(0, 20);
  if (topUnmapped.length > 0) {
    lines.push("## Top unmapped industry proxies (fallback routing)");
    lines.push("");
    lines.push("| industry_proxy | Count |");
    lines.push("|----------------|-------|");
    for (const [proxy, count] of topUnmapped) {
      lines.push(`| ${proxy} | ${count} |`);
    }
    lines.push("");
  }

  lines.push("## Sanity checks");
  lines.push("");
  lines.push(
    `- 消费电子 routed to consumer: **${opts.consumerMisroute}** (expected 0 after CN map fix)`
  );
  if (fallbackRate > 0.05) {
    lines.push(`- WARN: fallback_rate ${fallbackRate.toFixed(3)} exceeds 5% target`);
  }
  lines.push("");

  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const bundle = await loadSpecBundle(args.specDir);
  const cacheMarketDir = path.join(args.cacheDir, args.quarter, args.market);

  let files: string[];
  try {
    files = (await fs.readdir(cacheMarketDir)).filter((name) => name.endsWith(".json"));
  } catch {
    throw new Error(`Cache directory not found: ${cacheMarketDir}`);
  }

  const perFile = await mapPool(files, 32, async (file) => {
    const raw = await fs.readFile(path.join(cacheMarketDir, file), "utf8");
    const payload = JSON.parse(raw) as CachePayload;
    const industryProxy = payload.industryProxy?.trim();
    const route = routeFromIndustryProxy(
      bundle.routingMap,
      bundle.cnIndustryMap,
      args.market,
      industryProxy
    );
    return { industryProxy, route };
  });

  const byMethod: Record<string, number> = {};
  const byTemplate: Record<string, number> = {};
  const unmappedByProxy: Record<string, number> = {};
  let fallbackCount = 0;
  let missingProxy = 0;
  let consumerMisroute = 0;

  for (const { industryProxy, route } of perFile) {
    if (!industryProxy) missingProxy += 1;

    byMethod[route.routingMethod] = (byMethod[route.routingMethod] ?? 0) + 1;
    if (route.routingMethod === "fallback") {
      fallbackCount += 1;
      const key = industryProxy || "(missing)";
      unmappedByProxy[key] = (unmappedByProxy[key] ?? 0) + 1;
    }

    for (const template of route.templates) {
      byTemplate[template.id] = (byTemplate[template.id] ?? 0) + 1;
    }

    if (
      industryProxy?.includes("消费电子") &&
      route.templates.some((t) => t.id === "consumer")
    ) {
      consumerMisroute += 1;
    }
  }

  const report = formatReport({
    quarter: args.quarter,
    market: args.market,
    total: files.length,
    missingProxy,
    byMethod,
    byTemplate,
    fallbackCount,
    unmappedByProxy,
    consumerMisroute,
  });

  if (args.write) {
    const outPath = path.resolve(args.write);
    await fs.writeFile(outPath, report, "utf8");
    console.log(`Wrote ${outPath}`);
  } else {
    console.log(report);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
