#!/usr/bin/env tsx
import path from "node:path";
import { parseArgs } from "node:util";
import { enrichCnRecord } from "../src/data/cn/enrich.js";
import { findEnrichCacheGapTickers } from "../src/lib/cache.js";
import { partitionQuotePrefilter } from "../src/data/quote-prefilter.js";
import { createCnEastMoneyAdapter } from "../src/data/cn/quotes.js";
import { mapPool } from "../src/lib/concurrency.js";
import { DEFAULT_CACHE_DIR } from "../src/lib/paths.js";
import { loadSpecBundle } from "../src/spec/loader.js";

const { values } = parseArgs({
  options: {
    quarter: { type: "string" },
    market: { type: "string", default: "CN" },
    "cache-dir": { type: "string", default: DEFAULT_CACHE_DIR },
    spec: { type: "string", default: path.resolve(import.meta.dirname, "../../spec") },
    concurrency: { type: "string", default: "4" },
  },
});

async function main(): Promise<void> {
  const quarter = values.quarter;
  if (!quarter) throw new Error("--quarter required");
  if (values.market !== "CN") throw new Error("Only --market CN is supported");

  const cacheDir = path.resolve(values["cache-dir"]!);
  const concurrency = Number(values.concurrency);
  const bundle = await loadSpecBundle(path.resolve(values.spec!));
  const adapter = createCnEastMoneyAdapter({ cacheDir });
  const records = await adapter.loadUniverse(["CN"]);
  const { survivors } = partitionQuotePrefilter(bundle.killGates, records);

  const gapTickers = new Set(
    await findEnrichCacheGapTickers(
      survivors.map((r) => r.ticker),
      cacheDir,
      quarter,
      "CN"
    )
  );
  const missing = survivors.filter((r) => gapTickers.has(r.ticker));

  console.log(`Cache gap: ${missing.length} / ${survivors.length} CN survivors`);

  const enrichOpts = {
    quarter,
    cacheDir,
    concurrency,
    skipCache: false,
    killGates: bundle.killGates,
  };

  await mapPool(
    missing,
    concurrency,
    (record) => enrichCnRecord(record, enrichOpts),
    (done, total) => {
      if (done % 50 === 0 || done === total) {
        console.log(`Repaired ${done}/${total}`);
      }
    }
  );
  console.log(`Done. Re-enriched ${missing.length} tickers.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
