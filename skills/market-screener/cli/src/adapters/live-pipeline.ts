import { mapPool } from "../lib/concurrency.js";
import { getUniverseProfileFailureReason } from "../engine/universe-profile.js";
import { applyIndustryBenchmarks } from "../metrics/industry-benchmarks.js";
import type { EnrichOptions, EnrichResult } from "./types.js";
import type { SecurityRecord } from "../engine/kill-gates.js";
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

export async function enrichLiveUniverse(
  records: SecurityRecord[],
  opts: EnrichOptions
): Promise<EnrichResult> {
  if (!opts.killGates) {
    throw new Error("killGates is required for live enrichment prefilter");
  }

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

  const enriched = await mapPool(survivors, opts.concurrency, (record) =>
    enrichOne(record, opts)
  );

  return {
    universe: applyIndustryBenchmarks(enriched),
    prefilterExcluded,
  };
}
