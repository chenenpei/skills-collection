import type { Market } from "../engine/types.js";
import type { SpecBundle } from "../spec/types.js";
import { funnelSoftCapFromBundle } from "../spec/conventions.js";

export function buildRunMetadata(opts: {
  bundle: SpecBundle;
  quarter: string;
  marketScope: Market | "CN,US";
  universeCount: number;
  candidateCount: number;
  deferredCount: number;
}) {
  return {
    run_id: opts.quarter,
    executed_at: new Date().toISOString(),
    quarter: opts.quarter,
    market_scope: opts.marketScope,
    universe_count: opts.universeCount,
    candidate_count: opts.candidateCount,
    deferred_count: opts.deferredCount,
    funnel_soft_cap: funnelSoftCapFromBundle(opts.bundle),
    spec_version: opts.bundle.index.version,
    tightening_profile: opts.bundle.index.tightening_profile,
    data_source_profile: "scheme_f",
  };
}
