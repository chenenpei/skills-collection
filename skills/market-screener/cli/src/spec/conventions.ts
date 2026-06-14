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

export interface TemplateSeatPoolConfig {
  floor: number;
  cap: number;
}

export interface TemplateSeatAllocationConfig {
  pools: Record<string, TemplateSeatPoolConfig>;
  flex: { confluence_weight_multiplier: number };
  backfill: { tier1: string; tier2: string };
}

const DEFAULT_SEAT_ALLOCATION: TemplateSeatAllocationConfig = {
  pools: {
    healthcare_quality: { floor: 2, cap: 5 },
    consumer_quality: { floor: 2, cap: 4 },
    manufacturing_quality: { floor: 2, cap: 4 },
    cyclicals_quality: { floor: 0, cap: 3 },
    financials_quality: { floor: 0, cap: 3 },
    tech_saas_quality: { floor: 0, cap: 3 },
    healthcare_mispricing: { floor: 0, cap: 1 },
    consumer_mispricing: { floor: 0, cap: 1 },
    cyclicals_mispricing: { floor: 0, cap: 1 },
    manufacturing_mispricing: { floor: 0, cap: 1 },
    financials_mispricing: { floor: 0, cap: 1 },
    tech_saas_mispricing: { floor: 0, cap: 1 },
  },
  flex: { confluence_weight_multiplier: 2 },
  backfill: { tier1: "same_template_quality", tier2: "global_quality" },
};

export function seatAllocationFromBundle(bundle: SpecBundle): TemplateSeatAllocationConfig {
  const conventions = bundle.conventions as {
    template_seat_allocation?: Partial<TemplateSeatAllocationConfig>;
  };
  const configured = conventions.template_seat_allocation;
  if (!configured?.pools) return DEFAULT_SEAT_ALLOCATION;

  return {
    pools: configured.pools,
    flex: configured.flex ?? DEFAULT_SEAT_ALLOCATION.flex,
    backfill: configured.backfill ?? DEFAULT_SEAT_ALLOCATION.backfill,
  };
}
