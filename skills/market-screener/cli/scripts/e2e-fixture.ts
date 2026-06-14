/**
 * Offline fixture e2e — real CLI stack, no network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(__dirname, "..");
const SPEC_DIR = path.resolve(CLI_ROOT, "../spec");

async function main(): Promise<void> {
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "screener-fixture-e2e-"));
  const { runCommand } = await import("../src/commands/run.js");

  await runCommand({
    markets: "CN,US",
    quarter: "2026-Q2",
    output: outRoot,
    spec: SPEC_DIR,
    adapter: "fixture",
  });

  const cnCandidates = parseYaml(
    fs.readFileSync(path.join(outRoot, "2026-Q2/CN/candidates.yaml"), "utf8")
  ) as { candidates: Array<{ ticker: string }> };
  const cnExcluded = parseYaml(
    fs.readFileSync(path.join(outRoot, "2026-Q2/CN/excluded.yaml"), "utf8")
  ) as { excluded: Array<{ kill_reason: string }> };

  if (cnCandidates.candidates.length !== 1 || cnCandidates.candidates[0]?.ticker !== "600519") {
    throw new Error(`Unexpected CN candidates: ${JSON.stringify(cnCandidates.candidates)}`);
  }
  if (cnExcluded.excluded.length !== 1) {
    throw new Error(`Unexpected CN excluded count: ${cnExcluded.excluded.length}`);
  }

  console.log("Fixture E2E passed →", outRoot);
}

main().catch((err) => {
  console.error("Fixture E2E failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
