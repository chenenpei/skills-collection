import type { SecurityRecord } from "../engine/kill-gates.js";
import type { Market } from "../engine/types.js";

export interface EnrichOptions {
  quarter: string;
  cacheDir: string;
  concurrency: number;
  skipCache?: boolean;
}

export interface MarketDataAdapter {
  loadUniverse(markets: Market[]): Promise<SecurityRecord[]>;
  enrichRecords?(records: SecurityRecord[], opts: EnrichOptions): Promise<SecurityRecord[]>;
}
