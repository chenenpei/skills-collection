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
| High | Deferred | Bank regulatory fields, SaaS NDR/SBC (CN), insurance specialty, capacity utilization, customer concentration |

**CN banks:** high-tier → ADR 0003 proxy routing until source exists. **CN tech_saas SBC/dilution:** ADR 0004 CN skip on supporting only.

**Observability:** `metric_coverage` in `funnel-diagnostics.yaml` (ADR 0006) reports required-metric presence per template after enrich.
