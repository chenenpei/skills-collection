# market-screener CLI

TypeScript `screener` binary (Commander + tsx). Runs the quantitative funnel from `../spec/` and writes `candidates.yaml`, `deferred.yaml`, `excluded.yaml`, and (live only) `prefilter-excluded.yaml` per market.

## Install

```bash
cd skills/market-screener/cli
npm install
```

## Commands

Run from this directory via `npm run dev -- <command>` or `npx tsx bin/screener.ts <command>`.

| Command | Purpose |
|---------|---------|
| `validate <specDir>` | Lint spec YAML (`npm run validate` → `../spec`) |
| `run` | Quantitative funnel |
| `explain <ticker>` | Single-ticker routing trace (fixture only) |
| `landmine` | Landmine YAML from audit-summary |

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

## Live adapter & enrichment (M3)

`--adapter live` runs a two-stage pipeline:

1. **Quote universe** — CN East Money list + US Yahoo quotes (market cap, price, basic fields).
2. **Quote prefilter** — skip status/cap/age failures before HTTP (written to `prefilter-excluded.yaml`).
3. **Enrichment** — per surviving security, fetch annual financials and industry proxy, derive metrics (including `operating_margin`), apply industry median overlays, merge into `SecurityRecord`.

| Market | Enrichment sources |
|--------|-------------------|
| CN | East Money datacenter annual (`RPT_*`) + orginfo industry proxy |
| US | SEC EDGAR `companyfacts` + `submissions` industry proxy (CIK resolved via SEC ticker map) |

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

## E2E scripts

Offline and live end-to-end checks live in `scripts/` and are **not** part of `npm test`.

| Script | Command | What it checks |
|--------|---------|----------------|
| Fixture E2E | `npm run e2e:fixture` | Full CN+US funnel on fixtures; no network |
| Live E2E | `npm run e2e:live` | Real-network live run (default: CN, `2026-Q1`) |
| Live E2E (full) | `npm run e2e:live:full` | CN+US live run with enrichment assertions |

Pass extra args through to the live script:

```bash
npm run e2e:live -- --markets CN,US --quarter 2026-Q2
```

Live E2E asserts enriched candidates (`candidates >= 1`, non-empty `metric_snapshot`), CN universe scale, and no false `kill_revenue_decline_3y_consecutive` on empty YoY. Requires network; on macOS with a system proxy, set `HTTPS_PROXY` (see `scripts/e2e-live.ts`).

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

## Tests

```bash
npm test
```

Unit and integration tests cover adapters, cache, enrichment merge, and funnel engine. Live network tests are gated behind `e2e:live` / `e2e:live:full`.

## Related

- Skill orchestration: [`../SKILL.md`](../SKILL.md)
- Agent quarterly runbook: [`../docs/agent-guide.md`](../docs/agent-guide.md)
- Spec manifest: [`../spec/index.yaml`](../spec/index.yaml)
