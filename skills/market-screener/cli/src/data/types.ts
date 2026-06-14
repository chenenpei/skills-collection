import type { SecurityRecord } from "../funnel/kill-gates.js";
import type { KillGatesSpec } from "../spec/types.js";
import type { Market } from "../funnel/types.js";
import type { ProgressLogger } from "../lib/progress.js";

export interface EnrichOptions {
  quarter: string;
  cacheDir: string;
  concurrency: number;
  skipCache?: boolean;
  killGates?: KillGatesSpec;
  progress?: ProgressLogger;
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
  loadUniverse(
    markets: Market[],
    opts?: { progress?: ProgressLogger }
  ): Promise<SecurityRecord[]>;
  enrichRecords?(
    records: SecurityRecord[],
    opts: EnrichOptions
  ): Promise<EnrichResult>;
}
