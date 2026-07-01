---
status: accepted
date: 2026-06-27
supersedes_partial: docs/adr/0003-cn-bank-routing-proxy.md#phase-two
---

# CN bank regulatory enrich via disclosure scrape (Scheme E)

## Decision

- **Partial Go** for CN A-share banks: cninfo/Sina PDF+HTML scrape covers regulatory core (~90% on 10-bank sample FY2024).
- Funnel required profitability metric: **`roe_ttm` (East Money)**, not `rotce` (0/10 scrape coverage).
- `enrichment_tier: disclosure_scrape`; promote target **`proxy`**, not `full`.
- Source priority: (1) cninfo announcement search, (2) exchange disclosure index (SSE/SZSE), (3) Sina `ndbg` fallback (see ADR 0009); East Money still supplies `roe_ttm`/`roa` fallback fields.
- Implementation uses runtime `discoverBankBulletin()` with official-first PDF discovery; Sina is last-resort fallback, not the primary path.

## Coverage (FY2024 sample, merged)

| Metric | Coverage |
|--------|----------|
| npl_ratio | 9/10 |
| provision_coverage | 9/10 |
| capital_adequacy | 10/10 |
| roa | 10/10 (scrape); EM fallback |
| roe_ttm | EM ~100% |
| nim | 5/10 (supporting only) |
| rotce | 0/10 → deep_only |

## Known gaps and deferred contracts

601988 中国银行: NPL/provision not in first 20 PDF pages (image tables). Policy: **omit + flag**, no silent proxy (ADR 0005).

`npl_ratio_yoy_change` is intentionally deferred. The current bank scrape stores one fiscal year per run; YoY requires FY and FY-1 disclosure discovery, extraction, and a delta derive. The spec keeps this metric under `missing: skip`, so absent YoY values do not block candidate selection.

`financial_kill_gates` are also deferred in the CLI. The `npl_spike` condition depends on `npl_ratio_yoy_change`, so credit-quality spike checks remain Deep/manual until a two-fiscal-year bank scrape phase validates coverage. Keep `financials.banks` at **proxy** viability until YoY (`npl_ratio_yoy_change`), NIM supporting coverage, and remaining image-table disclosure gaps support a full promote.

## Rejected

- ROTCE as funnel required (derive blocked; ROTCE≈ROE for CN majors ~0.2–0.3pp).
- NFRA/gov.cn as per-ticker source (industry aggregate only).
- iWencai as production adapter (no stable API).
- Static FY-specific bulletin URL map as production source (links age and require ongoing manual maintenance).
