---
status: accepted
date: 2026-06-14
---

# Metric source hygiene: no silent proxy fallbacks at funnel stage

## Decision

Funnel enrichment must not invent metrics. If a vendor field or reliable derive input is missing, the metric is omitted and templates evaluate it as missing (required → fail; `missing: skip` → skip).

## Removed proxies (CN)

- `roic` / `roic_ttm` / `roic_5y_avg`: was `roe × 0.85` → use East Money `ROIC` column
- `debt_to_equity`: was ALR transform → use `TOTAL_LIABILITIES / TOTAL_EQUITY`
- `net_debt_to_ebitda`, `mid_cycle_ev_ebitda`, EV/EBITDA chain: was revenue×ALR debt, OCF×0.1 cash, gross×0.7 EBITDA → balance sheet + operating profit only
- `operating_margin`: was `gross_margin × 0.35` fallback → operating profit / revenue only

## Removed proxies (US)

- `roe`: was `min(0.6, netIncome / (revenue × 0.3))` → `netIncome / stockholdersEquity` (prior-year average equity when 2+ years)
- `assetLiabilityRatio`: was hardcoded `0.45` → `liabilities / assets` when both tags present
- `grossProfit`: was `revenue × 0.35` → `GrossProfit` tag only (or `revenue - CostOfRevenue` when both present)
- `operatingCashFlow`: was `netIncome` fallback → `NetCashProvidedByUsedInOperatingActivities` only
- `operatingProfit`: was absent → `OperatingIncomeLoss` tag
- `roic` (US): derive `NOPAT / investedCapital` from SEC tags; omit when inputs missing (no ROE scale factor)

## Still documented simplifications (not silent invention)

- `ev_ebitda_vs_5y_median` omitted until point-in-time EV series exists (`missing: skip` on templates)
- `risk_free_rate` static 0.04 in `conventions.yaml` (documented; not a company metric)

## Consequences

- CN + US sector pass pools expected to shift vs proxy era; rerun live funnel / audit after deploy
- **CN and US enrich caches invalidated** — rerun with `--skip-cache` for sign-off quarter

## Validation

US live enrich smoke (`enrichUsRecord`, AAPL, `2026-Q1`, `--skip-cache`), 2026-06-14:

```json
{
  "roe_ttm": 1.7142244974480232,
  "roic_ttm": 0.9668801561437286,
  "debt_to_equity": 3.872187487285205,
  "operating_margin": 0.31970799762591884,
  "gross_margin": 0.4690516410716045
}
```

Gate: `roic_ttm` and `debt_to_equity` present; `roe_ttm` ≤ 2. `roe_ttm` ≈ 1.71 is elevated but expected for AAPL (buyback-compressed equity denominator), not a proxy bug.

## Post-cleanup CN replay

Live sector-pass pool audit (`2026-Q1`, East Money enrich + benchmarks, 2026-06-14). Stale enrich cache (pre-ROIC/balance rows) auto-refreshes on cache hit via `annualRowsNeedMetricRefresh`.

| Metric | Pre-cleanup (proxy) | Post-cleanup |
|--------|--------------------:|-------------:|
| Sector passes | 182 | **122** |
| Mfg total | 88 | **27** |
| Mfg mispricing-only | 66 | **2** |
| Roic-dependent mfg (winning pass) | 88 | **27** (100%) |

Proxy removal shrank the CN sector pool from 182 to **122** (not zero once stale cache refreshes). Mfg mispricing-only collapsed **66 → 2** — ADR 0002 mispricing expansion was largely proxy-driven. Remaining passes use vendor `ROIC` and balance-sheet derives; 53/122 (43%) still fail if `roic*` is stripped (honest dependence, not invented values).

Grep gate (no matches in `cli/src/`):

```bash
rg "revenue \* 0\.3|assetLiabilityRatio: 0\.45|revenue \* 0\.35|roicProxyFromRoe|grossProfit \* 0\.7" src/
```
