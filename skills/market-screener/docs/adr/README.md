# Architecture decision records

Permanent **why** for market-screener funnel and enrich policy. Executable truth lives in `spec/` and `cli/`. Agent vocabulary lives in `CONTEXT.md`.

## Active files

| ADR | Topic | Notes |
|-----|-------|--------|
| [0002](./0002-enrichment-scope-tiers.md) | Low/medium enrich; defer high-tier | Policy reference |
| [0003](./0003-cn-bank-routing-proxy.md) | CN 银行 → `financials.banks` | Phase two **done** (ADR 0008 enrich live) |
| [0005](./0005-metric-source-hygiene.md) | No silent metric proxies | Referenced from `spec/conventions.yaml` |
| [0006](./0006-funnel-viability-and-sector-gates.md) | Viability exits, metric_coverage | Delivered; bank **full** viability promote blocked (proxy enrich live per ADR 0008) |
| [0008](./0008-cn-bank-disclosure-enrich.md) | CN bank disclosure scrape enrich; ROTCE→ROE required | **Delivered** — enrich live @ proxy viability |
| [0009](./0009-data-source-reliability.md) | CN live preflight, integrity gates, ut refresh, degraded run, incremental enrich | **Delivered** — residual work is US operational hardening and deferred live contracts |

## Delivered (spec/code is source of truth; ADR files removed)

| Was | Decision | Where it lives |
|-----|----------|----------------|
| 0001 | Template track seat pools | `spec/conventions.yaml` → `template_seat_allocation`; `ranker.ts`, `run.ts` |
| 0004 | CN tech_saas SBC/dilution skip + flag | `spec/templates/tech-saas.yaml`; `template-evaluator.ts` |
| 0007 | North-star pool tie-break | `spec/conventions.yaml` → `pool_tie_break_north_star`; `ranker.test.ts` |

**Open work:** US bank SEC enrich probe; insurance quant_too_hard; `npl_ratio_yoy_change` / `financial_kill_gates` deferred until a two-fiscal-year bank scrape phase; NIM/supporting coverage for `financials.banks` full viability.
