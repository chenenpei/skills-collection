import fs from "node:fs/promises";
import path from "node:path";
import type { SecurityRecord } from "../../src/funnel/kill-gates.js";

const CN_FIXTURE = path.resolve(import.meta.dirname, "../fixtures/universe-cn.json");

export async function loadCnFixtureRecord(ticker: string): Promise<SecurityRecord> {
  const universe = JSON.parse(await fs.readFile(CN_FIXTURE, "utf8")) as SecurityRecord[];
  const record = universe.find((r) => r.ticker === ticker);
  if (!record) {
    throw new Error(`Ticker ${ticker} not found in ${CN_FIXTURE}`);
  }
  return structuredClone(record);
}
