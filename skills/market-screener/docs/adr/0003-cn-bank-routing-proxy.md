---
status: accepted
date: 2026-06-14
---

# CN banks route to banks_proxy until bank regulatory enrich exists

CN 申万 L1 **银行** cannot pass the `financials.banks` sub-template while high-tier bank metrics (`rotce`, `npl`, `provision_coverage`, `capital_adequacy`, `nim`, `pb_tangible`) remain without a data source. Grill decision: **temporarily route CN banks to `financials.banks_proxy`** (a dedicated degraded sub-template) so ROE + P/B screening can run after enrichment Waves 1–2. This is a **proxy**, not a substitute for Buffett-style bank audit.

> **Note (2026-06-14):** Early grill text referenced `other_financials`; implementation uses **`banks_proxy`** in `spec/templates/financials.yaml` and `spec/cn-industry-map.yaml`. Phase-two migration to `banks` is documented in ADR 0006.

## Guardrails (required with proxy routing)

1. **Audit flag** — Every CN bank record routed via this path must carry `funnel_flags: bank_routed_via_other_financials_proxy`. Deep audit and landmine review must treat credit-quality checks (NPL, capital, tangible book) as **manual / N/A**, not as passed funnel gates.

2. **CN bank template overrides** — Applied on `banks_proxy` (not `other_financials`):
   - `net_debt_to_equity` supporting rule → `missing: skip`
   - `revenue_3y_cagr` supporting rule → `missing: skip`
   - `roe_ttm` quality required → CN market override `min: 0.10`

## Considered options

- **A — `banks_proxy` + guardrails (accepted):** Enables limited mispricing passes post-enrich; misses asset-quality dimensions until bank source spike.
- **B — Keep `banks` routing:** Semantically correct; 0% pass for entire enrich MVP.
- **C — Exclude banks from funnel:** Avoids misleading passes; conflicts with universe policy (financials not excluded).

## Accuracy expectations (documented, not guaranteed)

- Proxy covers roughly **ROE + P/B + dividend + Graham/52w** dimensions; **~50%+ of bank-specific audit dimensions** (NPL, coverage, capital, ROTCE, P/TBV) remain uncovered.
- Main false-positive risk: **low P/B driven by credit stress**, not margin-of-safety cheapness.
- `financial_kill_gates` in spec are **not yet implemented in CLI** — proxy does not worsen this; bank credit gates remain a Deep/manual responsibility until implemented.

## Consequences

- [x] `spec/cn-industry-map.yaml`: `银行` L1 → `{ template: financials, sub_template: banks_proxy }`
- [x] `spec/templates/financials.yaml`: `banks_proxy` sub-template with flags and overrides
- [x] `cli/test/funnel/router.test.ts`, `template-evaluator.test.ts`: banks_proxy coverage
- [ ] Phase two (ADR 0006): CN + US bank regulatory enrich; reroute CN 银行 → `banks`; retire proxy dependence
