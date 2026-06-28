import type { SecurityRecord } from "../funnel/kill-gates.js";
import type { KillGatesSpec } from "../spec/types.js";
import type { Market } from "../funnel/types.js";
import type { ProgressLogger } from "../lib/progress.js";

export interface LoadUniverseOptions {
  progress?: ProgressLogger;
  quarter?: string;
}

export interface DegradedLiveOptions {
  allowDegraded?: boolean;
  quoteFallbackQuarter?: string;
  quoteFallbackFixturesDir?: string;
}

export interface EnrichOptions {
  quarter: string;
  cacheDir: string;
  concurrency: number;
  skipCache?: boolean;
  killGates?: KillGatesSpec;
  progress?: ProgressLogger;
  specDir?: string;
  /** Wall-clock anchor for bank disclosure fiscal year; defaults to runtime Date. */
  now?: Date;
  /** Prior quarter whose CN enrich cache can seed stable annual/dividend/industry fields. */
  inheritCacheFrom?: string;
}

export interface EnrichRunStats {
  enrichFailedCount: number;
  enrichFailedSamples: string[];
  emptyAnnualCount: number;
  emptyAnnualSamples: string[];
  cnMissingIndustryCount?: number;
  cnEnrichedCount?: number;
}

export interface EnrichResult {
  universe: SecurityRecord[];
  prefilterExcluded: SecurityRecord[];
  enrichStatsByMarket?: Partial<Record<Market, EnrichRunStats>>;
}

export interface MarketDataAdapter {
  loadUniverse(markets: Market[], opts?: LoadUniverseOptions): Promise<SecurityRecord[]>;
  enrichRecords?(
    records: SecurityRecord[],
    opts: EnrichOptions
  ): Promise<EnrichResult>;
}
