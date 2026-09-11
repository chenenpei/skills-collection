import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { parse as parseYaml } from "yaml";
import { withAdapterDefaults } from "../../src/us/sources/market-data.js";
import { loadSpecBundle } from "../../src/policy/loader.js";
import { runFunnel } from "../../src/us/screening.js";
import type { SpecBundle } from "../../src/policy/loader.js";

const SPEC_DIR = path.resolve(import.meta.dirname, "../../src/policy");

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


it("runs the public US CLI against its bundled fixture and writes inspectable results", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "screener-us-cli-"));
  try {
    await promisify(execFile)(process.execPath, ["--import", "tsx", "src/cli.ts", "run", "--markets", "US", "--quarter", "2026-Q2", "--output", directory, "--spec", SPEC_DIR], { cwd: new URL("../../", import.meta.url).pathname });
    const output = path.join(directory, "2026-Q2", "US");
    const { candidates } = parseYaml(await fs.readFile(path.join(output, "candidates.yaml"), "utf8"));
    expect(candidates.some((record: { ticker: string }) => record.ticker === "AAPL")).toBe(true);
    for (const name of ["deferred.yaml", "excluded.yaml", "routing-diagnostics.yaml", "funnel-diagnostics.yaml"]) {
      expect(parseYaml(await fs.readFile(path.join(output, name), "utf8"))).toBeTruthy();
    }
    await expect(fs.stat(path.join(directory, "2026-Q2", "CN"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
