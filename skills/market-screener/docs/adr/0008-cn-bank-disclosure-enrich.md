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
- Source priority: (1) cninfo/Sina disclosure, (2) East Money `roe_ttm`/`roa`, (3) optional iFinD cross-check.

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

## Known gap

601988 中国银行: NPL/provision not in first 20 PDF pages (image tables). Policy: **omit + flag**, no silent proxy (ADR 0005).

## Rejected

- ROTCE as funnel required (derive blocked; ROTCE≈ROE for CN majors ~0.2–0.3pp).
- NFRA/gov.cn as per-ticker source (industry aggregate only).
- iWencai as production adapter (no stable API).
