---
status: partially_superseded
date: 2026-06-14
superseded_by: docs/adr/0008-cn-bank-disclosure-enrich.md
---

# Historical CN bank proxy route

Current rule: CN banks route to `financials.banks` after ADR 0008 disclosure enrichment. This ADR records the earlier proxy decision and should not be used as the current routing source. Current executable truth lives in `spec/routing-cn.yaml` and `spec/templates/financials.yaml`.

Original decision: CN 申万 L1 **银行** could not pass `financials.banks` without NPL, capital adequacy, ROTCE, NIM, etc. The temporary route was `financials.banks_proxy` — ROE + P/B mispricing only; not a Buffett bank audit.

## Guardrails

- Flag: `bank_routed_via_other_financials_proxy` on every proxied record.
- Template overrides on `banks_proxy`: `net_debt_to_equity` and `revenue_3y_cagr` → `missing: skip`; quality `roe_ttm` CN min **0.10**.
- Credit quality (NPL, capital, TBV) is **Deep/manual**; `financial_kill_gates` in spec are not in CLI yet.

## Rejected

Keep `banks` routing (0% pass); exclude banks from universe.

## Superseded update (2026-06-27)

CN 银行 routes to `financials.banks` with disclosure enrich (ADR 0008). `banks_proxy` retained in spec for fallback documentation; CN industry map no longer routes to it.
