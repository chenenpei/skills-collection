# Market Screener Context

Domain vocabulary for the quarterly quantitative funnel. Thresholds, YAML rules, and SOP live in `spec/`, `docs/agent-guide.md`, and ADRs under `docs/adr/`.

Use each **slug** as the stable structured value. Render labels in the user's language.

---

## Core

**Quantitative Funnel** — Batch code-driven screening that produces structured market output.  
slug: `quantitative_funnel`

**Investable Universe** — Securities the funnel may scan each quarter.  
slug: `investable_universe`

**Universe markets** — A-share main boards + US listed. slug: `universe_markets_cn_us`

**Universe security type** — `security_single_company` only; no ETFs/index funds. slug: `universe_single_company_only`

**Universe exclusions** — ST/delisting/suspended (`universe_exclude_status`); CN cap ≥20亿 & age ≥3y (`universe_exclude_cn_small_young`); US cap ≥$300M & age ≥2y (`universe_exclude_us_small_young`). Financials are **not** universe-excluded; they route to financials template.

---

## Routing

**Sector Routing** — Assign template(s) after shared exclusions. US: GICS L2/3 via `spec/routing-us.yaml`; CN: Shenwan via `spec/routing-cn.yaml` after enrich. slug: `sector_routing`

**CN Industry Map Routing** — Primary CN path from `industry_proxy` (L1-L2-L3). slug: `cn_industry_map_routing`

**Routing Method** — `gics` | `cn_industry_map` | `industry_proxy` | `fallback`. slug: `routing_method`

**Routing Too Hard** — No reliable classifier (`fallback`): skip sector scoring and record exit reason. slug: `routing_too_hard` · _Avoid_: manufacturing default scoring

**Sector Quant Too Hard** — Routed template declared `quant_too_hard` or all routed templates skipped for missing live data. slug: `sector_quant_too_hard`

**Template Live Viability** — Declared per template/sub-template: `full` | `proxy` | `quant_too_hard`. Policy in `spec/metric-policy.yaml`; not inferred from pass rate alone. slug: `template_live_viability`

**Routing Operational Target** — `fallback_rate` < 5%; extend CN map from diagnostics. slug: `routing_operational_target`

**Routing Confidence** — `high` single template vs `ambiguous_union` parallel evaluation. slug: `routing_confidence`

**Ambiguous Union** — Evaluate two declared templates; pass if either track passes. Not for unmapped fallback. slug: `ambiguous_union`

**US Routing Map** — GICS/keyword -> template mapping in `spec/routing-us.yaml`. slug: `sector_routing_map`

**Industry Routing Proxy** — Free-provider industry label when GICS unavailable. slug: `industry_routing_proxy`

---

## Funnel architecture

**Fixed Sector Template Taxonomy** — Six templates: `financials`, `tech_saas`, `consumer`, `cyclicals`, `manufacturing`, `healthcare`. slug: `fixed_sector_template_taxonomy`

**Sector Sub-Template** — Alternate tracks inside one YAML, such as `financials.banks` and `financials.other_financials`. slug: `sector_sub_template`

**Funnel Track** — `quality` and/or `mispricing` per template. slug: `funnel_track`

**Sector Dual-Gate Screening** — All required pass, then supporting `min_N_of_M`; dead metrics not in YAML. slug: `sector_dual_gate_screening`

**Shared Exclusion Rule** — Cross-sector exclusions before sector templates; prefer false positives over false rejects. slug: `shared_kill_gate`

**Market Cap Profile B** — CN ≥20亿 CNY; US ≥$300M. slug: `market_cap_profile_b`

**Peak Cycle Trap** — Cyclical mispricing false cheapness at earnings peak. slug: `peak_cycle_trap`

**Kill Reason** / **Excluded Output** — Pre-sector exclusion slug and YAML artifact. slugs: `kill_reason`, `excluded_output`

**Live Template Metric Policy** — Remove permanent gaps from YAML (`deep_only`); temporary gaps use `missing: skip`. slug: `live_template_metric_policy`

**Deep-Only Metric** — Metric kept out of live funnel gates because current data coverage is insufficient. slug: `deep_only_metric`

**Supporting Pass Downgrade** — When skips reduce evaluable supporting count, pass if all evaluable supporting pass. slug: `supporting_pass_downgrade`

**Enrichment Scope Tier** — Low / medium / high implementation cost (ADR 0002). slug: `enrichment_scope_tier`

**Metric Coverage** — Post-enrich required-metric presence per template in diagnostics (ADR 0006). slug: `metric_coverage`

---

## Sector notes (routing + philosophy)

| Template | Routing notes |
|----------|----------------|
| `healthcare` | Pharma/biotech/CXO; devices → manufacturing (`medical_device_funnel_placement`); TCM/pharmacy retail → consumer |
| `manufacturing` | ROIC/FCF/capex; mispricing requires `roic_ttm` (`manufacturing_mispricing_roic_floor`, ADR 0006) |
| `consumer` | Brand/margin/dividend supporting optional |
| `cyclicals` | Mid-cycle normalization (7y window) |
| `tech_saas` | Proxy viability; CN SBC/dilution supporting skipped (`tech-saas.yaml`) |
| `financials` | CN 银行 → `financials.banks` with disclosure scrape enrich (ADR 0008); `banks` @ proxy viability; `insurance` quant_too_hard |

Slugs: `cn_bank_routing_proxy`, `cn_tech_saas_quality_skip`, `bank_regulatory_enrich_priority`, `healthcare_quality_dual_path`, `mid_cycle_normalization`, `market_override`, `unified_threshold`, `market_override_policy`.

---

## Output & CLI

**Funnel Output** / **Candidate Record** / **Metric Snapshot** / **Audit Hint** — YAML outputs and pass evidence for optional downstream review. slugs: `funnel_output`, `candidate_record`, `metric_snapshot`, `audit_hint`

**Screener CLI** — TypeScript batch runner; no LLM. slug: `screener_cli`

**Screener Skill** — Explicitly invoked batch screening skill. slug: `screener_skill`

**Data Adapter** / **Funnel Data Tier** — Provider plug-in and coarse screening data layer. slugs: `data_adapter`, `funnel_data_tier`

**Funnel Data Provider** — SEC, Yahoo, East Money implementations. slug: `funnel_data_provider` · US: `funnel_provider_us` · CN: `funnel_provider_cn`

**Data Confidence** — `high` | `medium` | `low` per metric. slug: `data_confidence`

**Market Scope** — `CN` | `US` | both per run. slug: `market_scope`

**Dividend Yield Row Policy** — Prefer latest implemented dividend row. slug: `dividend_yield_row_policy`

**Enrichment Cache Repair** — Targeted cache backfill when diagnostics report gaps. slug: `enrichment_cache_repair`

**Capex to Revenue Ratio** — Multi-year average; ≥2y medium / ≥3y high confidence. slug: `capex_to_revenue_ratio`

---

## Seat allocation & ranking

**Funnel Soft Cap** — Max candidates per market (20). Overflow → deferred. slug: `funnel_soft_cap`

**Template Seat Allocation** — Pools by winning template × passed track; floors, caps, flex. slug: `template_seat_allocation`

**Seat Floor** / **Seat Cap** / **Flex Seat Pool** — Pool quotas. slugs: `seat_floor`, `seat_cap`, `flex_seat_pool`

**Template Track Seat Pool** — e.g. `consumer_quality`; quality and mispricing never share seats. slug: `template_track_seat_pool`

**Track Confluence** — Same template passes both tracks; priority tier + double flex weight; one seat. slug: `track_confluence`

**Winning Template** — Template whose track granted the pass. slug: `winning_template`

**Vacant Seat Backfill** — Same-template quality → global quality. slug: `vacant_seat_backfill`

**Funnel Ranking Role** / **Candidate Rank** — Deep queue order within pools, not global best stock. slugs: `funnel_ranking_role`, `candidate_rank`

**Pool Tie-Break** — One north-star metric per pool (`:desc`/`:asc`); ticker last. Map in `spec/selection-policy.yaml`. slug: `pool_tie_break`

**Deferred Candidate** / **Deferred Watchlist Cap** — Passed but no seat; max 20 in deferred.yaml. slugs: `deferred_candidate`, `deferred_watchlist_cap`

---

## Optional downstream

**Audit Summary** / **Landmine Price** / **Landmine Rules** — Optional downstream summary and price observation calculations. slugs: `audit_summary`, `landmine_price`, `landmine_rules`

**Run Context** — User-supplied or automation-supplied quarter, market scope, adapter, and output path for a batch funnel run. slug: `run_context`

---

## Future planning

未实现能力和后续规划集中记录在 `docs/future-work.md`；本词汇表只保留当前运行和审计会用到的术语。

---

## Value alignment (brief)

**Quality Track Philosophy** — Wonderful business at fair price. slug: `funnel_track_quality_philosophy`

**Mispricing Track Philosophy** — Good business at bargain price; not cigar-butt without quality floor. slug: `funnel_track_mispricing_philosophy`
