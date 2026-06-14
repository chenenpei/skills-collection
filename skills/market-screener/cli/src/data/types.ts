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

export interface EnrichResult {
  universe: SecurityRecord[];
  prefilterExcluded: SecurityRecord[];
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
