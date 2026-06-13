/**
 * Readable funnel replay report from funnel output artifacts.
 *
 * Usage:
 *   npx tsx scripts/funnel-replay.ts --from-output ./funnel-output/2026-Q1/CN
 *   npx tsx scripts/funnel-replay.ts --from-output ./funnel-output/2026-Q1/CN --write report.md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import {
  buildFunnelDiagnosticsFromArtifacts,
  formatFunnelReplayReport,
  type FunnelDiagnosticsDoc,
} from "../src/engine/funnel-diagnostics.js";
import type { Market } from "../src/engine/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]): { fromOutput: string; write?: string } {
  let fromOutput = "";
  let write: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--from-output") fromOutput = argv[++i] ?? "";
    if (argv[i] === "--write") write = argv[++i];
  }
  if (!fromOutput) {
    throw new Error(
      "Usage: npx tsx scripts/funnel-replay.ts --from-output <funnel-output/quarter/MARKET> [--write report.md]"
    );
  }
  return { fromOutput: path.resolve(fromOutput), write };
}

function readYamlIfExists<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  return parseYaml(fs.readFileSync(filePath, "utf8")) as T;
}

function loadArtifacts(outputDir: string): {
  market: Market;
  doc: FunnelDiagnosticsDoc;
} {
  const market = path.basename(outputDir) as Market;
  if (market !== "CN" && market !== "US") {
    throw new Error(`Expected output dir ending in CN or US, got: ${outputDir}`);
  }

  const candidatesDoc = readYamlIfExists<{ run_metadata?: FunnelDiagnosticsDoc["run_metadata"]; candidates?: unknown[] }>(
    path.join(outputDir, "candidates.yaml")
  );
  const deferredDoc = readYamlIfExists<{ deferred?: unknown[] }>(path.join(outputDir, "deferred.yaml"));
  const excludedDoc = readYamlIfExists<{ excluded?: Array<{ kill_reason?: string }> }>(
    path.join(outputDir, "excluded.yaml")
  );
  const prefilterDoc = readYamlIfExists<{ prefilter_excluded?: Array<{ kill_reason?: string }> }>(
    path.join(outputDir, "prefilter-excluded.yaml")
  );
  const funnelDoc = readYamlIfExists<FunnelDiagnosticsDoc>(path.join(outputDir, "funnel-diagnostics.yaml"));
  const routingDoc = readYamlIfExists<{
    summary?: FunnelDiagnosticsDoc["routing"] & { total_routed?: number };
    unmapped_samples?: FunnelDiagnosticsDoc["unmapped_samples"];
    run_metadata?: FunnelDiagnosticsDoc["run_metadata"];
  }>(path.join(outputDir, "routing-diagnostics.yaml"));

  const doc =
    funnelDoc ??
    buildFunnelDiagnosticsFromArtifacts(market, {
      run_metadata: candidatesDoc?.run_metadata ?? routingDoc?.run_metadata,
      prefilter_excluded: prefilterDoc?.prefilter_excluded,
      excluded: excludedDoc?.excluded,
      routing_diagnostics: routingDoc,
      candidates: candidatesDoc?.candidates,
      deferred: deferredDoc?.deferred,
    });

  if (!doc) {
    throw new Error(
      `No funnel-diagnostics.yaml and insufficient artifacts in ${outputDir}. Run screener run first.`
    );
  }

  return { market, doc };
}

async function main(): Promise<void> {
  const { fromOutput, write } = parseArgs(process.argv.slice(2));
  const { market, doc } = loadArtifacts(fromOutput);
  const report = formatFunnelReplayReport(doc, market);

  if (write) {
    fs.writeFileSync(path.resolve(write), report, "utf8");
    console.log(`Wrote ${path.resolve(write)}`);
  } else {
    console.log(report);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
