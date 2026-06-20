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

## Phase two — BLOCKED

Reroute 银行 → `financials.banks` when CN/US bank enrich is live. **Blocker (2026-06-14):** East Money datacenter bank-specialty reports return `9501 报表配置不存在`; generic financials lack regulatory fields. Requires **data-source spike** before code — see ADR 0006.

**Where it lives:** `spec/cn-industry-map.yaml`, `spec/templates/financials.yaml`, router/evaluator tests.
