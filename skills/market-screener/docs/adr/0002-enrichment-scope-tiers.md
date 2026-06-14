---
status: accepted
date: 2026-06-14
---

# Enrichment scope: ship low and feasible medium tiers; defer high-tier sources

Sector templates reference many metrics, but live enrichment only derives a subset from East Money / SEC annual rows plus dividend. Grill decision: implement **all low-tier** enrichments, **feasible medium-tier** enrichments (derive + quote bulk + peer/history overlays without new regulatory or NLP sources), and **explicitly defer high-tier** metrics (bank regulatory fields, SaaS NDR/SBC, capacity utilization, customer concentration parsing, insurance specialty fields, same_store_sales_yoy).

Low tier is primarily Wave 1 derive-first (`mid_cycle_*`, `rule_of_40`, `revenue_10y_cagr`, cyclicals/mfg supporting derivations) plus Wave 2a quote bulk (PE/PB/price/52w on CN clist and US quote modules) wired through `DeriveContext`. Medium tier adds peer-relative overlays (`*_vs_peer_median`, `*_vs_industry_median` extensions), EV/EBITDA proxies from annual + market cap, and **per-ticker quote history in enrich cache** to support `*_vs_5y_median` without external vendors.

High-tier items remain `missing: skip` or template-required fields that block pass until a future source spike; CN **banks** sub-template (`rotce`, `npl`, `nim`) is in this bucket. CN bank routing is resolved separately in ADR 0003 (proxy via `other_financials` + guardrails).

## Consequences

- `spec/conventions.yaml` documents which metrics are in-scope per tier.
- `funnel-diagnostics.yaml` may report `metric_coverage` by template after enrich.
- Cyclicals and tech_saas quality tracks expected to move off 0% pass after Wave 1; mispricing tracks improve after quote bulk + medium overlays.
- CN banks: see ADR 0003 for proxy routing; US `banks` sub-template unchanged pending US bank enrich.
- CN tech_saas quality: see ADR 0004 for CN-only `missing: skip` on SBC/dilution supporting metrics.
