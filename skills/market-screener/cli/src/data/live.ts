import { mapPool } from "../lib/concurrency.js";
import { ENRICH_STATS_SAMPLE_CAP } from "../lib/cache.js";
import { partitionQuotePrefilter } from "./quote-prefilter.js";
import { applyIndustryBenchmarks } from "./metrics.js";
import type { EnrichOptions, EnrichResult, EnrichRunStats } from "./types.js";
import type { SecurityRecord } from "../funnel/kill-gates.js";
import type { Market } from "../funnel/types.js";
import { enrichCnRecord } from "./cn/enrich.js";
import { enrichUsRecord } from "./us/enrich.js";

export function summarizeEnrichRunStats(
  records: SecurityRecord[],
  market?: Market
): EnrichRunStats {
  const scoped = market ? records.filter((r) => r.market === market) : records;

  let enrichFailedCount = 0;
  let emptyAnnualCount = 0;
  let cnMissingIndustryCount = 0;
  const enrichFailedSamples: string[] = [];
  const emptyAnnualSamples: string[] = [];

  for (const r of scoped) {
    if (r.enrichmentFailure) {
      enrichFailedCount += 1;
      if (enrichFailedSamples.length < ENRICH_STATS_SAMPLE_CAP) {
        enrichFailedSamples.push(r.ticker);
      }
      continue;
    }

    const noAnnual = (r.revenueYoyHistory?.length ?? 0) === 0 && !r.industryProxy;
    if (noAnnual) {
      emptyAnnualCount += 1;
      if (emptyAnnualSamples.length < ENRICH_STATS_SAMPLE_CAP) {
        emptyAnnualSamples.push(r.ticker);
      }
    }

    if (r.market === "CN" && !r.industryProxy) {
      cnMissingIndustryCount += 1;
    }
  }

  return {
    enrichFailedCount,
    enrichFailedSamples,
    emptyAnnualCount,
    emptyAnnualSamples,
    cnMissingIndustryCount: market === "CN" ? cnMissingIndustryCount : undefined,
    cnEnrichedCount: market === "CN" ? scoped.length : undefined,
  };
}

async function enrichOne(record: SecurityRecord, opts: EnrichOptions): Promise<SecurityRecord> {
  try {
    if (record.market === "CN") return await enrichCnRecord(record, opts);
    if (record.market === "US") return await enrichUsRecord(record, opts);
    return record;
  } catch {
    return { ...record, enrichmentFailure: "fetch_failed" };
  }
}

function summarizeEnrichment(enrichStats: EnrichRunStats, opts: EnrichOptions): void {
  const progress = opts.progress;
  if (!progress) return;

  if (enrichStats.enrichFailedCount > 0) {
    progress.warn(
      `${enrichStats.enrichFailedCount} ticker(s) failed enrichment` +
        (enrichStats.enrichFailedSamples.length
          ? ` (e.g. ${enrichStats.enrichFailedSamples.slice(0, 5).join(", ")})`
          : "")
    );
  }

  const cnStats = enrichStats;
  const cnMissing = cnStats.cnMissingIndustryCount ?? 0;
  const cnTotal = cnStats.cnEnrichedCount ?? 0;
  if (cnTotal > 0 && cnMissing / cnTotal >= 0.5) {
    progress.warn(
      `CN industry proxy missing on ${cnMissing}/${cnTotal} tickers — ` +
        "routing will mostly fall back to manufacturing; check East Money orginfo enrichment"
    );
  }
}

export async function enrichLiveUniverse(
  records: SecurityRecord[],
  opts: EnrichOptions
): Promise<EnrichResult> {
  if (!opts.killGates) {
    throw new Error("killGates is required for live enrichment prefilter");
  }

  const progress = opts.progress;
  const { survivors, prefilterExcluded } = partitionQuotePrefilter(opts.killGates, records);

  progress?.phase(
    `Quote prefilter: ${survivors.length} survivors, ${prefilterExcluded.length} excluded ` +
      `(status / market cap / listing age)`
  );

  if (survivors.length === 0) {
    progress?.warn("No survivors after quote prefilter — funnel will produce empty candidates");
    return { universe: [], prefilterExcluded };
  }

  const cacheNote = opts.skipCache ? "cache disabled" : `cache quarter=${opts.quarter}`;
  progress?.phase(
    `Enriching ${survivors.length} tickers (concurrency=${opts.concurrency}, ${cacheNote})…`
  );

  const enriched = await mapPool(
    survivors,
    opts.concurrency,
    (record) => enrichOne(record, opts),
    (done, total) => progress?.tick(done, total, "enrichment")
  );

  const enrichStatsByMarket: Partial<Record<Market, EnrichRunStats>> = {};
  for (const market of ["CN", "US"] as Market[]) {
    if (enriched.some((r) => r.market === market)) {
      enrichStatsByMarket[market] = summarizeEnrichRunStats(enriched, market);
    }
  }
  summarizeEnrichment(
    enrichStatsByMarket.CN ?? summarizeEnrichRunStats(enriched),
    opts
  );
  progress?.phase("Applying industry benchmark overlays…");

  return {
    universe: applyIndustryBenchmarks(enriched),
    prefilterExcluded,
    enrichStatsByMarket,
  };
}
