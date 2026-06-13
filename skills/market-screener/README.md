# market-screener

Quarterly quantitative funnel for A-share and US single-company equities. Feeds candidates into [stock-analysis-audit](../stock-analysis-audit/) Deep audit.

**Status:** Spec + SKILL.md (Package M tightened) — CLI M1/M2 done (`cli_m1_m2_done`).

## Layout

| Path | Purpose |
|------|---------|
| [cli/](./cli/) | TypeScript `screener` CLI (validate, run, explain, landmine) |
| [docs/agent-guide.md](./docs/agent-guide.md) | Quarterly runbook for agents (schedule, Deep, landmine, triggers) |
| [CONTEXT.md](./CONTEXT.md) | Domain vocabulary (glossary only) |
| [spec/index.yaml](./spec/index.yaml) | Manifest, data sources, template list |
| [spec/kill-gates.yaml](./spec/kill-gates.yaml) | Shared kill gates before sector funnels |
| [spec/routing-map.yaml](./spec/routing-map.yaml) | GICS / industry proxy → sector templates |
| [spec/output-schema.yaml](./spec/output-schema.yaml) | `candidates.yaml` / `excluded.yaml` contract |
| [spec/conventions.yaml](./spec/conventions.yaml) | Threshold and pass-logic syntax |
| [spec/landmine-rules.yaml](./spec/landmine-rules.yaml) | Landmine price formulas (Phase 2) |
| [spec/trigger-discipline.yaml](./spec/trigger-discipline.yaml) | Scenario A/B trigger rules (alert CLI Phase 2) |
| [spec/schedule.yaml](./spec/schedule.yaml) | Scheduled quarterly run dates — CN+US same day after later disclosure |
| [spec/templates/](./spec/templates/) | Sector funnel rules (6 templates) |

| [SKILL.md](./SKILL.md) | Agent orchestration entry (manual invocation only) |

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

Writes `{output}/{quarter}/{CN|US}/candidates.yaml`, `deferred.yaml`, and `excluded.yaml`.

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

`--spec` defaults to `../spec` when omitted. Phase 2 placeholder: `screener alert` (not implemented).

## Related

- [CONTEXT-MAP.md](../../CONTEXT-MAP.md)
