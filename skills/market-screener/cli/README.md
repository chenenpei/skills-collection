# market-screener CLI

TypeScript `screener` binary (Commander + tsx). Runs the quantitative funnel from `../spec/` and writes `candidates.yaml`, `deferred.yaml`, `excluded.yaml`, and (live only) `prefilter-excluded.yaml` per market.

## Install

```bash
cd skills/market-screener/cli
npm install
```


## Source layout

```
src/
  cli.ts
  commands/     run | explain | validate | landmine | filter-breakdown | bank-indicators
  funnel/       run, router, kill-gates, template-evaluator, ranker, threshold, universe, diagnostics, types
  data/         registry, fixture, live, quote-prefilter, metrics, types; cn/ and us/ market adapters
  io/           artifacts (YAML output helpers)
  spec/         YAML loader and validation
  lib/          paths, cache, http, concurrency
```

## Commands

Run from this directory via `npm run dev -- <command>` or `npx tsx bin/screener.ts <command>`.

| Command | Purpose |
|---------|---------|
| `validate <specDir>` | Lint spec YAML (`npm run validate` → `../spec`) |
| `run` | Quantitative funnel |
| `explain <ticker>` | Single-ticker routing trace (fixture only) |
| `landmine` | Landmine YAML from audit-summary |
| `filter-breakdown` | Industry-grouped filter statistics from funnel output |
| `bank-indicators <ticker>` | Debug CN bank disclosure scrape for one fiscal year |

### `run` options

| Flag | Default | Description |
|------|---------|-------------|
| `--markets` | — | `CN`, `US`, or `CN,US` |
| `--quarter` | — | e.g. `2026-Q2` |
| `--output` | — | Output root; writes `{output}/{quarter}/{market}/` |
| `--spec` | — | Path to spec directory |
| `--adapter` | `fixture` | `fixture` (offline) or `live` (network) |
| `--enrich-concurrency` | `4` | Parallel enrichment tickers (live only; each may issue 2 HTTP calls) |
| `--skip-cache` | off | Ignore enrichment disk cache — no read or write (live only) |
| `--skip-preflight` | off | Live CN and US; bypasses quote/datacenter/Yahoo preflight. Use only when diagnosing a known source outage. |
| `--allow-degraded` | off | Live CN only; permits low-confidence quote fallback when the quote source is unavailable. Never use for quarterly sign-off. |
| `--quote-fallback-quarter` | — | Prior quarter containing `data/cache/{quarter}/CN/cn-quote-universe.json` for degraded quote fallback |
| `--quote-fallback-fixtures-dir` | — | Fixture directory used only when `--allow-degraded` is set and live CN quote loading fails |
| `--inherit-cache-from` | — | CN live only; seed stable annual/dividend/industry enrichment from a prior quarter while refreshing current quotes |

## Live adapter & enrichment (M3)

`--adapter live` runs a two-stage pipeline:

1. **Quote universe** — CN East Money list + US Yahoo quotes (market cap, price, basic fields).
2. **Quote prefilter** — skip status/cap/age failures before HTTP (written to `prefilter-excluded.yaml`).
3. **Enrichment** — per surviving security, fetch annual financials and industry proxy, derive metrics (including `operating_margin`), run disclosure scrape for CN banks, apply industry median overlays, merge into `SecurityRecord`.

| Market | Enrichment sources |
|--------|-------------------|
| CN | East Money datacenter annual (`RPT_*`) + orginfo industry proxy; CN banks add runtime annual-report discovery (cninfo → SSE/SZSE → Sina fallback) + disclosure PDF scrape |
| US | SEC EDGAR `companyfacts` + `submissions` industry proxy (CIK resolved via SEC ticker map) |

### CN bank disclosure debug

```bash
npm run dev -- bank-indicators 600919 --year 2025
```

The command uses the same runtime disclosure discovery path as live CN bank enrichment (cninfo → exchange → Sina). It does not require `--spec`.

Enrichment runs only with `--adapter live`. The fixture adapter ships pre-enriched JSON and skips network enrichment.

### Quarter cache

Responses are cached on disk to make repeat runs fast (especially CN, 4000+ tickers):

```
data/cache/{quarter}/{CN|US}/{ticker}.json
```

- First CN live run for a quarter: typically **30–60 min** (one request per ticker unless cached).
- Subsequent runs in the same quarter read cache unless `--skip-cache` is set.
- Empty financial responses are **not** cached (next run refetches).
- Cache is keyed by quarter + market + ticker; safe to delete `data/cache/{quarter}/` to force a refresh.
- Host in-flight caps: East Money datacenter 8, SEC 4 (in addition to `--enrich-concurrency`).

Use `--inherit-cache-from 2026-Q1` when opening a new quarter to reuse stable CN annual/dividend/industry enrichment from the prior quarter. Current quote metrics and `quoteHistory` are still refreshed for the target quarter. Do not use inheritance when the prior quarter cache was produced before a metric-source or schema correction.

### Metric source hygiene (ADR 0005)

Enrichment must not invent missing metrics. Proxy fallbacks removed in favor of vendor fields or explicit derives; omitted metrics flow through templates as missing (required → fail, `missing: skip` → skip). See [`../docs/adr/0005-metric-source-hygiene.md`](../docs/adr/0005-metric-source-hygiene.md).

| Market | Real sources (no silent proxies) |
|--------|----------------------------------|
| CN | East Money `ROIC` column; `debt_to_equity` from `TOTAL_LIABILITIES / TOTAL_EQUITY`; operating margin from operating profit / revenue; EV/EBITDA chain from balance sheet + operating profit only |
| US | SEC `companyfacts` tags: equity-based ROE, `GrossProfit` / revenue − COGS, `OperatingIncomeLoss`, operating cash flow tag only; ROIC from NOPAT / invested capital when inputs exist |

**Cache invalidation:** After metric-source changes, delete `data/cache/{quarter}/` or rerun live enrichment with `--skip-cache` for **both CN and US** on the sign-off quarter before funnel sign-off. Stale cache files can retain pre-hygiene proxy values. On cache hit, enrich automatically refetches annual rows when the latest cached year lacks `roic` or `totalEquity` (ADR 0005 fields).

## E2E scripts

Offline and live end-to-end checks live in `scripts/` and are **not** part of `npm test`.

| Script | Command | What it checks |
|--------|---------|----------------|
| Fixture E2E | `npm run e2e:fixture` | Full CN+US funnel on fixtures; no network |
| Live E2E | `npm run e2e:live` | Real-network live run (default: CN, `2026-Q1`) |
| Live E2E (full) | `npm run e2e:live:full` | CN+US live run with enrichment assertions |
| CN quote smoke | `npm run smoke:cn` | Live East Money quote anchors + datacenter annual-row probe (`probeCnQuotes`) |
| US quote smoke | `npm run smoke:us` | Live Yahoo session bootstrap + universe fetch timing + top-5 sample |

Optional CN PE/PB range regression: `npx tsx scripts/test-cn-quote-snapshot.ts` (not wired into `npm run smoke:cn`).

Pass extra args through to the live script:

```bash
npm run e2e:live -- --markets CN,US --quarter 2026-Q2
```

Live E2E asserts enriched candidates (`candidates >= 1`, non-empty `metric_snapshot`), CN universe scale, and no false `kill_revenue_decline_3y_consecutive` on empty YoY. Requires network; on macOS with a system proxy, set `HTTPS_PROXY` (see `scripts/e2e-live.ts`).

### Yahoo live availability

US quote universe loading depends on Yahoo Finance (`fc.yahoo.com` session bootstrap plus `query1.finance.yahoo.com` quote/screener endpoints). Some cloud IP ranges receive Yahoo CDN/ATS 429s before the crumb request completes; cookies and retries do not fix that class of block.

Run `npm run smoke:us` on every new server agent before enabling `--markets US` live runs. If the smoke test fails with Yahoo 429 errors (for example `Yahoo session bootstrap failed: 429`, `Yahoo crumb failed: 429`, or `Yahoo screener failed: 429`), use one of these operating modes:

- Run CN-only live (`--markets CN`) on that host.
- Set `HTTPS_PROXY` to a non-cloud exit IP and rerun `npm run smoke:us`.
- Syncing US enrichment cache can speed up SEC enrichment on Yahoo-reachable hosts, but it does **not** bypass Yahoo for the US quote universe. On a Yahoo-blocked host, run CN-only or use a host/proxy where `npm run smoke:us` succeeds.

`npm test` mocks Yahoo adapters by design; it does not validate Yahoo reachability.

### Output artifacts (per market)

| File | When |
|------|------|
| `candidates.yaml` | Always |
| `deferred.yaml` | Always (may be empty) |
| `excluded.yaml` | Kill gates on **enriched** universe |
| `prefilter-excluded.yaml` | Live only, when quote prefilter skips exist |
| `routing-diagnostics.yaml` | Always (routing summary for Kill survivors) |
| `funnel-diagnostics.yaml` | Always (full funnel stage counts + reason breakdown) |

### Funnel replay report

After a run, print a readable Markdown funnel replay (prefilter/kill reason shares, routing distribution, sector pass rates):

```bash
npx tsx scripts/funnel-replay.ts --from-output ./funnel-output/2026-Q1/CN
npx tsx scripts/funnel-replay.ts --from-output ./funnel-output/2026-Q1/CN --write report.md
```

Works from `funnel-diagnostics.yaml` when present; otherwise reconstructs from `prefilter-excluded.yaml`, `excluded.yaml`, and `routing-diagnostics.yaml`.

### Filter breakdown (industry hierarchy)

Industry-grouped exit stats: prefilter / kill / sector filter / deferred / candidate, with L1–L3 Shenwan tables and per-L1 reason ranking. **Default writes** `{output}/{quarter}/{market}/filter-breakdown.md` next to `candidates.yaml`.

```bash
# Same --output root as screener run (recommended)
npm run dev -- filter-breakdown --output ./funnel-output/ --quarter 2026-Q1 --markets CN

# Or explicit market dir
npm run dev -- filter-breakdown --from-output ./funnel-output/2026-Q1/CN

# Custom report path / stdout
npm run dev -- filter-breakdown --output ./funnel-output/ --quarter 2026-Q1 --markets CN --report ./reports/cn-filters.md
npm run dev -- filter-breakdown --from-output ./funnel-output/2026-Q1/CN --stdout

# Append template-track rule failures (required vs supporting metrics):
npm run dev -- filter-breakdown --from-output ./funnel-output/2026-Q1/CN --template-tracks
npm run dev -- filter-breakdown --from-output ./funnel-output/2026-Q1/CN --template-tracks --template manufacturing --track quality --industry-l1 机械设备
```

`--template-tracks` replays spec evaluation from enrichment cache. Filters: `--stage`, `--template`, `--track`, `--industry-l1|l2|l3`, `--track-top`. Appends a section to `filter-breakdown.md`.

### Routing report (cache)

Offline routing distribution from enrichment cache (`industryProxy` per ticker):

```bash
npx tsx scripts/routing-report.ts --quarter 2026-Q1 --market CN --spec ../spec
```

Use after a live enrichment run to verify CN map coverage (`fallback_rate < 5%`) before quarterly funnel.

### Repair enrichment cache gaps

After a live CN run, if `funnel-diagnostics.yaml` shows `enrichment.cache_missing_count` above 3% of enriched survivors:

```bash
npx tsx scripts/repair-enrich-cache.ts --quarter 2026-Q1 --market CN
```

Re-runs `enrichCnRecord` for quote-prefilter survivors missing cache files or empty `annualRows`. Then re-run funnel or document residual tickers.

`repair-enrich-cache.ts --inherit-cache-from 2026-Q1` seeds missing target-quarter CN cache entries from a prior quarter before falling back to live datacenter fetches.

To purge polluted `quoteHistory` before a full re-enrich (e.g. after a quote-field mapping fix):

```bash
# Dry-run first
npx tsx scripts/repair-enrich-cache.ts --quarter 2026-Q2 --purge-quote-history --dry-run

# Purge with backup, then force re-enrich all survivors
npx tsx scripts/repair-enrich-cache.ts --quarter 2026-Q2 --purge-quote-history --backup
npx tsx scripts/repair-enrich-cache.ts --quarter 2026-Q2 --force-all --concurrency 4
```

## Tests

```bash
npm test
```

Unit and integration tests cover data adapters, cache, enrichment merge, and funnel. Tests that exercise provider adapters mock `httpFetch`; real-network checks are gated behind `e2e:live` / `e2e:live:full`.

`npm audit --omit=dev --audit-level=high` should stay clean for runtime dependencies. A full `npm audit --audit-level=high` may report dev-only `vitest` / `vite` / `esbuild` advisories; do not apply `npm audit fix --force` during normal screener runs because it can introduce a breaking Vitest upgrade.

## Related

- Skill orchestration: [`../SKILL.md`](../SKILL.md)
- Agent quarterly runbook: [`../docs/agent-guide.md`](../docs/agent-guide.md)
- Spec manifest: [`../spec/index.yaml`](../spec/index.yaml)
