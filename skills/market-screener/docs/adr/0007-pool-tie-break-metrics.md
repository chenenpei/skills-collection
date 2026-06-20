---
status: accepted
date: 2026-06-14
---

# Pool-scoped north-star metric tie-break replaces ticker sort in seat ranker

CN 2026-Q1 live run: 公牛集团 (`603195`, `consumer_quality`, `pool_score: 7`) landed in deferred while weaker consumer names (`001328`–`002991`) took cap seats because `compareInPool` used `ticker.localeCompare` after equal pool_score and data_confidence. 公牛 had higher `roe_5y_avg`, `roic_5y_avg`, and `dividend_yield` — a ranker design bug, not a sector-screen failure.

## Decision (grill Q1 — accepted)

**Option A:** Declare per **template track seat pool** an ordered tie-break policy in `spec/conventions.yaml`. Tie-break runs only inside `compareInPool` for a single pool key (ADR 0001 preserved). **Ticker sort is last resort only.**

## Decision (grill Q2 — accepted)

Support `metric:desc` (default, higher wins) or `metric:asc` (lower wins). Missing values rank worst for that metric (`desc` → −∞, `asc` → +∞).

## Decision (grill Q3 — accepted)

**Option A′:** Each pool declares **exactly one north-star metric** — not a multi-metric lexicographic chain. The metric must match that template track’s **stated investment philosophy** in sector YAML / CONTEXT (not an empirical weighting). `default_quality` / `default_mispricing` apply only when a pool key has no explicit entry (e.g. empty pools).

### North-star map (philosophy → metric)

| Pool | North-star | Direction | Rationale (sector philosophy) |
|------|------------|-----------|-------------------------------|
| `consumer_quality` | `roe_5y_avg` | desc | Buffett ROE compounding — consumer.yaml required #1 |
| `consumer_mispricing` | `fcf_yield` | desc | Graham / cash-income cheapness — mispricing required |
| `healthcare_quality` | `gross_margin` | desc | Moat / unit economics — healthcare quality required floor |
| `healthcare_mispricing` | `fcf_yield_vs_risk_free` | desc | Income vs risk-free spread — healthcare mispricing supporting |
| `manufacturing_quality` | `roic_5y_avg` | desc | Buffett ROIC / capital discipline — mfg quality required |
| `manufacturing_mispricing` | `roic_ttm` | desc | ADR 0006: cheap valuation must still earn on capital |
| `cyclicals_mispricing` | `mid_cycle_fcf_yield` | desc | Marks/Li Lu through-cycle cash yield — cyclicals mispricing |
| `financials_quality` | `roe_ttm` | desc | Financial compounder ROE — banks_proxy / other_financials quality |
| `financials_mispricing` | `pb` | asc | Balance-sheet cheapness — financials mispricing P/B gates |
| `tech_saas_quality` | `rule_of_40` | desc | Bessemer Rule of 40 — tech_saas quality required |
| `tech_saas_mispricing` | `revenue_yield_vs_peer` | desc | Rule-of-65 / sales-yield vs peers — tech mispricing supporting |
| `default_quality` | `roic_5y_avg` | desc | Generic capital-efficiency fallback |
| `default_mispricing` | `fcf_yield` | desc | Generic cash-yield fallback |

**Note:** `financials.banks` (ROTCE-first) is not yet in `financials_quality` pool at scale while CN uses `banks_proxy`. When true `banks` sub-template dominates the pool, revisit north-star (`rotce`) in a spec edit — do not mix ROTCE and ROE in one pool without a grill.

**603195 check:** `consumer_quality` uses `roe_5y_avg` → 公牛 0.278 beats 甘源 0.151; tie-break fix holds under A′.

## Considered options (rejected)

- **Ticker localeCompare:** Arbitrary (603195 case).
- **Multi-metric lexicographic chain:** Order implies hidden infinite weights; hard to defend which metric is “first.”
- **Equal-weight composite:** Mixes scales; still arbitrary without sector story.
- **Global cross-template score:** Violates funnel ranking role.

## Consequences

- `spec/conventions.yaml`: `pool_tie_break_north_star` map (one entry per pool key).
- `cli/src/funnel/ranker.ts`: single-metric compare with `:asc` / `:desc`; ticker last.
- `cli/test/funnel/ranker.test.ts`: 603195 vs 002991 on `roe_5y_avg`; `pb:asc` case.
- `CONTEXT.md`: `pool_tie_break` glossary updated.
- `global_quality` backfill uses `default_quality` north-star.
