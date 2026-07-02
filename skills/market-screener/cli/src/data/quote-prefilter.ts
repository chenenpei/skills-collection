import type { KillGatesSpec } from "../spec/types.js";
import type { SecurityRecord } from "../domain/types.js";
import { getUniverseProfileFailureReason, passesUniverseProfile } from "../funnel/universe.js";

export function passesQuotePrefilter(
  killGates: KillGatesSpec,
  record: SecurityRecord
): boolean {
  return passesUniverseProfile(killGates, record);
}

export function partitionQuotePrefilter(
  killGates: KillGatesSpec,
  records: SecurityRecord[]
): { survivors: SecurityRecord[]; prefilterExcluded: SecurityRecord[] } {
  const survivors: SecurityRecord[] = [];
  const prefilterExcluded: SecurityRecord[] = [];
  for (const record of records) {
    if (getUniverseProfileFailureReason(killGates, record) === null) {
      survivors.push(record);
    } else {
      prefilterExcluded.push(record);
    }
  }
  return { survivors, prefilterExcluded };
}
