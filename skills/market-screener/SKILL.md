---
name: market-screener
description: Orchestrates the quarterly quantitative funnel for A-share and US single-company equities — universe screening, sector routing, candidate YAML output, Deep audit batching via stock-analysis-audit, landmine pricing, and trigger discipline. Use only when the user explicitly invokes market-screener (e.g. @market-screener, /market-screener, or names this skill) and asks for quarterly funnel run, batch screening, landmine setup, or trigger-discipline follow-up. Do not use for single-ticker Lite/Deep analysis without a batch funnel context; use stock-analysis-audit instead.
disable-model-invocation: true
---

# Market Screener

Orchestrate the **batch funnel vs on-demand audit** SOP: quantitative funnel → Deep audit → qualitative triage → landmine prices → trigger discipline. Deterministic funnel rules live in `spec/` and the planned TypeScript CLI; this skill drives the **batch workflow** and chains into **stock-analysis-audit** for single-name Deep work.

All outputs are research assistance only and are not investment advice.

## Invocation

This skill loads **only when explicitly invoked** (`disable-model-invocation: true`). Do not auto-apply from ambient chat about individual stocks or generic valuation questions.

When loaded, confirm the user's intent:

- **Scheduled quarterly run** — full CN+US funnel + Deep batch for a quarter
- **Partial step** — landmine pricing, audit-summary triage, trigger review, or spec explain for one ticker
- **Pre-CLI** — manual orchestration while `screener` CLI is not yet available

## Hard Rules

1. **Never submit trades.** Landmines and alerts are for **human broker execution** only (GTC limits or price alerts).
2. **Never run the quarterly funnel before the later-market disclosure anchor** for the active cycle. Warn if the user requests early runs; note `data_confidence: low` risk.
3. **Default Deep limit:** rank 1–20 per market from `candidates.yaml`. Run `--deep-all` only when the user explicitly requests full Deep on every candidate.
4. **Do not replace stock-analysis-audit** for single-ticker Deep/Lite. Invoke that skill per candidate with funnel context (`audit_hints`, `metric_snapshot`).
5. **Funnel metrics are coarse.** Deep audit may override funnel snapshots; record conflicts in audit reports.
6. **Package M** is the active tightening profile: sector template thresholds + **soft cap 25** candidates per market (overflow → `deferred.yaml`).

## Default Quarterly Run Sequence

Follow `docs/agent-guide.md` unless the user narrows scope.

1. **Schedule check** — read `spec/schedule.yaml`; verify `later_market_gate` for the quarter.
2. **Quantitative funnel** — `screener run --markets CN,US --quarter YYYY-QN --output ./funnel-output/YYYY-QN/`  
   If CLI unavailable: apply `spec/kill-gates.yaml`, `spec/routing-map.yaml`, and `spec/templates/*.yaml` manually; write YAML per `spec/output-schema.yaml`.
3. **Deep audit** — parallel by market (CN session + US session). For each candidate (default top 20/market), load **stock-analysis-audit** Deep with funnel context attached. Reports → `funnel-output/{quarter}/audit/{market}/{ticker}.md`.
4. **Qualitative triage** — produce `audit-summary.yaml`: `shortlist_for_landmine`, `rejected_after_deep`, `deep_deferred`.
5. **Landmines** — `screener landmine --from audit-summary.yaml` (or apply `spec/landmine-rules.yaml` manually) → `landmines.yaml`. Remind user to place orders manually.
6. **Trigger discipline** — on price touch, follow `spec/trigger-discipline.yaml` (scenario A default when ambiguous).

## Required References

Read only what is needed for the current step:

- Always read `CONTEXT.md` and `docs/agent-guide.md`.
- Manifest and integration defaults: `spec/index.yaml`.
- Scheduled run dates: `spec/schedule.yaml`.
- Universe and shared kill gates: `spec/kill-gates.yaml`.
- Sector routing and ambiguous union: `spec/routing-map.yaml`.
- Threshold syntax: `spec/conventions.yaml`.
- Sector funnels (Package M): `spec/templates/*.yaml`.
- Output shapes: `spec/output-schema.yaml`.
- Landmine formulas: `spec/landmine-rules.yaml`.
- Post-landmine behavior: `spec/trigger-discipline.yaml`.

For a single-ticker explain/debug request: `spec/index.yaml`, `spec/routing-map.yaml`, relevant template under `spec/templates/`, and `spec/kill-gates.yaml`.

## Downstream: stock-analysis-audit

For each Deep candidate, attach funnel context in the prompt:

```markdown
对 {ticker}（{market}）执行 Deep 审计。

漏斗上下文（需交叉验证，非最终证据）：
- passed_track: {quality|mispricing}
- routed_templates: [...]
- routing_confidence: {high|ambiguous_union}
- metric_snapshot: ...
- audit_hints: ...

若 metric_snapshot 与 Deep 数据冲突，以 Deep 为准并说明。
```

Load **stock-analysis-audit** for the actual Deep workflow, templates, and verdict slugs. This skill owns batch orchestration and YAML artifacts only.

## CLI Status

MVP CLI (`cli/`, TypeScript) may not exist yet. When commands fail or are missing, orchestrate manually from `spec/` and document which steps were simulated. Do not invent funnel numbers; use available data adapters or mark fields `N/A` with impact notes.

Planned commands (see `spec/index.yaml`):

- `screener run` — funnel
- `screener validate` — spec lint
- `screener explain` — single-ticker routing trace
- `screener landmine` — landmine YAML
- `screener alert` — Phase 2 placeholder (no auto-buy)

## Output Locale

- Match the user's message language for narrative and headings.
- Keep stable slugs from `CONTEXT.md` in structured YAML fields.
- Use standard financial abbreviations (P/E, FCF, ROE, GTC).

## Stop and Ask

Stop instead of continuing when:

- Quarter or market scope is unclear (CN only, US only, or both).
- User requests a quarterly run before the disclosure anchor without accepting low-confidence risk.
- User requests `--deep-all` without acknowledging time/cost.
- Candidate identity is ambiguous (ticker, share class, ADR).
- User asks to auto-place broker orders — refuse and offer landmine YAML + manual steps.

Ask one question at a time. Prefer multiple-choice options when possible.

## Completion Checklist

After a scheduled quarterly run, verify:

- [ ] `candidates.yaml`, `deferred.yaml`, `excluded.yaml` for CN and US
- [ ] Deep reports under `audit/{market}/` (≤20 per market unless `--deep-all`)
- [ ] `audit-summary.yaml`
- [ ] `landmines.yaml` if shortlist exists
- [ ] No trades submitted by the agent
- [ ] Funnel not run before `later_market_gate`
