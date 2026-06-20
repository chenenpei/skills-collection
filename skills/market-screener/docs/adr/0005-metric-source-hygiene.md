---
status: accepted
date: 2026-06-14
---

# Metric source hygiene: no silent proxy fallbacks at funnel stage

If a vendor field or reliable derive input is missing, **omit the metric**. Templates treat it as missing (required → fail; `missing: skip` → skip). Never invent (e.g. `roe × 0.85`, `revenue × ALR`, gross-margin EBITDA proxies).

## Removed (representative)

| Market | Was | Now |
|--------|-----|-----|
| CN | ROIC from ROE scale | East Money `ROIC` column |
| CN | Debt/EBITDA from ALR | Balance sheet + operating profit |
| US | Hardcoded ALR, gross×0.35 | SEC tags only; omit when absent |

Documented simplifications (not invention): static `risk_free_rate` 0.04; `ev_ebitda_vs_5y_median` omitted until EV history exists.

## Effect

CN sector passes dropped post-cleanup (proxy-inflated mfg mispricing collapsed). **Invalidate enrich cache** after deploy (`--skip-cache` on sign-off quarter).

**Where it lives:** `cli/src/data/metrics.ts`, `cn/eastmoney.ts`, `us/sec.ts`, `spec/conventions.yaml` (`metric_source_hygiene` ref).
