---
status: accepted
date: 2026-06-14
---

# CN tech_saas quality: skip SBC and dilution supporting metrics until sources exist

CN tech / SaaS names route to `tech_saas` with both quality and mispricing tracks. High-tier metrics `sbc_to_revenue` and `share_dilution_3y` have no reliable CN source in the enrich MVP (ADR 0002). Without a policy, quality supporting rules treat missing values as hard failures and the track stays at **0% pass** despite Wave 1 derive (`rule_of_40`, `revenue_growth_yoy`, `fcf_margin`) being available.

Grill decision: **option A** — apply **`missing: skip` on CN market only** for `sbc_to_revenue` and `share_dilution_3y` on the **quality supporting** list. US thresholds unchanged pending SEC / share-count enrich.

## Guardrails

1. **CN-only skip** — Do not globalize `missing: skip`; US keeps `sbc_to_revenue` max (0.20) and `share_dilution_3y` max (0.10) as evaluable supporting rules when data exists.

2. **Deep audit flag** — When either metric is skipped due to missing data on a CN record, append `funnel_flags: verify_sbc_dilution_in_deep_cn`. Deep must manually verify stock-based compensation burden and three-year share dilution; funnel pass must not imply these were screened.

3. **Kill gate caveat** — `sector_kill_gates.extreme_dilution` (`share_dilution_3y_gt_0.25`) is defined in spec but **not implemented in CLI** (same class as `financial_kill_gates`). Skipping supporting dilution does not remove dilution risk; flag + Deep remain mandatory.

## Considered options

- **A — CN `missing: skip` + flag (accepted):** Quality track can run on Rule of 40 / margin / growth; supporting bar tightens via evaluator downgrade when skips reduce evaluable count.
- **B — Keep hard supporting:** CN tech_saas quality 0% for entire MVP.
- **C — Disable CN quality track:** Breaks dual-track seat pools and track confluence (ADR 0001).

## Accuracy expectations

- Quality pass correlates with **Rule of 40 + gross margin + revenue growth** only; **~2 of ~7 Bessemer/Buffett quality dimensions** (SBC, dilution) deferred to Deep.
- False-positive risk: profitable, high-multiple CN software with heavy equity incentives passes quality until Deep catches it — mitigated by flag, not by pretending data exists.
- `ndr` already `missing: skip` on supporting; this decision extends the same pattern to the remaining CN high-tier SaaS fields.

## Consequences

- [x] `spec/templates/tech-saas.yaml`: `market_missing_overrides: { CN: skip }` on `sbc_to_revenue` and `share_dilution_3y` supporting rules
- [x] Funnel evaluator emits `verify_sbc_dilution_in_deep_cn` when CN skip applies (`template-evaluator.ts`)
- [x] `cli/test/funnel/template-evaluator.test.ts`: CN tech_saas quality skip coverage
- [ ] `spec/conventions.yaml` or agent-guide: document CN SaaS quality proxy scope (optional doc pass)
- Mispricing track unchanged; `forward_peg` remains high-tier deferred on mispricing supporting
