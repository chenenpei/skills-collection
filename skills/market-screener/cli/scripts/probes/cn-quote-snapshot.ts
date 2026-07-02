#!/usr/bin/env tsx
import { loadCnQuotesByTickers } from "../../src/data/cn/quotes.js";

const CHECKS: Array<{
  ticker: string;
  peMin: number;
  peMax: number;
  pbMin: number;
  pbMax: number;
}> = [
  { ticker: "603195", peMin: 12, peMax: 25, pbMin: 2, pbMax: 8 },
  { ticker: "600519", peMin: 15, peMax: 30, pbMin: 5, pbMax: 15 },
  { ticker: "600919", peMin: 4, peMax: 10, pbMin: 0.4, pbMax: 1.2 },
];

async function main(): Promise<void> {
  const records = await loadCnQuotesByTickers(CHECKS.map((check) => check.ticker));
  const byTicker = new Map(records.map((r) => [r.ticker, r]));

  let failed = 0;
  for (const check of CHECKS) {
    const r = byTicker.get(check.ticker);
    if (!r) {
      console.error(`FAIL ${check.ticker}: not in universe`);
      failed += 1;
      continue;
    }
    const pe = r.metrics.pe_ttm?.value;
    const pb = r.metrics.pb?.value;
    const price = r.metrics.price?.value;
    const ok =
      pe !== undefined &&
      pb !== undefined &&
      pe >= check.peMin &&
      pe <= check.peMax &&
      pb >= check.pbMin &&
      pb <= check.pbMax &&
      price !== undefined &&
      Math.abs(pe - price) / price > 0.05;

    console.log(
      `${ok ? "OK" : "FAIL"} ${check.ticker}: price=${price} pe=${pe} pb=${pb}`
    );
    if (!ok) failed += 1;
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
