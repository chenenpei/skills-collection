---
name: market-screener
description: Runs the quantitative market screener for A-share and US single-company equities. Use only when the user explicitly invokes market-screener and asks for a batch funnel run, batch screening, output review, single-ticker explain request, filter breakdown, bank indicator debug, or landmine price calculation. Do not use for single-ticker qualitative stock analysis; stock-analysis-audit is an optional downstream skill.
disable-model-invocation: true
---

# Market Screener

Run the **quantitative market funnel** for A-share and US single-company equities. Deterministic rules live in `spec/`; the TypeScript CLI at `cli/` executes screening, routing, ranking, diagnostics, explain, filter breakdown, bank indicator debug, and landmine price calculation. This skill is complete when it produces and reviews the requested CLI outputs.

All outputs are research assistance only and are not investment advice.

## Invocation

This skill loads **only when explicitly invoked** (`disable-model-invocation: true`). Do not auto-apply from ambient chat about individual stocks or generic valuation questions.

When loaded, confirm the user's intent:

- **Batch funnel run** — CN, US, or CN+US quantitative screening for a user-specified quarter
- **Partial CLI step** — output review, spec validation, filter breakdown, bank indicator debug, landmine price calculation, or explain for one ticker
- **Optional downstream handoff** — if the user asks for qualitative single-name review, pass selected `candidates.yaml` records to the appropriate downstream skill

## Hard Rules

1. **Require explicit run inputs.** Before running the CLI, confirm quarter, market scope, adapter, output path, and spec path.
2. **Use the CLI for funnel logic.** Do not reimplement East Money, Yahoo, SEC, routing, ranking, or template evaluation logic outside `cli/`.
3. **Keep downstream work optional.** `stock-analysis-audit` can consume candidates, deferred records, `metric_snapshot`, and `audit_hints`, but it is not required for `market-screener` completion.
4. **Preserve output semantics.** `candidates.yaml` is the selected queue, `deferred.yaml` is the overflow watchlist, `excluded.yaml` is pre-template exclusion output, and diagnostics explain routing and funnel behavior.
5. **Respect routing uncertainty.** When `routing_method` is `fallback` or `routing_confidence` is `low`, report the uncertainty from CLI output instead of inventing a sector classification.

## Default Run Sequence

1. **Run inputs** — confirm quarter, market scope, adapter, output path, and `--spec ../spec`.
2. **Validate spec** — run `npm run validate` from `cli/`.
3. **Run funnel** — run `npm run dev -- run ...` from `cli/`.
4. **Review outputs** — inspect `candidates.yaml`, `deferred.yaml`, `excluded.yaml`, `routing-diagnostics.yaml`, and `funnel-diagnostics.yaml`.
5. **Optional CLI follow-up** — run `explain`, `filter-breakdown`, `bank-indicators`, or `landmine` only when the user asks for that output.
6. **Result summary** — summarize CLI outputs using `docs/agent-output.md`.

## Required References

Read only what is needed for the current step:

- Always read `CONTEXT.md` and `docs/agent-guide.md`.
- Result summary style: `docs/agent-output.md`.
- Spec manifest: `spec/index.yaml`.
- Exclusions: `spec/exclusion-rules.yaml`.
- Routing: `spec/routing-cn.yaml` and `spec/routing-us.yaml`.
- Metric policy: `spec/metric-policy.yaml`.
- Selection policy: `spec/selection-policy.yaml`.
- Sector funnel templates: `spec/templates/*.yaml`.
- Price calculation formulas: `spec/landmine-pricing.yaml`.

For a single-ticker explain/debug request: `spec/index.yaml`, `spec/routing-cn.yaml` or `spec/routing-us.yaml`, relevant template under `spec/templates/`, and `spec/exclusion-rules.yaml`.

## Optional Downstream: stock-analysis-audit

If the user asks for qualitative single-name review after screening, attach funnel context to the downstream prompt:

```markdown
对 {ticker}（{market}）执行单票审计。

漏斗上下文（需交叉验证，非最终证据）：
- passed_track: {quality|mispricing}
- routed_templates: [...]
- routing_method: {gics|cn_industry_map|industry_proxy|fallback}
- routing_confidence: {high|ambiguous_union|low}
- metric_snapshot: ...
- audit_hints: ...

若 metric_snapshot 与审计数据冲突，以审计数据为准并说明。
```

The downstream skill owns its own workflow and verdict schema. `market-screener` owns batch screening and CLI outputs.

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

**Always prefer the CLI** for funnel, explain, validate, filter-breakdown, bank-indicators, and landmine steps. Do not reimplement provider calls or funnel logic outside `cli/`.

| Command | Purpose |
|---------|---------|
| `run` | Quantitative funnel -> `candidates.yaml`, `deferred.yaml`, `excluded.yaml` (+ online `prefilter-excluded.yaml`) |
| `validate` | Lint `spec/` YAML |
| `explain` | Single-ticker routing trace |
| `landmine` | Price observation YAML from audit-summary |
| `filter-breakdown` | Industry-grouped filter statistics from funnel output |
| `bank-indicators` | Debug CN bank disclosure scrape for one ticker/year |

### Adapters

| Adapter | Use |
|---------|-----|
| `fixture` (default) | Offline test data; no network |
| `live` | Online market samples, quote prefilter, and per-ticker financial enrichment |

### Live Adapter

With `--adapter live`, the CLI:

1. Loads CN/US market samples from provider adapters.
2. Applies quote prefilter by status, market cap, and listing age. Skips are written to `prefilter-excluded.yaml`.
3. Enriches survivors with annual financials and industry proxy; CN banks also run disclosure scrape for regulatory ratios. Responses are cached per quarter under `cli/data/cache/{quarter}/` (empty annual rows are not cached).

**Enrichment sources** (see `spec/index.yaml`):

- **CN:** East Money datacenter (annual, cashflow, balance, orginfo) + quote dividend yield; CN banks add runtime annual-report discovery and disclosure PDF scrape
- **US:** SEC companyfacts + submissions + Yahoo dividend yield

**Derived metrics** include `operating_margin`, `capex_to_revenue`, and `inventory_turnover`. Peer medians populate `gross_margin_vs_industry`, `operating_margin_vs_industry`, and `inventory_turnover_vs_industry`.

**Optional `run` flags:** `--enrich-concurrency <n>` (default **4**), `--skip-cache`, `--skip-preflight`, `--allow-degraded`, and `--inherit-cache-from <quarter>`.

## Output Locale

- Match the user's message language for narrative and headings.
- Keep stable slugs from `CONTEXT.md` in structured YAML fields.
- Use standard financial abbreviations (P/E, FCF, ROE).

## Stop and Ask

Stop instead of continuing when:

- Quarter or market scope is unclear (CN only, US only, or both).
- Adapter or output path is unclear.
- Candidate identity is ambiguous (ticker, share class, ADR).

Ask one question at a time. Prefer multiple-choice options when possible.

## Completion Checklist

After a batch run, verify:

- [ ] `candidates.yaml`, `deferred.yaml`, `excluded.yaml` for requested markets
- [ ] Online runs with prefilter skips: `prefilter-excluded.yaml`
- [ ] `routing-diagnostics.yaml`, `funnel-diagnostics.yaml`
- [ ] Quarter, market scope, adapter, output path, and spec path are recorded
- [ ] Requested follow-up command output exists, if user asked for one
