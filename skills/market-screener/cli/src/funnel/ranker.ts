import type { NorthStarSpec } from "../spec/conventions.js";
import type { PassingCandidate } from "./run.js";

export interface TemplateSeatPoolConfig {
  floor: number;
  cap: number;
}

export interface TemplateSeatAllocationConfig {
  pools: Record<string, TemplateSeatPoolConfig>;
  flex: { confluence_weight_multiplier: number };
  backfill: { tier1: string; tier2: string };
}

export type SeatSource =
  | "floor"
  | "cap"
  | "flex"
  | "backfill_same_template"
  | "backfill_global"
  | "deferred";

export interface AllocatedCandidate extends PassingCandidate {
  rank: number;
  seat_source: SeatSource;
}

export interface TemplateSeatAllocationResult {
  candidates: AllocatedCandidate[];
  deferred: AllocatedCandidate[];
  overflowCount: number;
  byPoolSelected: Record<string, number>;
}

export interface PoolNorthStarLookup {
  forPool(poolKey: string): NorthStarSpec | undefined;
  defaultQuality?: NorthStarSpec;
}

const CONFIDENCE_ORDER = { high: 3, medium: 2, low: 1 };

export function poolKeyForCandidate(candidate: PassingCandidate): string {
  return `${candidate.winning_template}_${candidate.passed_track}`;
}

function northStarSortValue(candidate: PassingCandidate, northStar: NorthStarSpec): number {
  const v = candidate.metric_snapshot[northStar.metric]?.value;
  if (v === undefined || !Number.isFinite(v)) {
    return northStar.direction === "desc" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  }
  return v;
}

export function compareNorthStar(
  a: PassingCandidate,
  b: PassingCandidate,
  northStar: NorthStarSpec
): number {
  const va = northStarSortValue(a, northStar);
  const vb = northStarSortValue(b, northStar);
  if (vb !== va) {
    return northStar.direction === "desc" ? vb - va : va - vb;
  }
  return a.ticker.localeCompare(b.ticker);
}

export function compareInPool(
  a: PassingCandidate,
  b: PassingCandidate,
  poolKey?: string,
  northStarLookup?: PoolNorthStarLookup
): number {
  if (a.track_confluence !== b.track_confluence) {
    return a.track_confluence ? -1 : 1;
  }
  if (b.pool_score !== a.pool_score) return b.pool_score - a.pool_score;
  if (CONFIDENCE_ORDER[b.data_confidence] !== CONFIDENCE_ORDER[a.data_confidence]) {
    return CONFIDENCE_ORDER[b.data_confidence] - CONFIDENCE_ORDER[a.data_confidence];
  }
  if (poolKey && northStarLookup) {
    const northStar = northStarLookup.forPool(poolKey);
    if (northStar) return compareNorthStar(a, b, northStar);
  }
  return a.ticker.localeCompare(b.ticker);
}

function flexScore(candidate: PassingCandidate, multiplier: number): number {
  return candidate.pool_score * (candidate.track_confluence ? multiplier : 1);
}

function compareFlex(
  a: PassingCandidate,
  b: PassingCandidate,
  multiplier: number,
  northStarLookup?: PoolNorthStarLookup
): number {
  const scoreA = flexScore(a, multiplier);
  const scoreB = flexScore(b, multiplier);
  if (scoreB !== scoreA) return scoreB - scoreA;
  return compareInPool(a, b, poolKeyForCandidate(a), northStarLookup);
}

function groupByPool(
  candidates: PassingCandidate[],
  northStarLookup?: PoolNorthStarLookup
): Map<string, PassingCandidate[]> {
  const buckets = new Map<string, PassingCandidate[]>();
  for (const candidate of candidates) {
    const key = poolKeyForCandidate(candidate);
    const bucket = buckets.get(key) ?? [];
    bucket.push(candidate);
    buckets.set(key, bucket);
  }
  for (const [poolKey, bucket] of buckets) {
    bucket.sort((a, b) => compareInPool(a, b, poolKey, northStarLookup));
  }
  return buckets;
}

function poolConfigForKey(
  config: TemplateSeatAllocationConfig,
  key: string
): TemplateSeatPoolConfig {
  return config.pools[key] ?? { floor: 0, cap: Number.POSITIVE_INFINITY };
}

function trySelect(
  candidate: PassingCandidate,
  seatSource: SeatSource,
  state: {
    selected: AllocatedCandidate[];
    selectedTickers: Set<string>;
    poolSelectedCount: Record<string, number>;
    byPoolSelected: Record<string, number>;
    softCap: number;
  }
): boolean {
  if (state.selected.length >= state.softCap) return false;
  if (state.selectedTickers.has(candidate.ticker)) return false;

  const key = poolKeyForCandidate(candidate);
  state.selected.push({ ...candidate, rank: 0, seat_source: seatSource });
  state.selectedTickers.add(candidate.ticker);
  state.poolSelectedCount[key] = (state.poolSelectedCount[key] ?? 0) + 1;
  state.byPoolSelected[key] = (state.byPoolSelected[key] ?? 0) + 1;
  return true;
}

function poolAtCap(
  key: string,
  config: TemplateSeatAllocationConfig,
  poolSelectedCount: Record<string, number>
): boolean {
  const cap = poolConfigForKey(config, key).cap;
  return (poolSelectedCount[key] ?? 0) >= cap;
}

export function allocateTemplateSeats(
  candidates: PassingCandidate[],
  config: TemplateSeatAllocationConfig,
  softCap: number,
  deferredCap: number,
  northStarLookup?: PoolNorthStarLookup
): TemplateSeatAllocationResult {
  const buckets = groupByPool(candidates, northStarLookup);
  const selected: AllocatedCandidate[] = [];
  const selectedTickers = new Set<string>();
  const poolSelectedCount: Record<string, number> = {};
  const byPoolSelected: Record<string, number> = {};
  const state = { selected, selectedTickers, poolSelectedCount, byPoolSelected, softCap };

  for (const [poolKey, poolConfig] of Object.entries(config.pools)) {
    if (poolConfig.floor <= 0) continue;
    const bucket = buckets.get(poolKey) ?? [];
    let taken = 0;
    for (const candidate of bucket) {
      if (taken >= poolConfig.floor) break;
      if (poolAtCap(poolKey, config, poolSelectedCount)) break;
      if (trySelect(candidate, "floor", state)) taken += 1;
    }
  }

  for (const [poolKey, poolConfig] of Object.entries(config.pools)) {
    const bucket = buckets.get(poolKey) ?? [];
    for (const candidate of bucket) {
      if (poolAtCap(poolKey, config, poolSelectedCount)) break;
      if ((poolSelectedCount[poolKey] ?? 0) >= poolConfig.cap) break;
      trySelect(candidate, "cap", state);
    }
  }

  const multiplier = config.flex.confluence_weight_multiplier;
  while (selected.length < softCap) {
    const eligible = candidates.filter((candidate) => {
      if (selectedTickers.has(candidate.ticker)) return false;
      const key = poolKeyForCandidate(candidate);
      return !poolAtCap(key, config, poolSelectedCount);
    });
    if (eligible.length === 0) break;
    eligible.sort((a, b) => compareFlex(a, b, multiplier, northStarLookup));
    if (!trySelect(eligible[0]!, "flex", state)) break;
  }

  if (selected.length < softCap && config.backfill.tier1 === "same_template_quality") {
    const templatesWithShortfall = new Set<string>();
    for (const [poolKey, poolConfig] of Object.entries(config.pools)) {
      const selectedFromPool = poolSelectedCount[poolKey] ?? 0;
      if (selectedFromPool < poolConfig.floor) {
        templatesWithShortfall.add(poolKey.replace(/_(quality|mispricing)$/, ""));
      }
    }

    for (const template of [...templatesWithShortfall].sort()) {
      const qualityKey = `${template}_quality`;
      const bucket = buckets.get(qualityKey) ?? [];
      for (const candidate of bucket) {
        if (selected.length >= softCap) break;
        trySelect(candidate, "backfill_same_template", state);
      }
    }
  }

  if (selected.length < softCap && config.backfill.tier2 === "global_quality") {
    const qualityCandidates = candidates.filter(
      (candidate) =>
        candidate.passed_track === "quality" && !selectedTickers.has(candidate.ticker)
    );
    qualityCandidates.sort((a, b) =>
      compareInPool(a, b, "default_quality", northStarLookup)
    );
    for (const candidate of qualityCandidates) {
      if (selected.length >= softCap) break;
      trySelect(candidate, "backfill_global", state);
    }
  }

  selected.forEach((candidate, index) => {
    candidate.rank = index + 1;
  });

  const unselected = candidates
    .filter((candidate) => !selectedTickers.has(candidate.ticker))
    .sort((a, b) => compareFlex(a, b, multiplier, northStarLookup));

  const deferred = unselected.slice(0, deferredCap).map((candidate, index) => ({
    ...candidate,
    rank: softCap + index + 1,
    seat_source: "deferred" as const,
  }));

  return {
    candidates: selected,
    deferred,
    overflowCount: Math.max(0, unselected.length - deferred.length),
    byPoolSelected,
  };
}
