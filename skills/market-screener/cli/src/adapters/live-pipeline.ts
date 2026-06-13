import path from "node:path";
import { mapPool } from "../lib/concurrency.js";
import { applyIndustryBenchmarks } from "../metrics/industry-benchmarks.js";
import { loadSpecBundle } from "../spec/loader.js";
import { DEFAULT_SPEC_DIR } from "../paths.js";
import { passesQuotePrefilter } from "./quote-prefilter.js";
import type { EnrichOptions } from "./types.js";
import type { SecurityRecord } from "../engine/kill-gates.js";
import { enrichCnRecord } from "./cn/enrich.js";
import { enrichUsRecord } from "./us/enrich.js";

async function enrichOne(record: SecurityRecord, opts: EnrichOptions): Promise<SecurityRecord> {
  if (record.market === "CN") return enrichCnRecord(record, opts);
  if (record.market === "US") return enrichUsRecord(record, opts);
  return record;
}

export async function enrichLiveUniverse(
  records: SecurityRecord[],
  opts: EnrichOptions,
  specDir = DEFAULT_SPEC_DIR
): Promise<SecurityRecord[]> {
  const bundle = await loadSpecBundle(path.resolve(specDir));
  const survivors = records.filter((r) => passesQuotePrefilter(bundle.killGates, r));
  const skipped = records.filter((r) => !passesQuotePrefilter(bundle.killGates, r));

  const enriched = await mapPool(survivors, opts.concurrency, (record) =>
    enrichOne(record, opts)
  );

  const withBenchmarks = applyIndustryBenchmarks(enriched);
  return [...withBenchmarks, ...skipped];
}
