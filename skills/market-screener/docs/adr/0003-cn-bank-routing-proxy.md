---
status: accepted
date: 2026-06-14
---

# CN banks route to other_financials proxy until bank regulatory enrich exists

CN 申万 L1 **银行** cannot pass the `financials.banks` sub-template while high-tier bank metrics (`rotce`, `npl`, `provision_coverage`, `capital_adequacy`, `nim`, `pb_tangible`) remain without a data source. Grill decision: **temporarily route CN banks to `other_financials`** (option A) so mispricing-oriented ROE + P/B screening can run after enrichment Waves 1–2. This is a **proxy**, not a substitute for Buffett-style bank audit.

## Guardrails (required with proxy routing)

1. **Audit flag** — Every CN bank record routed via this path must carry `funnel_flags: bank_routed_via_other_financials_proxy`. Deep audit and landmine review must treat credit-quality checks (NPL, capital, tangible book) as **manual / N/A**, not as passed funnel gates.

2. **CN bank template overrides** — When `industry_proxy` L1 is 银行 (or routed sub_template is `other_financials` under this proxy), apply spec-level overrides on `other_financials`:
   - `net_debt_to_equity` supporting rule → `missing: skip` (industrial leverage semantics do not apply to banks; metric not derived today).
   - `revenue_3y_cagr` supporting rule → `missing: skip` or `min: 0` (banks grow slowly; avoid false negatives).
   - `roe_ttm` quality required → CN market override `min: 0.10` (large SOE banks often 10–11% ROE).

## Considered options

- **A — `other_financials` proxy + guardrails (accepted):** Enables ~3–8 mispricing passes (estimate) post-enrich; misses asset-quality dimensions until bank source spike.
- **B — Keep `banks` routing:** Semantically correct; 0% pass for entire enrich MVP.
- **C — Exclude banks from funnel:** Avoids misleading passes; conflicts with universe policy (financials not excluded).

## Accuracy expectations (documented, not guaranteed)

- Proxy covers roughly **ROE + P/B + dividend + Graham/52w** dimensions; **~50%+ of bank-specific audit dimensions** (NPL, coverage, capital, ROTCE, P/TBV) remain uncovered.
- Main false-positive risk: **low P/B driven by credit stress**, not margin-of-safety cheapness.
- `financial_kill_gates` in spec are **not yet implemented in CLI** — proxy does not worsen this; bank credit gates remain a Deep/manual responsibility until implemented.

## Consequences (implementation phase — not started in grill)

- `spec/cn-industry-map.yaml`: `银行` L1 → `{ template: financials, sub_template: other_financials }`.
- `spec/routing-map.yaml`: CN keyword `银行` aligned to `other_financials`; US GICS `4010` stays `banks`.
- `spec/templates/financials.yaml` or `spec/conventions.yaml`: CN bank overrides and proxy flag contract.
- `landmine-rules.yaml`: proxy banks use `financials_insurance_other` (P/B) formula until P/TBV available; flag in audit output.
- Revert routing when bank regulatory enrich tier ships; do not delete `banks` sub-template.
