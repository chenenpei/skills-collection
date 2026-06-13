import type { KillGatesSpec } from "../spec/types.js";
import type { SecurityRecord } from "../engine/kill-gates.js";
import { passesUniverseProfile } from "../engine/universe-profile.js";

export function passesQuotePrefilter(
  killGates: KillGatesSpec,
  record: SecurityRecord
): boolean {
  return passesUniverseProfile(killGates, record);
}
