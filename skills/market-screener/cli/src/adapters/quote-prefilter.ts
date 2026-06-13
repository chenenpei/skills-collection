import type { KillGatesSpec } from "../spec/types.js";
import type { SecurityRecord } from "../engine/kill-gates.js";

const BLOCKED = new Set(["ST", "delisting", "suspended", "halted", "delisted"]);

export function passesQuotePrefilter(
  killGates: KillGatesSpec,
  record: SecurityRecord
): boolean {
  if (BLOCKED.has(record.status)) return false;

  const profile = (killGates.universe as { profile_b?: Record<string, {
    market_cap_min_cny?: number;
    market_cap_min_usd?: number;
    listing_age_min_years?: number;
  }> }).profile_b;

  const capFloor =
    record.market === "CN"
      ? (profile?.CN?.market_cap_min_cny ?? 2_000_000_000)
      : (profile?.US?.market_cap_min_usd ?? 300_000_000);
  if (record.marketCap < capFloor) return false;

  const ageFloor =
    record.market === "CN"
      ? (profile?.CN?.listing_age_min_years ?? 3)
      : (profile?.US?.listing_age_min_years ?? 2);
  if (record.listingAgeYears < ageFloor) return false;

  return true;
}
