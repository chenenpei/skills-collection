# Architecture decision records

Permanent **why** for market-screener funnel and enrich policy. Executable truth lives in `spec/` and `cli/`. Agent vocabulary lives in `CONTEXT.md`.

## Active files

| ADR | Topic | Notes |
|-----|-------|--------|
| [0002](./0002-enrichment-scope-tiers.md) | Low/medium enrich; defer high-tier | Policy reference |
| [0003](./0003-cn-bank-routing-proxy.md) | CN 银行历史代理路由 | Partially superseded by ADR 0008; current route is `financials.banks` |
| [0005](./0005-metric-source-hygiene.md) | No silent metric proxies | Referenced from `spec/metric-policy.yaml` |
| [0006](./0006-funnel-viability-and-sector-gates.md) | Viability exits, metric_coverage | Accepted; CN bank `full` viability still requires stronger coverage |
| [0008](./0008-cn-bank-disclosure-enrich.md) | CN bank disclosure scrape enrich; ROTCE→ROE required | **Delivered** — enrich live @ proxy viability |
| [0009](./0009-data-source-reliability.md) | CN live preflight, integrity gates, ut refresh, degraded run, incremental enrich | **Accepted** — phased delivery |

## Delivered (spec/code is source of truth; ADR files removed)

| Was | Decision | Where it lives |
|-----|----------|----------------|
| 0001 | Template track seat pools | `spec/selection-policy.yaml` -> `template_seat_allocation`; `ranker.ts`, `run.ts` |
| 0004 | CN tech_saas SBC/dilution skip + flag | `spec/templates/tech-saas.yaml`; `template-evaluator.ts` |
| 0007 | North-star pool tie-break | `spec/selection-policy.yaml` -> `pool_tie_break_north_star`; `ranker.test.ts` |

后续规划集中记录在 [future-work.md](../future-work.md)。
