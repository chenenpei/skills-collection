import type { Market } from "../domain/types.js";

export function parseMarkets(raw: string): { marketScope: Market | "CN,US"; markets: Market[] } {
  const normalized = raw.replace(/\s+/g, "").toUpperCase();
  if (normalized === "CN") return { marketScope: "CN", markets: ["CN"] };
  if (normalized === "US") return { marketScope: "US", markets: ["US"] };
  if (normalized === "CN,US" || normalized === "US,CN") {
    return { marketScope: "CN,US", markets: ["CN", "US"] };
  }
  throw new Error(`Invalid --markets value: ${raw}. Expected CN, US, or CN,US.`);
}

export function parseMarket(raw: string): Market {
  const market = raw.toUpperCase();
  if (market === "CN" || market === "US") return market;
  throw new Error(`Invalid --market value: ${raw}. Expected CN or US.`);
}
