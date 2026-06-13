# Market Screener Context

Vocabulary for the quarterly quantitative funnel system. Process rules, funnel thresholds, data contracts, and execution schedules live outside this file.

## Language

Use the slug as the stable structured value. Render labels in the user's requested language.

## Core Concepts

**Quantitative Funnel**:
A batch, code-driven screening pipeline that scans the full investable universe and ranks or filters securities by measurable rules before any Deep audit.
slug: quantitative_funnel
_Avoid_: Lite screening (that term belongs to stock-analysis-audit single-security mode)

**Investable Universe**:
The set of securities the quantitative funnel is allowed to scan each quarter.
slug: investable_universe
_Avoid_: full market, all stocks

## Investable Universe Rules

**Universe markets**:
A-share main boards and US listed equities.
slug: universe_markets_cn_us

**Universe security type**:
Only `security_single_company`. ETFs, index funds, and other pooled vehicles are excluded; they belong to the index-shield allocation layer, not the funnel.
slug: universe_single_company_only

**Universe exclusions — status**:
Securities that are ST, delisting, or suspended are excluded.
slug: universe_exclude_status

**Universe exclusions — A-share size and age**:
A-share names below 2 billion CNY market cap (20亿) or listed less than 3 years are excluded.
slug: universe_exclude_cn_small_young

**Universe exclusions — US size and age**:
US names below 300 million USD market cap or listed less than 2 years are excluded.
slug: universe_exclude_us_small_young

**Universe exclusions — financial leverage (optional)**:
Deprecated. Financial companies are not excluded from the investable universe; they route to a dedicated financial sector funnel template instead.
slug: universe_exclude_financials_optional
_Avoid_: excluding banks or insurers from the universe

**Sector Routing**:
The step that assigns each security in the investable universe to one or more sector funnel templates before sector-specific scoring. US names use GICS Level 2/3 as the primary classifier; A-share names use East Money Shenwan hierarchy via `spec/cn-industry-map.yaml` after enrichment (`routing_method: cn_industry_map`).
slug: sector_routing
_Avoid_: running all sector templates on every security, GICS Level 1 only

**CN Industry Map Routing**:
Primary A-share sector routing path: map `industry_proxy` (L1-L2-L3, `-` separator) through `spec/cn-industry-map.yaml` (`l1_defaults`, `l2_overrides`, legacy aliases). Emits `routing_method: cn_industry_map` when matched.
slug: cn_industry_map_routing
_Avoid_: keyword-only proxy routing for CN when the Shenwan L1 is known

**Routing Method**:
Which classifier assigned sector templates: `gics`, `cn_industry_map`, `industry_proxy`, or `fallback`. Stored on candidate records and in routing diagnostics.
slug: routing_method

**Routing Fallback**:
When no GICS, CN map, or keyword proxy matches, route to `fallback_template` (default manufacturing) with `routing_confidence: low`. Deep audit must treat sector classification as uncertain; pass through `audit_hints` (e.g. `routing_fallback_unmapped_industry`).
slug: routing_fallback

**Routing Confidence**:
Whether a security's GICS class maps cleanly to a single sector funnel template, or falls into an ambiguous class that requires parallel evaluation.
slug: routing_confidence
_Avoid_: assuming all GICS codes are unambiguous

**Ambiguous Union**:
When routing confidence is low, run the security through two relevant sector funnel templates in parallel; keep it if either template passes a track. Used only for known ambiguous GICS mappings, not for the full universe.
slug: ambiguous_union
_Avoid_: union across all templates, OR-merge without deduplication

**Sector Routing Map**:
The maintained mapping from GICS Level 2/3 codes to sector funnel templates, including which codes trigger ambiguous union and which secondary template to add.
slug: sector_routing_map
_Avoid_: ad hoc per-stock routing

**All-Sector Coverage Target**:
The quantitative funnel aims to support every sector block defined in stock-analysis-audit `spec/data.md`, not a partial MVP subset.
slug: all_sector_coverage_target
_Avoid_: MVP-only sector scope

## Funnel Architecture

**Sector Funnel Template**:
A sector-specific quantitative rule set that applies only after universe filtering and sector routing. Metrics and thresholds must align with the matching sector block in stock-analysis-audit `spec/data.md` and sector exceptions in `spec/classification.md`. Financial companies use a dedicated template; they are not excluded from the universe.
slug: sector_funnel_template
_Avoid_: one global funnel, business paradigm funnel (too coarse without sector routing)

**Funnel Track**:
An optional sub-path inside a sector funnel template, such as a quality track or a mispricing track. Not every sector supports every track.
slug: funnel_track
_Avoid_: assuming exactly two global funnels

**Shared Kill Gate**:
A cross-sector exclusion rule applied before sector-specific scoring, such as status exclusions, deteriorating revenue/margin/cash-flow pre-filters, or extreme leverage.
slug: shared_kill_gate
_Avoid_: sector-specific veto, final verdict

## Output Contract

**Funnel Output**:
The structured YAML artifact produced by a quantitative funnel run, including run metadata and a ranked candidate list for downstream Deep audit.
slug: funnel_output
_Avoid_: markdown-only output, unstructured candidate list

**Candidate Record**:
One security that passed at least one sector funnel track, including ticker, market, routing metadata, passed track, metric snapshot, and optional audit hints.
slug: candidate_record
_Avoid_: ticker-only list

**Metric Snapshot**:
The sector-specific metrics and values that caused the candidate to pass its funnel track at run time. Preserved so Deep audit does not need to re-derive funnel evidence from scratch.
slug: metric_snapshot
_Avoid_: recomputing funnel metrics during audit

**Audit Hint**:
Optional downstream context for the Deep audit step, such as ambiguous union routing or sector-classification verification. Passed through by the orchestrating agent; not part of stock-analysis-audit core schema.
slug: audit_hint
_Avoid_: changing stock-analysis-audit skill schema for funnel integration

## Delivery

**Screener CLI**:
The TypeScript command-line tool that executes universe build, sector routing, funnel scoring, and YAML output. Deterministic and rerunnable without an LLM.
slug: screener_cli
_Avoid_: agent-only screening, Python-only runtime

**Screener Skill**:
The Agent Skill that documents the quarterly SOP, invokes the CLI, reads funnel output, and chains candidates into stock-analysis-audit Deep audit.
slug: screener_skill
_Avoid_: putting batch screening logic only inside SKILL.md

**Data Adapter**:
A pluggable provider that fetches market, financial, and GICS data for one market or vendor. Funnel code depends on adapter interfaces, not on a single vendor SDK.
slug: data_adapter
_Avoid_: hardcoding one paid API throughout the CLI

**Funnel Data Tier**:
The minimum data quality required for coarse quantitative screening. May use free or lightweight providers and can be cross-checked later during Deep audit.
slug: funnel_data_tier
_Avoid_: assuming funnel data must match audit data quality

**Audit Data Tier**:
The higher-evidence data gathered during stock-analysis-audit Deep, which may use filings, better providers, or agent tool search to verify or override funnel snapshots.
slug: audit_data_tier
_Avoid_: treating funnel metric snapshots as final audit evidence

## Data Sources (MVP)

**Funnel Data Provider**:
A concrete data adapter implementation for one market and vendor, such as SEC EDGAR, Yahoo Finance, or East Money.
slug: funnel_data_provider

**US Funnel Providers**:
SEC EDGAR bulk or API for financials; Yahoo Finance for quotes, market cap, and industry routing proxy.
slug: funnel_provider_us

**CN Funnel Providers**:
East Money public HTTP APIs for A-share quotes, financials, and industry classification.
slug: funnel_provider_cn

**Industry Routing Proxy**:
A non-GICS industry label from a free provider, mapped to sector funnel templates through `sector-routing-map`.
slug: industry_routing_proxy
_Avoid_: assuming free true GICS coverage

**Data Confidence**:
Per-metric or per-record confidence in funnel output: high, medium, or low. Low-confidence fields should be re-checked during Deep audit.
slug: data_confidence
_Avoid_: treating all funnel metrics as equally reliable

**Market Scope**:
Which markets a single funnel run scans: CN only, US only, or both. Each run produces its own funnel output artifact.
slug: market_scope
_Avoid_: always scanning both markets in one run

## Kill Gates

**Shared Kill Gate**:
Cross-sector exclusion rules applied before sector funnel templates. Default principle: prefer false positives over false rejects at this stage.
slug: shared_kill_gate

**Kill Reason**:
The slug explaining why a security was excluded before sector scoring, recorded in excluded output for quarterly review.
slug: kill_reason

**Excluded Output**:
The YAML artifact listing securities removed by shared kill gates, with reasons and metric snapshots for false-reject review.
slug: excluded_output

**Market Cap Profile B**:
Broad market-cap floor for growth coverage: A-share at least 2 billion CNY (20亿); US at least 300 million USD. Targets roughly CSI 500 and most CSI 1000 names.
slug: market_cap_profile_b
_Avoid_: 50 billion CNY floor, large-cap-only universe

**Financials Sub-Template**:
A sector funnel branch for banks, insurance, or other financial companies. Banks and insurance use different metric sets; other financials use a broader ROE and P/B template in MVP.
slug: financials_sub_template
_Avoid_: applying industrial FCF rules to financials

## Value Investing Alignment

**Quality Track Philosophy**:
Quantitative proxy for "wonderful business at a fair price" — durable profitability, conservative financing, and sector-appropriate capital returns. Aligns with Buffett/Munger compounder logic and Li Lu's emphasis on sustainable earnings quality.
slug: funnel_track_quality_philosophy
_Avoid_: low price alone

**Mispricing Track Philosophy**:
Quantitative proxy for "good business at a bargain price" — market pessimism or valuation discount without deteriorating core economics. Aligns with Graham margin-of-safety screens and Li Lu's emphasis on distinguishing cyclical peaks from sustainable cheapness.
slug: funnel_track_mispricing_philosophy
_Avoid_: cigar-butt-only cheapness without quality floor

**Market Override**:
A per-market adjustment to an otherwise shared funnel threshold when local market norms differ, such as bank ROA in CN versus US.
slug: market_override
_Avoid_: one global threshold for all listing markets

**Unified Threshold**:
A funnel metric threshold that uses the same value for CN and US because the definition and economic meaning are comparable across markets.
slug: unified_threshold
_Avoid_: splitting every metric by market without cause

**Market Override Policy**:
Default to unified thresholds; add market-specific overrides only when definition differs, data fields differ, or local industry norms materially differ. MVP required overrides: market cap, listing age, bank ROA, insurance solvency versus RBC, and later Tech SBC ratio.
slug: market_override_policy
_Avoid_: overriding every metric by market without evidence

**Tech SaaS Template**:
Sector funnel for software and technology companies. AI-application names may route here in MVP with an audit flag rather than a separate template.
slug: tech_saas_template

**Consumer Template**:
Sector funnel for consumer discretionary and consumer staples companies, aligned with brand, repeat purchase, margin stability, and channel inventory checks in stock-analysis-audit data rules.
slug: consumer_template

**Cyclicals Template**:
Sector funnel for materials, energy, industrials, and other cycle-driven companies. Uses mid-cycle normalized earnings for valuation metrics, not peak or trough snapshots.
slug: cyclicals_template

**Mid-Cycle Normalization**:
Average financial metric over a multi-year window (MVP: 7 years) used instead of peak or trough earnings for cyclical valuation.
slug: mid_cycle_normalization

**Peak Cycle Trap**:
A cyclical false-value signal where trailing multiples look cheap because earnings are at a cycle peak. Excluded by cyclicals kill gates before mispricing scoring.
slug: peak_cycle_trap

**Manufacturing Template**:
Sector funnel for manufacturing, hardware, semiconductors, and industrial producers, aligned with capex intensity, inventory turnover, capacity utilization, and customer concentration checks.
slug: manufacturing_template

**Semiconductor Capex Override**:
Manufacturing quality-track capex-to-revenue supporting threshold uses 25% for semiconductor GICS codes instead of the default 15%.
slug: semiconductor_capex_override

**Funnel Soft Cap**:
Maximum number of ranked candidates written to primary funnel output per market per run. Overflow passes are written to deferred output, not deleted.
slug: funnel_soft_cap

**Deferred Candidate**:
A security that passed sector funnel tracks but ranked below the funnel soft cap for its market in that run.
slug: deferred_candidate
_Avoid_: treating deferred as excluded or kill-gated

**Deep Audit Limit**:
Maximum number of candidates per market sent to stock-analysis-audit Deep in one scheduled quarterly run. Default is 20 per market unless the user explicitly requests --deep-all.
slug: deep_audit_limit

**Deep All**:
Explicit orchestrator mode that Deep-audits every candidate in candidates.yaml, ignoring the default Deep limit. Requires user request.
slug: deep_all
_Avoid_: deep_all as default behavior

**Parallel By Market**:
Deep audit execution pattern that runs CN and US candidate batches in separate concurrent agent sessions.
slug: deep_execution_parallel_by_market

**Audit Summary**:
Post-Deep YAML artifact listing shortlist_for_landmine, rejected_after_deep, and deep_deferred candidates after qualitative triage.
slug: audit_summary

**Landmine Price**:
A GTC limit or alert price computed from fair-value rules; intended for manual broker orders only, never automated execution.
slug: landmine_price

**Landmine Rules**:
Deterministic formulas in spec/landmine-rules.yaml used by screener landmine to produce landmines.yaml from audit-summary shortlist.
slug: landmine_rules

**Human Broker Execution**:
The user manually places GTC limit orders or price alerts; the screener CLI never submits trades.
slug: human_broker_execution

**Trigger Isolated Drop**:
Phase 3 scenario A — stock hit landmine on idiosyncratic decline; do not buy immediately; require 24h qualitative review.
slug: trigger_isolated_drop

**Trigger Macro Panic**:
Phase 3 scenario B — broad market panic dragged stock to landmine; may deploy 40-50% first tranche after 24h confirmation.
slug: trigger_macro_panic

**Trigger Discipline**:
Rules in spec/trigger-discipline.yaml for scenario A/B detection heuristics and agent actions after landmine price is touched.
slug: trigger_discipline

**Screener Alert**:
Phase 2 placeholder CLI command that compares live prices to landmines.yaml and writes alerts.yaml; not in MVP.
slug: screener_alert
_Avoid_: automated_buy_on_alert

**Scheduled Quarterly Run**:
A quarterly unified CN+US screening session executed on the first weekend on or after both markets' disclosure anchors for that cycle.
slug: scheduled_quarterly_run
_Avoid_: wartime run, 战时

**Disclosure Anchor**:
The calendar date when a market's reporting period is substantially complete for that cycle; used to compute the later-market gate before a scheduled quarterly run.
slug: disclosure_anchor

**Later Market Gate**:
Scheduled quarterly run must not start until max(CN anchor, US anchor) for the active reporting cycle.
slug: later_market_gate

**Tightening Profile Package M**:
Moderate sector-template tightening applied after initial spec; includes higher supporting bars and funnel soft cap 25 per market.
slug: tightening_profile_package_m
