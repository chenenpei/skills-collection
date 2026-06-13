import path from "node:path";
import type { SpecBundle } from "../spec/types.js";
import { funnelSoftCapFromBundle } from "../spec/conventions.js";
import { buildRunMetadata } from "../output/metadata.js";
import { writeYamlArtifact } from "../output/write-artifacts.js";
import {
  bestPassingCandidate,
  routeSecurityRecord,
  type PassingCandidate,
} from "./evaluate-security.js";
import { applyKillGates, type SecurityRecord } from "./kill-gates.js";
import { rankCandidates, splitBySoftCap } from "./ranker.js";
import type { Market } from "./types.js";

export interface FunnelRunOptions {
  bundle: SpecBundle;
  universe: SecurityRecord[];
  quarter: string;
  marketScope: Market | "CN,US";
  outputDir: string;
}

export interface FunnelRunResult {
  candidateCount: number;
  deferredCount: number;
  excludedCount: number;
}

export async function runFunnel(opts: FunnelRunOptions): Promise<FunnelRunResult> {
  const softCap = funnelSoftCapFromBundle(opts.bundle);
  const markets =
    opts.marketScope === "CN,US" ? (["CN", "US"] as Market[]) : [opts.marketScope as Market];

  let totalCandidates = 0;
  let totalDeferred = 0;
  let totalExcluded = 0;

  for (const market of markets) {
    const marketUniverse = opts.universe.filter((u) => u.market === market);
    const excluded: unknown[] = [];
    const passed: PassingCandidate[] = [];

    for (const record of marketUniverse) {
      const kill = applyKillGates(opts.bundle.killGates, record);
      if (kill.excluded) {
        excluded.push({
          ticker: record.ticker,
          market: record.market,
          kill_reason: kill.killReason,
          metric_snapshot: {},
        });
        continue;
      }

      const route = routeSecurityRecord(opts.bundle, record);
      const best = bestPassingCandidate(opts.bundle, record, kill, route);
      if (best) passed.push(best);
    }

    const pairs = passed.map((p) => {
      const { compositeScore, supportingPassCount, ...output } = p;
      return {
        rankable: {
          ticker: p.ticker,
          compositeScore,
          dataConfidence: p.data_confidence,
          supportingPassCount,
        },
        output,
      };
    });

    const ranked = rankCandidates(pairs.map((p) => p.rankable));
    const outputByTicker = new Map(pairs.map((p) => [p.rankable.ticker, p.output]));
    const rankedRecords = ranked.map((r, idx) => ({
      ...outputByTicker.get(r.ticker)!,
      rank: idx + 1,
    }));

    const { primary, deferred } = splitBySoftCap(rankedRecords, softCap);
    const meta = buildRunMetadata({
      bundle: opts.bundle,
      quarter: opts.quarter,
      marketScope: market,
      universeCount: marketUniverse.length,
      candidateCount: primary.length,
      deferredCount: deferred.length,
    });

    const base = path.join(opts.outputDir, market);
    await writeYamlArtifact(path.join(base, "candidates.yaml"), {
      run_metadata: meta,
      candidates: primary,
    });
    await writeYamlArtifact(path.join(base, "deferred.yaml"), {
      run_metadata: meta,
      deferred,
    });
    await writeYamlArtifact(path.join(base, "excluded.yaml"), {
      run_metadata: meta,
      excluded,
    });

    totalCandidates += primary.length;
    totalDeferred += deferred.length;
    totalExcluded += excluded.length;
  }

  return {
    candidateCount: totalCandidates,
    deferredCount: totalDeferred,
    excludedCount: totalExcluded,
  };
}
