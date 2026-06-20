---
status: accepted
date: 2026-06-14
supersedes_in_part: docs/adr/0003-cn-bank-routing-proxy.md
---

# Funnel viability exits, live metric hygiene, and sector dual-gate policy

The live funnel must distinguish three outcomes that were previously conflated: **unmapped routing** (`routing_too_hard`), **mapped but data-poor templates** (`sector_quant_too_hard` or explicit **proxy** sub-templates), and **normal sector dual-gate screening** (required + supporting `min_N_of_M`). Top-level sector taxonomy stays at **six templates** aligned with stock-analysis-audit; finer splits use routing, sub-templates, overrides, and ambiguous union—not a seventh generic template.

## Decisions

### Taxonomy and routing

- **Fixed six top-level templates** (`financials`, `tech_saas`, `consumer`, `cyclicals`, `manufacturing`, `healthcare`). Additional top-level templates are rare.
- **Sub-templates** supply full alternate `quality_track` / `mispricing_track` blocks (today: `financials` only). Primary A-share subdivision is `cn-industry-map` L2/L3 routing, not per-L2 sub-templates.
- **Routing operational target:** `fallback_rate` below 5%, extend `cn-industry-map.yaml` when diagnostics show new unmapped blocks; regression-test known L2/L3 rules. Does not require per-security economic-paradigm perfection.
- **`routing_method: fallback` → `routing_too_hard`:** securities with no reliable classifier **skip sector template scoring** and record an explicit exit reason. They remain in the investable universe for optional Deep audit. **Do not** default-evaluate against `fallback_template: manufacturing` (legacy behavior in `routing-map.yaml` and `router.ts` pending removal).

### Template live viability (policy C)

Declare per template/sub-template:

| Viability | Behavior |
|-----------|----------|
| `full` | Run required + supporting dual gates |
| `proxy` | Run explicit degraded rules + `funnel_flags` / `audit_hints` |
| `quant_too_hard` | Skip sector scoring until data or routing improves |

Initial mapping:

- `consumer`, `healthcare`, `manufacturing`, `cyclicals` → **full**
- `financials.banks_proxy`, `tech_saas` → **proxy**
- `financials.banks`, `financials.insurance` → **quant_too_hard** (until regulatory enrich ships)

### Sector dual-gate screening (strict sector pool)

- **Sector pool must stay high quality:** pass a track only when **all required** metrics pass **and** supporting `min_N_of_M` passes (`package_m` defaults unchanged).
- **Live template metric policy:** permanently unavailable metrics are **removed from YAML** and documented as `deep_only`; `pass_if` denominators match remaining supporting rows; **evaluator supporting downgrade unchanged** for temporary `missing: skip` and conditional skips (`if_unprofitable`, etc.).
- **Manufacturing mispricing** keeps `roic_ttm` as **required** (cheap valuation alone cannot pass).

### CN / US bank enrich (A→B phased)

- **Now:** CN 申万 L1 **银行** routes to `financials.banks_proxy` (dedicated sub-template with ROE/P/B rules and `bank_routed_via_other_financials_proxy` flag)—not `other_financials`.
- **Phase two:** when CN and US bank regulatory fields are live (NPL, provision coverage, capital adequacy, ROTCE, etc.), reroute CN banks to `financials.banks` and retire proxy dependence. **First high-tier enrich spike:** CN East Money bank reports + US SEC bank tags (FFIEC optional).

## Considered options (rejected)

- **Seventh generic / `unscreened` top-level template** — breaks audit sector alignment.
- **Required-only sector pass (supporting for rank only)** — rejected; sector pool should stay strict (dual gates).
- **Runtime missing-rate `sector_quant_too_hard`** — rejected; use template policy declarations instead.
- **Keep fallback → manufacturing scoring** — rejected; mislabels unmapped industries.

## Consequences (implementation checklist)

**Spec / CONTEXT (partially done in grill)**

- [x] `CONTEXT.md` glossary: `routing_too_hard`, `sector_quant_too_hard`, `template_live_viability`, `sector_dual_gate_screening`, `live_template_metric_policy`, `manufacturing_mispricing_roic_floor`, `bank_regulatory_enrich_priority`
- [ ] `spec/conventions.yaml`: `template_live_viability` manifest; `deep_only_metrics` list
- [ ] Remove dead supporting metrics from `spec/templates/*.yaml`; align `pass_if` denominators
- [ ] ADR 0003 body updated to `banks_proxy` (see superseded_in_part note above)

**CLI (pending)**

- [ ] `router.ts` / `run.ts`: fallback emits `routing_too_hard` exit instead of manufacturing evaluate
- [ ] Funnel output: new sector skip reason slug(s); `funnel-diagnostics.yaml` counters for `routing_too_hard` and `sector_quant_too_hard`
- [ ] `routing-map.yaml`: remove or ignore `fallback_template: manufacturing` once code paths updated
- [ ] `scripts/routing-report.ts`: fix outdated sanity check expecting zero 消费电子→consumer routes
- [ ] Optional: `metric_coverage` by template in `funnel-diagnostics.yaml` (ADR 0002 consequence; not blocking)

**Data (pending — parallel tracks)**

- [ ] CN bank regulatory enrich via East Money datacenter
- [ ] US bank regulatory enrich via SEC companyfacts (+ optional FFIEC)
- [ ] CN `cn-industry-map`: switch 银行 from `banks_proxy` → `banks` after fields + tests pass

**No change**

- ADR 0001 template seat allocation and global_quality backfill (operator accepts sector-rich deferred competition under soft cap 20).
- ADR 0005 metric source hygiene (no silent proxy reinvention).

## Validation

- After implementation: CN live run reports `routing_too_hard` count separately from `sector_quant_too_hard`; fallback rate still tracked pre-exit.
- `npm test` + `routing-report.ts` + sector-pass regression on `2026-Q1` CN cache.
- Bank phase-two sign-off: `financials.banks` evaluates on fixture tickers with NPL/capital fields before CN map switch.
