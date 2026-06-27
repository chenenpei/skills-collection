---
status: accepted
date: 2026-06-14
---

# CN banks route to banks_proxy until bank regulatory enrich exists

CN 申万 L1 **银行** cannot pass `financials.banks` without NPL, capital adequacy, ROTCE, NIM, etc. **Route to `financials.banks_proxy`** — ROE + P/B mispricing only; not a Buffett bank audit.

## Guardrails

- Flag: `bank_routed_via_other_financials_proxy` on every proxied record.
- Template overrides on `banks_proxy`: `net_debt_to_equity` and `revenue_3y_cagr` → `missing: skip`; quality `roe_ttm` CN min **0.10**.
- Credit quality (NPL, capital, TBV) is **Deep/manual**; `financial_kill_gates` in spec are not in CLI yet.

## Rejected

Keep `banks` routing (0% pass); exclude banks from universe.

## Phase two — DONE (2026-06-27)

CN 银行 routes to `financials.banks` with disclosure enrich (ADR 0008). `banks_proxy` retained in spec for fallback documentation; CN industry map no longer routes to it.
