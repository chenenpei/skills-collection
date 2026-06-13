import type { KillGatesSpec } from "../spec/types.js";
import type { DataConfidence, Market, MetricValue } from "./types.js";

export interface SecurityRecord {
  ticker: string;
  market: Market;
  companyName: string;
  currency: string;
  status: string;
  marketCap: number;
  listingAgeYears: number;
  gicsCode?: string;
  industryProxy?: string;
  metrics: Record<string, MetricValue>;
  revenueYoyHistory: number[];
  ocfNegativeYears: number;
  netLossWidening: boolean;
  nonStandardAudit: boolean;
  latestFinancialMonthsOld: number;
}

export interface KillGateResult {
  excluded: boolean;
  killReason?: string;
  funnelFlags: string[];
  dataConfidence: DataConfidence;
}

type ProfileMarket = {
  market_cap_min_cny?: number;
  market_cap_min_usd?: number;
  listing_age_min_years?: number;
};

const BLOCKED_STATUSES = new Set([
  "ST",
  "delisting",
  "suspended",
  "halted",
  "delisted",
]);

function countMissingKeyFields(metrics: Record<string, MetricValue>): number {
  const required = ["revenue", "net_income", "operating_cash_flow"];
  return required.filter((k) => metrics[k]?.value === undefined).length;
}

function excluded(
  killReason: string,
  funnelFlags: string[],
  dataConfidence: DataConfidence = "high"
): KillGateResult {
  return { excluded: true, killReason, funnelFlags, dataConfidence };
}

export function applyKillGates(
  spec: KillGatesSpec,
  record: SecurityRecord
): KillGateResult {
  const flags: string[] = [];
  let dataConfidence: DataConfidence = "high";

  const profile = (
    spec.universe as { profile_b?: Record<string, ProfileMarket> }
  ).profile_b;
  const cnFloor = profile?.CN?.market_cap_min_cny ?? 2_000_000_000;
  const usFloor = profile?.US?.market_cap_min_usd ?? 300_000_000;
  const cnAge = profile?.CN?.listing_age_min_years ?? 3;
  const usAge = profile?.US?.listing_age_min_years ?? 2;

  if (BLOCKED_STATUSES.has(record.status)) {
    return excluded("kill_status_excluded", flags, dataConfidence);
  }

  const capFloor = record.market === "CN" ? cnFloor : usFloor;
  if (record.marketCap < capFloor) {
    return excluded("kill_market_cap_below_floor", flags, dataConfidence);
  }

  const ageFloor = record.market === "CN" ? cnAge : usAge;
  if (record.listingAgeYears < ageFloor) {
    return excluded("kill_listing_age_below_floor", flags, dataConfidence);
  }

  // Vacuous truth: [].every(...) is true — skip when history is insufficient.
  if (
    record.revenueYoyHistory.length >= 3 &&
    record.revenueYoyHistory.slice(-3).every((y) => y < 0)
  ) {
    return excluded("kill_revenue_decline_3y_consecutive", flags, dataConfidence);
  }

  if (record.ocfNegativeYears >= 2 && record.netLossWidening) {
    return excluded("kill_ocf_negative_widening_loss", flags, dataConfidence);
  }

  if (record.nonStandardAudit) {
    return excluded("kill_non_standard_audit", flags, dataConfidence);
  }

  const missingKeyFields = countMissingKeyFields(record.metrics);
  if (missingKeyFields >= 3) {
    // Quote-only live adapters supply no financials — flag, do not exclude (wide in).
    dataConfidence = "low";
    flags.push("flag_key_fields_unavailable");
  } else if (missingKeyFields >= 2) {
    dataConfidence = "low";
    flags.push("flag_key_fields_partial");
  }

  if (record.latestFinancialMonthsOld > 18) {
    dataConfidence = "low";
    flags.push("flag_data_stale");
  }

  return { excluded: false, funnelFlags: flags, dataConfidence };
}
