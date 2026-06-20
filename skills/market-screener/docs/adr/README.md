# Architecture decision records

Permanent **why** for market-screener funnel and enrich policy. Executable truth lives in `spec/` and `cli/`. Agent vocabulary lives in `CONTEXT.md`.

| ADR | Topic | Status |
|-----|-------|--------|
| [0001](./0001-template-seat-allocation.md) | Template track seat pools replace global rank | Delivered |
| [0002](./0002-enrichment-scope-tiers.md) | Low/medium enrich; defer high-tier sources | Delivered |
| [0003](./0003-cn-bank-routing-proxy.md) | CN 银行 → `banks_proxy` until bank data | Active (proxy) |
| [0004](./0004-cn-tech-saas-quality-skip.md) | CN skip SBC/dilution supporting + flag | Delivered |
| [0005](./0005-metric-source-hygiene.md) | No silent metric proxies at funnel stage | Delivered |
| [0006](./0006-funnel-viability-and-sector-gates.md) | Viability exits, deep_only, metric_coverage | Delivered; bank phase blocked |
| [0007](./0007-pool-tie-break-metrics.md) | North-star pool tie-break | Delivered |

**Open work:** bank regulatory enrich + CN 银行 → `financials.banks` — blocked pending data-source spike (see ADR 0003, 0006).
