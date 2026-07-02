---
status: accepted
date: 2026-06-14
---

# Enrichment scope: ship low and feasible medium tiers; defer high-tier sources

Live enrich derives from East Money / SEC annual rows, quotes, dividends, cache history, and peer overlays — not new regulatory or NLP sources.

| Tier | Scope | Examples |
|------|--------|----------|
| Low | Derive + quote bulk | `mid_cycle_*`, `rule_of_40`, capex derive, CN/US ROIC hygiene |
| Medium | Peer/history overlays | `*_vs_industry_median`, `*_vs_5y_median` from enrich cache |
| High | Manual or explicitly implemented sector path | SaaS NDR/SBC (CN), insurance specialty, capacity utilization, customer concentration; CN bank regulatory ratios are partially implemented by ADR 0008 |

**CN banks:** ADR 0008 added disclosure scrape for regulatory ratios; current viability remains proxy until coverage is strong enough for `full`. **CN tech_saas SBC/dilution:** CN skip on supporting in `tech-saas.yaml`.

**Observability:** `metric_coverage` in `funnel-diagnostics.yaml` (ADR 0006) reports required-metric presence per template after enrich.
