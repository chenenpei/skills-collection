import type { SecurityRecord } from "../engine/kill-gates.js";
import type { Market } from "../engine/types.js";

export interface MarketDataAdapter {
  loadUniverse(markets: Market[]): Promise<SecurityRecord[]>;
}
