import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { parse as parseYaml } from "yaml";
import { withAdapterDefaults } from "../../src/data/cn/quotes.js";
import { loadSpecBundle } from "../../src/spec/loader.js";
import { runFunnel } from "../../src/funnel/run.js";
import type { SpecBundle } from "../../src/spec/types.js";

const SPEC_DIR = path.resolve(import.meta.dirname, "../../../spec");

function quoteOnlyRecord(ticker: string, marketCap: number) {
  return withAdapterDefaults({
    ticker,
    market: "CN",
    companyName: `Quote Only ${ticker}`,
    currency: "CNY",
    status: "active",
    marketCap,
    listingAgeYears: 10,
  });
}

describe("quote-only live-tier funnel integration", () => {
  let bundle: SpecBundle;

  beforeAll(async () => {
    bundle = await loadSpecBundle(SPEC_DIR);
  });

  it("does not mass-exclude quote-only rows for revenue decline or missing financials", async () => {
    const universe = Array.from({ length: 50 }, (_, i) =>
      quoteOnlyRecord(String(600000 + i).padStart(6, "0"), 5_000_000_000)
    );

    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "screener-quote-only-"));
    const result = await runFunnel({
      bundle,
      universe,
      quarter: "2026-Q1",
      marketScope: "CN",
      outputDir: outDir,
    });

    expect(result.excludedCount).toBe(0);
    expect(result.candidateCount).toBe(0);

    const excluded = parseYaml(
      await fs.readFile(path.join(outDir, "CN/excluded.yaml"), "utf8")
    ) as { excluded: Array<{ kill_reason: string }> };
    expect(excluded.excluded).toHaveLength(0);
  });
});
