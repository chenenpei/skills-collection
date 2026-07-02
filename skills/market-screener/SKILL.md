---
name: market-screener
description: Orchestrates the quarterly quantitative funnel for A-share and US single-company equities — universe screening, sector routing, candidate YAML output, Deep audit batching via stock-analysis-audit, landmine pricing, and trigger discipline. Use only when the user explicitly invokes market-screener (e.g. @market-screener, /market-screener, or names this skill) and asks for quarterly funnel run, batch screening, landmine setup, or trigger-discipline follow-up. Do not use for single-ticker Lite/Deep analysis without a batch funnel context; use stock-analysis-audit instead.
disable-model-invocation: true
---

# Market Screener

Orchestrate the **batch funnel → Deep audit → deferred Lite sweep → qualitative triage → landmine prices → trigger discipline** workflow. Deterministic funnel rules live in `spec/`; the TypeScript CLI at `cli/` executes the funnel. This skill drives **batch orchestration** and chains into **stock-analysis-audit** for single-name Deep work.

All outputs are research assistance only and are not investment advice.

## Invocation

This skill loads **only when explicitly invoked** (`disable-model-invocation: true`). Do not auto-apply from ambient chat about individual stocks or generic valuation questions.

When loaded, confirm the user's intent:

- **Scheduled quarterly run** — full CN+US funnel + Deep batch for a quarter
- **Partial step** — landmine pricing, audit-summary triage, trigger review, or spec explain for one ticker

## Hard Rules

1. **Never submit trades.** Landmines and alerts are for **human broker execution** only (GTC limits or price alerts).
2. **Never run the quarterly funnel before the later-market disclosure anchor** for the active cycle. Warn if the user requests early runs; note `data_confidence: low` risk.
3. **Default Deep limit:** rank 1–20 per market from `candidates.yaml`. Run full Deep on every candidate only when the user explicitly requests it.
4. **Default Deferred Lite sweep:** after Deep, run **stock-analysis-audit Lite** on deferred.yaml **rank 1–8** per market (see `spec/conventions.yaml#deferred_lite_sweep`). Reports → `{ticker}.lite.md`. Lite is **not** landmine input unless the user adds Deep same quarter.
5. **Do not replace stock-analysis-audit** for single-ticker Deep/Lite. Invoke that skill per candidate with funnel context (`audit_hints`, `metric_snapshot`).
6. **Funnel metrics are coarse.** Deep audit may override funnel snapshots; record conflicts in audit reports. When `routing_method` is `fallback` or `routing_confidence` is `low`, Deep must flag sector classification uncertainty and honor `audit_hints`.
7. **Sector templates and output caps.** Six sector funnels: `financials`, `tech_saas`, `consumer`, `cyclicals`, `manufacturing`, `healthcare` (`spec/templates/*.yaml`). **Soft cap: 20 candidates per market**; overflow → `deferred.yaml` (watchlist capped at 20). **Ranking uses template track seat allocation** (`winning_template × passed_track` pools with floors/caps/flex in `spec/conventions.yaml#template_seat_allocation`) — not a global supporting-count sort across templates.

## Default Quarterly Run Sequence

Follow `docs/agent-guide.md` unless the user narrows scope.

1. **Schedule check** — read `spec/schedule.yaml`; verify `later_market_gate` for the quarter.
2. **Quantitative funnel** — run the CLI from `cli/` (see **CLI** below). Default adapter is `fixture` (offline); use `--adapter live` when the user wants real universe data and enrichment.
3. **Deep audit** — parallel by market (CN session + US session). For each candidate (default top 20/market), load **stock-analysis-audit** Deep with funnel context attached. Reports → `funnel-output/{quarter}/audit/{market}/{ticker}.md`. **Each quarter: full 20/20 Deep** on current prices; do not carry forward prior-quarter report bodies (see `docs/agent-guide.md` Step 2).
4. **Deferred Lite sweep** — for each market, take `deferred.yaml` rank **1–8** (default). Load **stock-analysis-audit** **Lite** with deferred funnel context. Reports → `funnel-output/{quarter}/audit/{market}/{ticker}.lite.md`. Optional ad-hoc Lite for quarter-diff / user-requested names → `quarter_diff_lite` in audit-summary.
5. **Qualitative triage** — produce `audit-summary.yaml`: `shortlist_for_landmine` (Deep only), `rejected_after_deep`, `deferred_lite_screened`, `deep_deferred`, optional `quarter_diff_lite`.
6. **Landmines** — `npm run dev -- landmine --from audit-summary.yaml --output landmines.yaml` from `cli/` → `landmines.yaml`. Remind user to place orders manually.
7. **Trigger discipline** — on price touch, follow `spec/trigger-discipline.yaml` (scenario A default when ambiguous).

## Required References

Read only what is needed for the current step:

- Always read `CONTEXT.md` and `docs/agent-guide.md`.
- Manifest and integration defaults: `spec/index.yaml`.
- Scheduled run dates: `spec/schedule.yaml`.
- Universe and shared kill gates: `spec/kill-gates.yaml`.
- Sector routing (GICS / keyword fallback): `spec/routing-map.yaml`.
- A-share Shenwan routing (primary CN path): `spec/cn-industry-map.yaml`.
- Threshold syntax and derived metrics: `spec/conventions.yaml`.
- Sector funnel templates: `spec/templates/*.yaml`.
- Output shapes: `spec/output-schema.yaml`.
- Landmine formulas: `spec/landmine-rules.yaml`.
- Post-landmine behavior: `spec/trigger-discipline.yaml`.

For a single-ticker explain/debug request: `spec/index.yaml`, `spec/routing-map.yaml`, `spec/cn-industry-map.yaml` (CN), relevant template under `spec/templates/`, and `spec/kill-gates.yaml`.

## Downstream: stock-analysis-audit

For each Deep candidate, attach funnel context in the prompt:

```markdown
对 {ticker}（{market}）执行 Deep 审计。

漏斗上下文（需交叉验证，非最终证据）：
- passed_track: {quality|mispricing}
- routed_templates: [...]
- routing_method: {gics|cn_industry_map|industry_proxy|fallback}
- routing_confidence: {high|ambiguous_union|low}
- metric_snapshot: ...
- audit_hints: ...

若 routing_method 为 fallback 或 routing_confidence 为 low，Deep 须标注 sector 分类不确定并处理 audit_hints。
若 metric_snapshot 与 Deep 数据冲突，以 Deep 为准并说明。
```

Load **stock-analysis-audit** for the actual Deep workflow, templates, and verdict slugs. This skill owns batch orchestration and YAML artifacts only.

### Deferred Lite prompt (Step 2b)

```markdown
对 {ticker}（{market}）执行 Lite 初筛（非 Deep）。

漏斗上下文（需交叉验证，非最终证据）：
- deferred_rank: {rank}
- seat_source: deferred
- passed_track: {quality|mispricing}
- routed_templates: [...]
- routing_method: {...}
- routing_confidence: {...}
- metric_snapshot: ...
- audit_hints: ...

Lite 目标：判断是否值得下季升格为 Deep 主队列。
若 preliminary_verdict 为 verdict_quality_reasonable_price 或 verdict_medium_term_revaluation 且 confidence ≥ 3，标注 promote_next_quarter。
```

Report path: `audit/{market}/{ticker}.lite.md`. See `docs/agent-guide.md` Step 2b for promote rules and optional `quarter_diff_lite`.

## CLI

The CLI ships at `cli/` (TypeScript, Commander + tsx). **`screener` is not on `$PATH`** — always run from the skill's `cli/` directory:

```bash
cd cli
npm install   # first time only
npm run validate
npm run dev -- run --markets CN,US --quarter YYYY-QN --output ./funnel-output/ --spec ../spec --adapter fixture
npm run dev -- explain 600519 --market CN --spec ../spec --fixture test/fixtures/universe-cn.json
npm run dev -- landmine --from ./funnel-output/YYYY-QN/audit-summary.yaml --output ./funnel-output/YYYY-QN/landmines.yaml --quarter YYYY-QN
```

**Always prefer the CLI** for funnel, explain, validate, filter-breakdown, and landmine steps. Do **not** re-implement funnel logic by calling East Money/Yahoo APIs directly unless the CLI command fails after a genuine install/`npm install` attempt — then report the error and fall back to `spec/` rules with explicit `N/A` fields.

| Command | Purpose |
|---------|---------|
| `run` | Quantitative funnel → `candidates.yaml`, `deferred.yaml`, `excluded.yaml` (+ live `prefilter-excluded.yaml`) |
| `validate` | Lint `spec/` YAML |
| `explain` | Single-ticker routing trace |
| `landmine` | Landmine YAML from audit-summary |
| `filter-breakdown` | Industry-grouped filter statistics from funnel output |
| `bank-indicators` | Debug CN bank disclosure scrape for one ticker/year |
| `alert` | Not implemented — use broker price alerts and `trigger-discipline.yaml` |

### Adapters

| Adapter | Use |
|---------|-----|
| `fixture` (default) | Offline test universes; no network |
| `live` | Real quote universes, quote prefilter, and per-ticker financial enrichment |

### Live adapter

With `--adapter live`, the CLI:

1. Loads CN/US quote universes (East Money / Yahoo screener).
2. Applies **quote prefilter** (status, market cap, listing age). Skips → `prefilter-excluded.yaml`.
3. **Enriches** survivors with annual financials and industry proxy; CN banks also run Sina/cninfo disclosure scrape for regulatory ratios. Responses are cached per quarter under `cli/data/cache/{quarter}/` (empty annual rows are not cached).

**Enrichment sources** (see `spec/index.yaml`):

- **CN:** East Money datacenter (annual, cashflow, balance, orginfo) + quote dividend yield; CN banks add runtime Sina annual-report discovery and disclosure PDF scrape
- **US:** SEC companyfacts + submissions + Yahoo dividend yield

**Derived metrics** include `operating_margin`, `capex_to_revenue`, `inventory_turnover`. Peer medians populate `gross_margin_vs_industry`, `operating_margin_vs_industry`, and `inventory_turnover_vs_industry`.

**Quarterly live run:**

```bash
cd skills/market-screener/cli
npm install
npm run validate
npm run e2e:live -- --markets CN,US --quarter YYYY-QN
```

First CN run may take 30–60 minutes (4000+ enrichment requests). Subsequent runs in the same quarter reuse cache.

**Optional `run` flags:** `--enrich-concurrency <n>` (default **4**; each ticker issues multiple HTTP calls; host limits cap East Money and SEC in-flight requests), `--skip-cache` (force refetch, no cache read/write).

## Output Locale

- Match the user's message language for narrative and headings.
- Keep stable slugs from `CONTEXT.md` in structured YAML fields.
- Use standard financial abbreviations (P/E, FCF, ROE, GTC).

## Stop and Ask

Stop instead of continuing when:

- Quarter or market scope is unclear (CN only, US only, or both).
- User requests a quarterly run before the disclosure anchor without accepting low-confidence risk.
- User requests full Deep on all candidates without acknowledging time/cost.
- Candidate identity is ambiguous (ticker, share class, ADR).
- User asks to auto-place broker orders — refuse and offer landmine YAML + manual steps.

Ask one question at a time. Prefer multiple-choice options when possible.

## Completion Checklist

After a scheduled quarterly run, verify:

- [ ] `candidates.yaml`, `deferred.yaml`, `excluded.yaml` for CN and US
- [ ] Live runs with prefilter skips: `prefilter-excluded.yaml` per market
- [ ] `routing-diagnostics.yaml`, `funnel-diagnostics.yaml` per market (CN `fallback_rate` target < 5%)
- [ ] Deep reports under `audit/{market}/` (≤20 per market unless user requested full Deep)
- [ ] Deferred Lite reports under `audit/{market}/` as `*.lite.md` (≤8 per market unless Step 2b skipped)
- [ ] `audit-summary.yaml` includes `deferred_lite_screened` when Step 2b ran
- [ ] `landmines.yaml` if shortlist exists
- [ ] No trades submitted by the agent
- [ ] Funnel not run before `later_market_gate`
