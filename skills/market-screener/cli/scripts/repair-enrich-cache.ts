#!/usr/bin/env tsx
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { enrichCnRecord } from "../src/data/cn/enrich.js";
import type { EnrichCachePayload } from "../src/data/merge-enrichment.js";
import { findEnrichCacheGapTickers, readCache, writeCache } from "../src/lib/cache.js";
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
    "force-all": { type: "boolean", default: false },
    "purge-quote-history": { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    backup: { type: "boolean", default: false },
  },
});

async function purgeCnQuoteHistory(opts: {
  cacheDir: string;
  quarter: string;
  dryRun: boolean;
  backup: boolean;
}): Promise<number> {
  const dir = path.join(opts.cacheDir, opts.quarter, "CN");
  try {
    await fs.access(dir);
  } catch {
    throw new Error(`Missing cache dir: ${dir}`);
  }

  if (opts.backup && !opts.dryRun) {
    const backupDir = `${dir}.quote-history-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    await fs.cp(dir, backupDir, { recursive: true });
    console.log(`Backed up ${dir} -> ${backupDir}`);
  }

  let purged = 0;
  const files = (await fs.readdir(dir)).filter((file) => file.endsWith(".json"));
  for (const file of files) {
    const ticker = file.replace(/\.json$/, "");
    const payload = await readCache<EnrichCachePayload>(opts.cacheDir, opts.quarter, "CN", ticker);
    if (!payload?.quoteHistory?.length) continue;

    purged += 1;
    if (opts.dryRun) {
      console.log(`Would purge quoteHistory: ${file}`);
      continue;
    }

    delete payload.quoteHistory;
    delete payload.quoteHistorySchema;
    await writeCache(opts.cacheDir, opts.quarter, "CN", ticker, payload);
    console.log(`Purged quoteHistory: ${file}`);
  }

  console.log(`${opts.dryRun ? "Would purge" : "Purged"} ${purged} cache files`);
  return purged;
}

async function main(): Promise<void> {
  const quarter = values.quarter;
  if (!quarter) throw new Error("--quarter required");
  if (values.market !== "CN") throw new Error("Only --market CN is supported");

  const cacheDir = path.resolve(values["cache-dir"]!);
  const concurrency = Number(values.concurrency);
  const forceAll = values["force-all"] === true;
  const purgeQuoteHistory = values["purge-quote-history"] === true;
  const dryRun = values["dry-run"] === true;

  if (purgeQuoteHistory) {
    await purgeCnQuoteHistory({
      cacheDir,
      quarter,
      dryRun,
      backup: values.backup === true,
    });
    if (dryRun) return;
  }

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
  const targets = forceAll ? survivors : missing;

  if (targets.length === 0) {
    console.log("No tickers to re-enrich.");
    return;
  }

  console.log(
    `${forceAll ? "Force re-enrich" : "Cache gap"}: ${targets.length} / ${survivors.length} CN survivors`
  );

  const enrichOpts = {
    quarter,
    cacheDir,
    concurrency,
    skipCache: false,
    killGates: bundle.killGates,
    specDir: path.resolve(values.spec!),
  };

  await mapPool(
    targets,
    concurrency,
    (record) => enrichCnRecord(record, enrichOpts),
    (done, total) => {
      if (done % 50 === 0 || done === total) {
        console.log(`Repaired ${done}/${total}`);
      }
    }
  );
  console.log(`Done. Re-enriched ${targets.length} tickers.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
