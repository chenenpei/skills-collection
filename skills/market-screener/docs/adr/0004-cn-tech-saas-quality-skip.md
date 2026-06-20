---
status: accepted
date: 2026-06-14
---

# CN tech_saas quality: skip SBC and dilution supporting until sources exist

Without CN sources for `sbc_to_revenue` and `share_dilution_3y`, quality supporting rules hard-fail and the track stays at 0% pass despite Rule of 40 / margin / growth being available.

**Decision:** CN-only `missing: skip` on those **supporting** rules. US thresholds unchanged when data exists.

## Guardrails

- Emit `verify_sbc_dilution_in_deep_cn` when skipped — Deep must verify SBC and dilution; funnel pass does not imply they were screened.
- `sector_kill_gates.extreme_dilution` is spec-only (not CLI); skip does not remove dilution risk.

## Rejected

Hard supporting on CN (0% quality); disable CN quality track (breaks ADR 0001 pools).

**Where it lives:** `spec/templates/tech-saas.yaml`, `template-evaluator.ts`, tests.
