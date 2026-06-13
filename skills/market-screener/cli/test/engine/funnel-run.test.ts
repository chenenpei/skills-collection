import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { parse as parseYaml } from "yaml";
import { loadSpecBundle } from "../../src/spec/loader.js";
import type { SpecBundle } from "../../src/spec/types.js";
import { runFunnel } from "../../src/engine/funnel-run.js";
import type { SecurityRecord } from "../../src/engine/kill-gates.js";

const SPEC_DIR = path.resolve(import.meta.dirname, "../../../spec");
const FIXTURE = path.resolve(import.meta.dirname, "../fixtures/universe-cn.json");

describe("runFunnel", () => {
  let bundle: SpecBundle;
  let universe: SecurityRecord[];

  beforeAll(async () => {
    bundle = await loadSpecBundle(SPEC_DIR);
    universe = JSON.parse(await fs.readFile(FIXTURE, "utf8")) as SecurityRecord[];
  });

  it("writes CN candidates and excluded YAML from fixture universe", async () => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "screener-test-"));

    const result = await runFunnel({
      bundle,
      universe,
      quarter: "2026-Q2",
      marketScope: "CN",
      outputDir: outDir,
    });

    expect(result).toEqual({
      candidateCount: 1,
      deferredCount: 0,
      excludedCount: 1,
    });

    const candidates = parseYaml(
      await fs.readFile(path.join(outDir, "CN/candidates.yaml"), "utf8")
    ) as {
      candidates: Array<{ ticker: string; passed_track: string; rank: number }>;
    };
    expect(candidates.candidates).toHaveLength(1);
    expect(candidates.candidates[0]).toMatchObject({
      ticker: "600519",
      rank: 1,
      passed_track: "quality",
    });

    const excluded = parseYaml(
      await fs.readFile(path.join(outDir, "CN/excluded.yaml"), "utf8")
    ) as { excluded: Array<{ ticker: string; kill_reason: string }> };
    expect(excluded.excluded).toHaveLength(1);
    expect(excluded.excluded[0]).toMatchObject({
      ticker: "000001",
      kill_reason: "kill_status_excluded",
    });

    const diagnostics = parseYaml(
      await fs.readFile(path.join(outDir, "CN/routing-diagnostics.yaml"), "utf8")
    ) as {
      summary: { total_routed: number; fallback_rate: number };
    };
    expect(diagnostics.summary.total_routed).toBe(1);
    expect(diagnostics.summary.fallback_rate).toBeGreaterThanOrEqual(0);

    const funnelDiagnostics = parseYaml(
      await fs.readFile(path.join(outDir, "CN/funnel-diagnostics.yaml"), "utf8")
    ) as {
      stages: { kill_survivors: number; sector_passed: number };
      sector_by_template: Record<string, { routed: number }>;
    };
    expect(funnelDiagnostics.stages.kill_survivors).toBe(1);
    expect(funnelDiagnostics.stages.sector_passed).toBe(1);
    expect(Object.keys(funnelDiagnostics.sector_by_template).length).toBeGreaterThan(0);
  });
});
