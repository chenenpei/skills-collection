---
status: accepted
date: 2026-06-28
related: docs/adr/0005-metric-source-hygiene.md, docs/adr/0008-cn-bank-disclosure-enrich.md
---

# Data source reliability (CN live pipeline)

## Context

The 2026-06 CN quote field mapping bug showed that **HTTP 200 with wrong or empty semantics** is more dangerous than a hard outage: the funnel ran silently with price labeled as PE. Separately, live runs depend on a hardcoded East Money `ut` token, Sina-first bank PDF discovery, full-quarter re-fetch, and no quote-layer fallback.

## Decision

Add reliability guardrails **without new module directories**. Extend existing files only. The current implementation covers preflight probes, integrity checks, dynamic `ut` refresh, opt-in degraded quote fallback, official-first bank PDF discovery, and incremental CN enrich cache inheritance.

| Concern | Location | Behavior |
|---------|----------|----------|
| Preflight probes | `cn/quotes.ts`, `cn/eastmoney.ts`, `commands/run.ts` | Live `run` probes datacenter + anchor tickers before full universe fetch |
| Post-fetch integrity | `cn/quotes.ts`, `run.ts` | After CN quote load, assert count + field presence + PE≠price rate |
| Dynamic `ut` | `cn/eastmoney.ts` | Scrape/cache `ut`; hardcoded value is last-resort fallback |
| Degraded run | `commands/run.ts`, `data/live.ts` | Opt-in `--allow-degraded` (default **off**); quote fallback to prior-quarter cache or fixture; metric-level `dataConfidence: low` plus propagated audit hints |
| Bank PDF sources | `cn/bank-indicators/discover.ts` | cninfo/sse/szse first; Sina ndbg last |
| Incremental enrich | `lib/cache.ts`, `cn/enrich.ts` | `--inherit-cache-from {quarter}` copies annual/dividend/industry; always refresh quote fields |

## Integrity thresholds (CN quote universe)

Hard fail (exit 1) when any bound is violated after full quote load:

| Check | Bound |
|-------|-------|
| `universe_count` | 5_200 – 6_200 |
| `market_cap_present_rate` | ≥ 0.94 |
| `pe_equals_price_rate` | ≤ 0.001 |

PE/PB presence is reported but is **not** a hard failure in the first implementation. Loss-making and special-status A-share names can legitimately lack positive PE/PB, so hard thresholds must be calibrated from live runs before promotion. The preflight anchor tickers (same as `test-cn-quote-snapshot.ts`) still hard-check PE/PB/price semantics: `603195`, `600519`, `600919`.

## Degradation policy

- **`--allow-degraded` default: false.** Operators must opt in.
- Hard integrity failure **never** auto-degrades (prevents masking silent wrong data — priority A).
- When degraded: lower affected quote-derived metric `dataConfidence` values to `low`, add an audit hint such as `quote_degraded:cache:2026-Q1`, and explicitly propagate that hint into funnel output. `SecurityRecord` currently has no record-level `dataConfidence` or `funnel_flags` field.
- Degraded funnel output is **not sign-off quality**; document in `docs/agent-guide.md`.

## Bank PDF source priority (updates ADR 0008)

1. cninfo announcement search / static PDF URL  
2. Exchange disclosure index (SSE/SZSE by listing)  
3. Sina `ndbg` list + detail page (existing path)

Record `sourceTier` on `BankBulletinEntry`; Sina-only success logs a warning.

## Incremental enrich

- New quarter: always refresh quote metrics and `quoteHistory`.
- Annual rows / dividend / industry: skip datacenter fetch when inherited cache is complete unless `--skip-cache` or `annualRowsNeedMetricRefresh`.
- CLI: `--inherit-cache-from 2026-Q1` on `run`.

## Rejected

- New `src/data/health/` package (YAGNI; keep flat files).
- New `screener probe` subcommand (preflight lives in `run` + optional `scripts/probes/cn-preflight.ts`).
- Auto-degrade on integrity hard fail.
- Skipping preflight by default on live runs.
