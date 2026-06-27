---
status: accepted
date: 2026-06-14
supersedes_in_part: docs/adr/0003-cn-bank-routing-proxy.md
---

# Funnel viability exits, live metric hygiene, and sector dual-gate policy

Distinguish three outcomes: **unmapped routing** (`routing_too_hard`), **data-poor templates** (`sector_quant_too_hard` or **proxy** sub-templates), and **normal dual-gate screening** (all required + supporting `min_N_of_M`). Six top-level templates only; finer splits via routing, sub-templates, ambiguous union — not a seventh generic bucket.

## Decisions

**Routing:** `fallback` → empty templates + `routing_too_hard` exit (no manufacturing default). Target `fallback_rate` < 5%; extend `cn-industry-map.yaml` from diagnostics.

**Template live viability** (`spec/conventions.yaml`):

| Viability | Behavior |
|-----------|----------|
| `full` | Dual gates |
| `proxy` | Degraded rules + flags |
| `quant_too_hard` | Skip sector scoring |

Mapping: `consumer`, `healthcare`, `manufacturing`, `cyclicals` → full; `financials.banks`, `financials.banks_proxy`, `tech_saas` → proxy; `financials.insurance` → quant_too_hard. CN banks route to `financials.banks` after ADR 0008 disclosure enrich; `banks_proxy` remains as fallback documentation.

**Live metric policy:** Permanent gaps → remove from YAML, list in `deep_only_metrics`, fix `pass_if` denominators. Temporary gaps → `missing: skip` + supporting downgrade. Manufacturing mispricing keeps **required** `roic_ttm`.

**Observability:** `metric_coverage` + advisory `manifest_review` in `funnel-diagnostics.yaml` — suggests manifest changes; never auto-updates spec.

## Rejected

Seventh generic template; required-only sector pass; runtime missing-rate viability; fallback→manufacturing; stub bank fetchers.

## Delivered (2026-06-14)

Router/run/diagnostics, template YAML cleanup, routing report, north-star tie-break (`pool_tie_break_north_star`), tests (153 pass).

## Open

- CN live/cache replay sign-off when operator cache present.
- US bank SEC regulatory enrich probe.
- CN bank coverage hardening for `full` viability, especially `npl_ratio_yoy_change`, NIM, and image-table ROA gaps.
