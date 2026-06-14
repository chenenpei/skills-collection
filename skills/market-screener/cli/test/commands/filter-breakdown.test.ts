import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { filterBreakdownCommand } from "../../src/commands/filter-breakdown.js";

describe("filterBreakdownCommand", () => {
  it("writes report next to funnel artifacts using run-style --output", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "filter-cmd-"));
    const outRoot = path.join(tmp, "funnel-output");
    const marketDir = path.join(outRoot, "2026-Q2", "CN");
    const cacheDir = path.join(tmp, "cache");
    await fs.mkdir(marketDir, { recursive: true });
    await fs.mkdir(path.join(cacheDir, "2026-Q2", "CN"), { recursive: true });

    await fs.writeFile(
      path.join(marketDir, "candidates.yaml"),
      `run_metadata:
  quarter: 2026-Q2
  universe_count: 1
candidates:
  - ticker: "600276"
    industry_proxy: 医药生物-化学制药-化学制剂
    routed_templates: [healthcare]
`
    );
    await fs.writeFile(path.join(marketDir, "deferred.yaml"), "deferred: []\n");
    await fs.writeFile(path.join(marketDir, "excluded.yaml"), "excluded: []\n");
    await fs.writeFile(
      path.join(cacheDir, "2026-Q2", "CN", "600276.json"),
      JSON.stringify({ industryProxy: "医药生物-化学制药-化学制剂" })
    );

    await filterBreakdownCommand({
      output: outRoot,
      quarter: "2026-Q2",
      markets: "CN",
      cacheDir,
    });

    const reportPath = path.join(marketDir, "filter-breakdown.md");
    const report = await fs.readFile(reportPath, "utf8");
    expect(report).toContain("Filter breakdown — CN");
    expect(report).toContain("医药生物");
  });
});
