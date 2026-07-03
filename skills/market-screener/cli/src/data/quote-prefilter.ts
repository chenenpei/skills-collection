import type { ExclusionRulesSpec } from "../spec/types.js";
import type { SecurityRecord } from "../domain/types.js";
import { getUniverseProfileFailureReason, passesUniverseProfile } from "../funnel/universe.js";

export function passesQuotePrefilter(
  exclusionRules: ExclusionRulesSpec,
  record: SecurityRecord
): boolean {
  return passesUniverseProfile(exclusionRules, record);
}

export function partitionQuotePrefilter(
  exclusionRules: ExclusionRulesSpec,
  records: SecurityRecord[]
): { survivors: SecurityRecord[]; prefilterExcluded: SecurityRecord[] } {
  const survivors: SecurityRecord[] = [];
  const prefilterExcluded: SecurityRecord[] = [];
  for (const record of records) {
    if (getUniverseProfileFailureReason(exclusionRules, record) === null) {
      survivors.push(record);
    } else {
      prefilterExcluded.push(record);
    }
  }
  return { survivors, prefilterExcluded };
}
