# market-screener

Quarterly quantitative funnel for A-share and US single-company equities. Feeds candidates into [stock-analysis-audit](../stock-analysis-audit/) Deep audit.

**Status:** Spec + SKILL.md (Package M tightened) — CLI **M3 live enrichment** done (`cli_m3_live_funnel_done`).

## Layout

| Path | Purpose |
|------|---------|
| [SKILL.md](./SKILL.md) | Agent orchestration entry (manual invocation only) |
| [cli/](./cli/) | TypeScript `screener` CLI (validate, run, explain, landmine, filter-breakdown) |
| [docs/agent-guide.md](./docs/agent-guide.md) | Quarterly runbook for agents (schedule, Deep, landmine, triggers) |
| [CONTEXT.md](./CONTEXT.md) | Domain vocabulary (glossary only) |
| [spec/index.yaml](./spec/index.yaml) | Manifest, data sources, template list |
| [spec/kill-gates.yaml](./spec/kill-gates.yaml) | Shared kill gates before sector funnels |
| [spec/routing-map.yaml](./spec/routing-map.yaml) | GICS / industry proxy → sector templates |
| [spec/cn-industry-map.yaml](./spec/cn-industry-map.yaml) | A-share Shenwan L1/L2 → sector templates (primary CN routing) |
| [spec/output-schema.yaml](./spec/output-schema.yaml) | `candidates.yaml` / `excluded.yaml` / diagnostics contract |
| [spec/conventions.yaml](./spec/conventions.yaml) | Threshold and pass-logic syntax |
| [spec/landmine-rules.yaml](./spec/landmine-rules.yaml) | Landmine price formulas (Phase 2) |
| [spec/trigger-discipline.yaml](./spec/trigger-discipline.yaml) | Scenario A/B trigger rules (alert CLI Phase 2) |
| [spec/schedule.yaml](./spec/schedule.yaml) | Scheduled quarterly run dates — CN+US same day after later disclosure |
| [spec/templates/](./spec/templates/) | Sector funnel rules (6 templates) |

## CLI

Path: [`cli/`](./cli/). TypeScript package with `screener` binary (Commander + tsx).

### Install

```bash
cd skills/market-screener/cli
npm install
```

### Test

```bash
npm test
```

### Commands

All commands run from `skills/market-screener/cli` via `npm run dev -- <command>` or `npx tsx bin/screener.ts <command>`.

**Validate spec**

```bash
npm run validate
# or: npx tsx bin/screener.ts validate ../spec
```

**Run funnel** (`--adapter fixture` offline by default; `--adapter live` for CN East Money + US Yahoo)

```bash
# Offline (default)
npx tsx bin/screener.ts run \
  --markets CN,US \
  --quarter 2026-Q2 \
  --output /tmp/screener-out \
  --spec ../spec \
  --adapter fixture

# Live universe (requires network)
npx tsx bin/screener.ts run \
  --markets CN,US \
  --quarter 2026-Q2 \
  --output /tmp/screener-out-live \
  --spec ../spec \
  --adapter live
```

Writes `{output}/{quarter}/{CN|US}/candidates.yaml`, `deferred.yaml`, `excluded.yaml`, `routing-diagnostics.yaml`, `funnel-diagnostics.yaml`, and (live, when non-empty) `prefilter-excluded.yaml`.

**CN routing:** enriched A-share names route via `spec/cn-industry-map.yaml` (`routing_method: cn_industry_map`). Verify coverage before quarterly funnel: `npx tsx scripts/routing-report.ts --quarter YYYY-Qn --market CN --spec ../spec` (target `fallback_rate` < 5%).

**Live-only flags:** `--enrich-concurrency` (default 4), `--skip-cache`.

**Explain one security** (routing + kill gates + template evaluation)

```bash
npx tsx bin/screener.ts explain 600519 \
  --market CN \
  --fixture test/fixtures/universe-cn.json \
  --spec ../spec
```

**Landmine prices** from Deep audit shortlist

```bash
npx tsx bin/screener.ts landmine \
  --from test/fixtures/audit-summary.yaml \
  --output /tmp/landmines.yaml \
  --quarter 2026-Q2
```

**Filter breakdown** from funnel output

```bash
npm run dev -- filter-breakdown \
  --output /tmp/screener-out \
  --quarter 2026-Q2 \
  --markets CN
```

Writes `/tmp/screener-out/2026-Q2/CN/filter-breakdown.md` by default.

`--spec` defaults to `../spec` when omitted. Phase 2 placeholder: `screener alert` (not implemented).

## Related

- [CONTEXT-MAP.md](../../CONTEXT-MAP.md)
