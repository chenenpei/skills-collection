---
status: accepted
date: 2026-06-14
---

# Pool-scoped north-star metric tie-break replaces ticker sort

603195 (公牛) lost `consumer_quality` seats to weaker names on `ticker.localeCompare` after equal `pool_score`. **One north-star metric per pool** from sector philosophy; `:desc` / `:asc`; missing ranks worst; ticker last.

## North-star map

| Pool | Metric | Dir |
|------|--------|-----|
| `consumer_quality` | `roe_5y_avg` | desc |
| `consumer_mispricing` | `fcf_yield` | desc |
| `healthcare_quality` | `gross_margin` | desc |
| `healthcare_mispricing` | `fcf_yield_vs_risk_free` | desc |
| `manufacturing_quality` | `roic_5y_avg` | desc |
| `manufacturing_mispricing` | `roic_ttm` | desc |
| `cyclicals_mispricing` | `mid_cycle_fcf_yield` | desc |
| `financials_quality` | `roe_ttm` | desc |
| `financials_mispricing` | `pb` | asc |
| `tech_saas_quality` | `rule_of_40` | desc |
| `tech_saas_mispricing` | `revenue_yield_vs_peer` | desc |
| `default_quality` | `roic_5y_avg` | desc |
| `default_mispricing` | `fcf_yield` | desc |

When CN uses `banks_proxy`, `financials_quality` north-star is ROE-oriented; revisit `rotce` when true `banks` dominates (grill required).

## Rejected

Ticker sort; multi-metric lexicographic chains; equal-weight composites; global cross-template score.

**Where it lives:** `spec/conventions.yaml` (`pool_tie_break_north_star`), `ranker.ts`, `ranker.test.ts`.
