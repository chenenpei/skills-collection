import type { SpecBundle } from "./types.js";

export function funnelSoftCapFromBundle(bundle: SpecBundle): number {
  const conventions = bundle.conventions as {
    funnel_soft_cap?: { max_candidates_per_market?: number };
  };
  return (
    conventions.funnel_soft_cap?.max_candidates_per_market ??
    bundle.index.principles?.funnel_soft_cap_per_market ??
    20
  );
}

export function deferredWatchlistCapFromBundle(bundle: SpecBundle): number {
  const conventions = bundle.conventions as {
    deferred_watchlist_cap?: { max_deferred_per_market?: number };
  };
  const indexOutput = bundle.index.output as {
    deferred_watchlist_cap?: { max_deferred_per_market?: number };
  };
  return (
    conventions.deferred_watchlist_cap?.max_deferred_per_market ??
    indexOutput.deferred_watchlist_cap?.max_deferred_per_market ??
    20
  );
}
