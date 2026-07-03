import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { parse as parseYaml } from "yaml";
import { landmineCommand } from "../../src/commands/landmine.js";

describe("landmineCommand", () => {
  it("computes quality track landmine at 70% of bull mean", async () => {
    const fixture = path.resolve(import.meta.dirname, "../fixtures/audit-summary.yaml");
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "landmine-"));
    const outFile = path.join(outDir, "landmines.yaml");
    const specDir = path.resolve(import.meta.dirname, "../../../spec");

    await landmineCommand({
      specDir,
      from: fixture,
      output: outFile,
      quarter: "2026-Q2",
    });

    const doc = parseYaml(await fs.readFile(outFile, "utf8")) as {
      quarter: string;
      landmines: Array<{
        landmine_price: number;
        formula_slug: string;
        ticker: string;
        expiry?: string;
        notes?: string;
      }>;
    };
    expect(doc.quarter).toBe("2026-Q2");
    expect(doc.landmines[0]?.ticker).toBe("600519");
    expect(doc.landmines[0]?.landmine_price).toBeCloseTo(1800 * 0.7);
    expect(doc.landmines[0]?.formula_slug).toBe("landmine_quality_bull_mean_70pct");
    expect(doc.landmines[0]).not.toHaveProperty("expiry");
    expect(doc.landmines[0]).not.toHaveProperty("notes");
  });

  it("computes mispricing track as min of 85% spot and 70% bull mean", async () => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "landmine-"));
    const auditFile = path.join(outDir, "audit-summary.yaml");
    const outFile = path.join(outDir, "landmines.yaml");
    const specDir = path.resolve(import.meta.dirname, "../../../spec");

    await fs.writeFile(
      auditFile,
      `quarter: 2026-Q2
shortlist_for_landmine:
  - ticker: "AAPL"
    market: US
    passed_track: mispricing
    fair_value_bull_mean: 200
    current_price: 180
    currency: USD
`,
      "utf8"
    );

    await landmineCommand({
      specDir,
      from: auditFile,
      output: outFile,
    });

    const doc = parseYaml(await fs.readFile(outFile, "utf8")) as {
      landmines: Array<{ landmine_price: number; formula_slug: string }>;
    };
    expect(doc.landmines[0]?.landmine_price).toBeCloseTo(Math.min(180 * 0.85, 200 * 0.7));
    expect(doc.landmines[0]?.formula_slug).toBe("landmine_mispricing_min_discount");
  });
});
