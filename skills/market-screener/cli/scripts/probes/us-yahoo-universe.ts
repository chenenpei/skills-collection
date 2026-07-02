import { createUsYahooAdapter } from "../../src/data/us/quotes.js";
import { resetYahooSessionForTests } from "../../src/data/us/yahoo-session.js";

async function main(): Promise<void> {
  resetYahooSessionForTests();
  const t0 = Date.now();
  const rows = await createUsYahooAdapter({ cacheDir: "./data/cache" }).loadUniverse(["US"]);
  console.log("universe", rows.length, "ms", Date.now() - t0);
  console.log(
    "top5",
    rows.slice(0, 5).map((r) => ({ ticker: r.ticker, cap: r.marketCap }))
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
