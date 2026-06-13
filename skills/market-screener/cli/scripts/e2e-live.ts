/**
 * Real-network live e2e — not run by `npm test`.
 *
 * Usage:
 *   HTTPS_PROXY=http://127.0.0.1:1082 npm run e2e:live
 *   npm run e2e:live -- --markets CN --quarter 2026-Q1
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { resolveProxyUrl } from "../src/lib/http-fetch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = path.resolve(__dirname, "..");
const SPEC_DIR = path.resolve(CLI_ROOT, "../spec");

function ensureProxyHint(): void {
  if (resolveProxyUrl()) return;

  try {
    const raw = execSync("scutil --proxy", { encoding: "utf8" });
    const enabled = /HTTPEnable\s*:\s*1/.test(raw) && /HTTPProxy\s*:\s*(\S+)/.test(raw);
    if (enabled) {
      console.warn(
        "Warning: macOS system proxy is on but HTTPS_PROXY is unset.\n" +
          "Node fetch will not use it automatically. Example:\n" +
          "  HTTPS_PROXY=http://127.0.0.1:1082 npm run e2e:live\n"
      );
    }
  } catch {
    // ignore
  }
}

function parseArgs(argv: string[]): { markets: string; quarter: string } {
  let markets = "CN";
  let quarter = "2026-Q1";
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--markets") markets = argv[++i] ?? markets;
    if (argv[i] === "--quarter") quarter = argv[++i] ?? quarter;
  }
  return { markets, quarter };
}

async function main(): Promise<void> {
  ensureProxyHint();

  const { markets, quarter } = parseArgs(process.argv.slice(2));
  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), "screener-live-e2e-"));
  const proxy = resolveProxyUrl();

  console.log("=== Live E2E ===");
  console.log("markets:", markets);
  console.log("quarter:", quarter);
  console.log("output:", outRoot);
  console.log("proxy:", proxy ?? "(none — direct)");
  console.log("spec:", SPEC_DIR);

  const { runCommand } = await import("../src/commands/run.js");
  await runCommand({
    markets,
    quarter,
    output: outRoot,
    spec: SPEC_DIR,
    adapter: "live",
  });

  for (const market of markets.split(",").map((m) => m.trim())) {
    const base = path.join(outRoot, quarter, market);
    const excludedPath = path.join(base, "excluded.yaml");
    const candidatesPath = path.join(base, "candidates.yaml");

    if (!fs.existsSync(excludedPath)) {
      throw new Error(`Missing ${excludedPath}`);
    }

    const excludedDoc = parseYaml(fs.readFileSync(excludedPath, "utf8")) as {
      excluded: Array<{ kill_reason: string }>;
      run_metadata?: { universe_count?: number };
    };
    const candidatesDoc = fs.existsSync(candidatesPath)
      ? (parseYaml(fs.readFileSync(candidatesPath, "utf8")) as {
          candidates: unknown[];
        })
      : { candidates: [] };

    const reasons: Record<string, number> = {};
    for (const row of excludedDoc.excluded ?? []) {
      reasons[row.kill_reason] = (reasons[row.kill_reason] ?? 0) + 1;
    }

    const universeCount = excludedDoc.run_metadata?.universe_count;
    console.log(`\n--- ${market} ---`);
    console.log("universe:", universeCount ?? "?");
    console.log("candidates:", candidatesDoc.candidates.length);
    console.log("excluded:", excludedDoc.excluded.length);
    console.log("kill reasons:", reasons);

    if (candidatesDoc.candidates.length < 1) {
      throw new Error(
        `${market}: expected >= 1 candidate after financial enrichment; got 0. ` +
          "Live adapter may still be quote-only."
      );
    }

    const first = candidatesDoc.candidates[0] as {
      ticker?: string;
      metric_snapshot?: Record<string, unknown>;
    };
    const snapKeys = Object.keys(first.metric_snapshot ?? {});
    if (snapKeys.length < 3) {
      throw new Error(
        `${market}: first candidate ${first.ticker} metric_snapshot too sparse: ${snapKeys.join(", ")}`
      );
    }

    if (market === "CN" && universeCount !== undefined && universeCount < 500) {
      throw new Error(
        `${market}: universe_count=${universeCount} — pagination may be broken (expect ~5000+)`
      );
    }
  }

  console.log("\nLive E2E passed.");
}

main().catch((err) => {
  const cause =
    err instanceof Error && "cause" in err ? (err.cause as Error | undefined) : undefined;
  console.error("\nLive E2E failed:", err instanceof Error ? err.message : err);
  if (cause?.message) console.error("Cause:", cause.message);
  console.error(
    "\nTip: push2.eastmoney.com often blocks CLI clients. This build uses push2delay.eastmoney.com.\n" +
      "If fetch still fails, try: HTTPS_PROXY=http://127.0.0.1:7890 npm run e2e:live (Clash mixed-port)."
  );
  process.exit(1);
});
