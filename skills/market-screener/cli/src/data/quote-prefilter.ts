import type { KillGatesSpec } from "../spec/types.js";
import type { SecurityRecord } from "../funnel/kill-gates.js";
import { passesUniverseProfile } from "../funnel/universe.js";

export function passesQuotePrefilter(
  killGates: KillGatesSpec,
  record: SecurityRecord
): boolean {
  return passesUniverseProfile(killGates, record);
}
