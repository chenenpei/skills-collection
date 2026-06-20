import type { SpecBundle } from "./types.js";

export type TemplateLiveViability = "full" | "proxy" | "quant_too_hard";

export function templateLiveViability(
  bundle: SpecBundle,
  templateId: string,
  subTemplateId?: string
): TemplateLiveViability {
  const manifest = (bundle.conventions as {
    template_live_viability?: Record<
      string,
      TemplateLiveViability | Record<string, TemplateLiveViability>
    >;
  }).template_live_viability;
  if (!manifest) return "full";

  const entry = manifest[templateId];
  if (!entry) return "full";
  if (typeof entry === "string") return entry;
  if (subTemplateId && entry[subTemplateId]) return entry[subTemplateId];
  return "full";
}

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
  const indexOutput = (bundle.index.output ?? {}) as {
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

export interface NorthStarSpec {
  metric: string;
  direction: "desc" | "asc";
}

export function parseNorthStar(raw: string): NorthStarSpec {
  const [metric, dir] = raw.split(":");
  if (dir === "asc") return { metric, direction: "asc" };
  return { metric, direction: "desc" };
}

export function northStarForPool(
  bundle: SpecBundle,
  poolKey: string
): NorthStarSpec | undefined {
  const map = (bundle.conventions as { pool_tie_break_north_star?: Record<string, string> })
    .pool_tie_break_north_star;
  if (!map) return undefined;

  const raw =
    map[poolKey] ??
    (poolKey.endsWith("_quality") ? map.default_quality : map.default_mispricing);
  return raw ? parseNorthStar(raw) : undefined;
}

export interface ManifestReviewThresholds {
  promote_min_rate: number;
  demote_warn_rate: number;
  min_routed: number;
}

export function manifestReviewThresholdsFromBundle(bundle: SpecBundle): ManifestReviewThresholds {
  const mc = (bundle.conventions as {
    metric_coverage?: { manifest_review?: Partial<ManifestReviewThresholds> };
  }).metric_coverage?.manifest_review;
  return {
    promote_min_rate: mc?.promote_min_rate ?? 0.7,
    demote_warn_rate: mc?.demote_warn_rate ?? 0.5,
    min_routed: mc?.min_routed ?? 5,
  };
}
