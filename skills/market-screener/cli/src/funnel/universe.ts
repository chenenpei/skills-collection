import type { ExclusionRulesSpec } from "../spec/types.js";
import type { SecurityRecord } from "../domain/types.js";
import type { Market } from "./types.js";

export type ProfileMarket = {
  market_cap_min_cny?: number;
  market_cap_min_usd?: number;
  listing_age_min_years?: number;
};

export const BLOCKED_STATUSES = new Set([
  "ST",
  "delisting",
  "suspended",
  "halted",
  "delisted",
]);

export function getUniverseProfile(
  spec: ExclusionRulesSpec
): Record<string, ProfileMarket> | undefined {
  return (spec.universe as { profile_b?: Record<string, ProfileMarket> }).profile_b;
}

export function getUniverseFloors(
  spec: ExclusionRulesSpec,
  market: Market
): { capFloor: number; ageFloor: number } {
  const profile = getUniverseProfile(spec);
  if (market === "CN") {
    return {
      capFloor: profile?.CN?.market_cap_min_cny ?? 2_000_000_000,
      ageFloor: profile?.CN?.listing_age_min_years ?? 3,
    };
  }
  return {
    capFloor: profile?.US?.market_cap_min_usd ?? 300_000_000,
    ageFloor: profile?.US?.listing_age_min_years ?? 2,
  };
}

export function passesUniverseProfile(
  spec: ExclusionRulesSpec,
  record: SecurityRecord
): boolean {
  return getUniverseProfileFailureReason(spec, record) === null;
}

export function getUniverseProfileFailureReason(
  spec: ExclusionRulesSpec,
  record: SecurityRecord
): string | null {
  if (BLOCKED_STATUSES.has(record.status)) return "kill_status_excluded";
  const { capFloor, ageFloor } = getUniverseFloors(spec, record.market);
  if (record.marketCap < capFloor) return "kill_market_cap_below_floor";
  if (record.listingAgeYears < ageFloor) return "kill_listing_age_below_floor";
  return null;
}
