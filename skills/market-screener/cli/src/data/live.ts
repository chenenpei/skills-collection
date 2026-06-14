import { mapPool } from "../lib/concurrency.js";
import { getUniverseProfileFailureReason } from "../funnel/universe.js";
import { applyIndustryBenchmarks } from "./metrics.js";
import type { EnrichOptions, EnrichResult } from "./types.js";
import type { SecurityRecord } from "../funnel/kill-gates.js";
import { enrichCnRecord } from "./cn/enrich.js";
import { enrichUsRecord } from "./us/enrich.js";

async function enrichOne(record: SecurityRecord, opts: EnrichOptions): Promise<SecurityRecord> {
  try {
    if (record.market === "CN") return await enrichCnRecord(record, opts);
    if (record.market === "US") return await enrichUsRecord(record, opts);
    return record;
  } catch {
    return { ...record, enrichmentFailure: "fetch_failed" };
  }
}

function summarizeEnrichment(
  enriched: SecurityRecord[],
  opts: EnrichOptions
): void {
  const progress = opts.progress;
  if (!progress) return;

  const failed = enriched.filter((r) => r.enrichmentFailure).length;
  if (failed > 0) {
    progress.warn(
      `${failed} ticker(s) failed enrichment (enrichment_failure on excluded/candidate records)`
    );
  }

  const cnRecords = enriched.filter((r) => r.market === "CN");
  const cnMissingIndustry = cnRecords.filter(
    (r) => !r.industryProxy && r.enrichmentFailure !== "fetch_failed"
  ).length;
  if (cnRecords.length > 0 && cnMissingIndustry / cnRecords.length >= 0.5) {
    progress.warn(
      `CN industry proxy missing on ${cnMissingIndustry}/${cnRecords.length} tickers — ` +
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
  const survivors: SecurityRecord[] = [];
  const prefilterExcluded: SecurityRecord[] = [];
  for (const record of records) {
    const reason = getUniverseProfileFailureReason(opts.killGates, record);
    if (reason === null) {
      survivors.push(record);
    } else {
      prefilterExcluded.push(record);
    }
  }

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

  summarizeEnrichment(enriched, opts);
  progress?.phase("Applying industry benchmark overlays…");

  return {
    universe: applyIndustryBenchmarks(enriched),
    prefilterExcluded,
  };
}
