# market-screener

Quarterly quantitative funnel for A-share and US single-company equities. Feeds candidates into [stock-analysis-audit](../stock-analysis-audit/) Deep audit.

**Status:** Spec + SKILL.md (Package M tightened) — CLI not implemented yet.

## Layout

| Path | Purpose |
|------|---------|
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

## Planned (not yet present)

- `cli/` — TypeScript `screener` CLI

## Related

- [CONTEXT-MAP.md](../../CONTEXT-MAP.md)
