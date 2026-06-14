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

**Consumer Dividend Supporting**:
Optional consumer quality-track supporting metric for mature cash-return signal. Uses missing skip when dividend enrichment lacks data; not a compounder requirement.
slug: consumer_dividend_supporting
_Avoid_: requiring dividend yield for growth consumer names

**Dividend Yield Row Policy**:
When multiple dividend records exist, prefer the latest implemented cash dividend yield; if none implemented, use the latest announced yield and treat confidence as lower.
slug: dividend_yield_row_policy
_Avoid_: mixing pre-disclosure placeholder rows with implemented trailing yield

**Healthcare Template**:
Sector funnel for pharmaceutical, biotech, vaccine, CXO, and healthcare-services companies. Medical devices route to manufacturing; traditional Chinese medicine and pharmacy retail/distribution route to consumer.
slug: healthcare_template
_Avoid_: pharma_template, screening pharma via consumer union

**Medical Device Funnel Placement**:
Medical-device names route to the manufacturing template only; passing names may rank in deferred rather than the primary top band under the global funnel ranker. Deep audit remains the path for qualitative review of deferred device names.
slug: medical_device_funnel_placement
_Avoid_: re-routing devices to consumer for funnel convenience, treating deferred device names as funnel failures

**Healthcare Quality Dual Path**:
Healthcare quality track admits two archetypes: (1) profitable compounders via ROE/FCF/margin stability (Buffett/Li Lu), and (2) a small biotech exception for unprofitable but high-gross-margin growers that must pass stricter unit-economics and anti-deterioration gates before Deep audit applies classification.md sector exceptions.
slug: healthcare_quality_dual_path
_Avoid_: treating all biotech like SaaS growth names, mechanical ROE/FCF on pre-profit R&D names in Deep

**Healthcare Pass Rate Review**:
Quarterly review of healthcare sector-template pass rate against other templates; template tightening waits on Deep false-positive evidence, not pass-rate alone.
slug: healthcare_pass_rate_review
_Avoid_: tightening healthcare required bars only because top-20 names cluster in pharma

**Cyclicals Template**:
Sector funnel for materials, energy, industrials, and other cycle-driven companies. Uses mid-cycle normalized earnings for valuation metrics, not peak or trough snapshots.
slug: cyclicals_template

**Mid-Cycle Normalization**:
Average financial metric over a multi-year window (MVP: 7 years) used instead of peak or trough earnings for cyclical valuation.
slug: mid_cycle_normalization

**Enrichment Scope Tier**:
Classification of funnel metrics by implementation cost: low (derive or quote bulk), medium (peer overlays or enrich-cache history), high (new regulatory, NLP, or SaaS-only sources). MVP ships low and feasible medium only; high-tier metrics stay missing or block only bank-specific sub-templates.
slug: enrichment_scope_tier

**CN Bank Routing Proxy**:
Temporary grill decision (ADR 0003): CN 申万 L1 银行 routes to `financials.banks_proxy` instead of `banks` until bank regulatory enrich exists. Mispricing uses ROE + P/B only; credit-quality dimensions are manual in Deep. Requires `bank_routed_via_other_financials_proxy` funnel flag and CN template overrides (`net_debt_to_equity` skip, relaxed `revenue_3y_cagr`, quality `roe_ttm` CN min 0.10).
slug: cn_bank_routing_proxy
_Avoid_: treating proxy pass as bank credit approval

**CN Tech SaaS Quality Skip**:
Grill decision (ADR 0004): On CN market, `tech_saas` quality supporting metrics `sbc_to_revenue` and `share_dilution_3y` use `missing: skip` until CN sources exist. Emit `verify_sbc_dilution_in_deep_cn` when skipped. US rules unchanged.
slug: cn_tech_saas_quality_skip
_Avoid_: inferring SBC or dilution were screened from a CN quality pass

**Peak Cycle Trap**:
A cyclical false-value signal where trailing multiples look cheap because earnings are at a cycle peak. Excluded by cyclicals kill gates before mispricing scoring.
slug: peak_cycle_trap

**Manufacturing Template**:
Sector funnel for manufacturing, hardware, semiconductors, and industrial producers, aligned with capex intensity, inventory turnover, capacity utilization, and customer concentration checks.
slug: manufacturing_template

**Capex to Revenue Ratio**:
Capital expenditure divided by revenue, using a multi-year average in funnel enrichment to smooth one-off capacity builds. Requires at least two fiscal years with capex data; two-year averages use medium data confidence, three-year averages use high. Aligns with Buffett/Munger capex-discipline screens for manufacturers.
slug: capex_to_revenue_ratio
_Avoid_: single-year capex spikes as the only funnel signal, treating a one-year capex print as a full multi-year average

**Inventory Turnover vs Industry**:
A company's inventory turnover minus the median turnover of its industry-peer group in the same market. Proxy for supply-chain efficiency and channel health in manufacturing screens.
slug: inventory_turnover_vs_industry

**Semiconductor Capex Override**:
Manufacturing quality-track capex-to-revenue supporting threshold uses 25% for semiconductor GICS codes instead of the default 15%.
slug: semiconductor_capex_override

**Enrichment Cache Repair**:
When live enrichment leaves tickers without a cache file, operators may run a targeted repair pass for the missing tickers before quarterly sign-off; diagnostics should report missing-cache counts and sample tickers.
slug: enrichment_cache_repair
_Avoid_: treating missing-cache tickers as absent from the enriched universe

**Funnel Soft Cap**:
Maximum number of ranked candidates written to primary funnel output per market per run. Overflow passes are written to deferred output, not deleted.
slug: funnel_soft_cap

**Winning Template**:
The sector funnel template whose track granted the candidate's pass and supplied its funnel score. When ambiguous union evaluates multiple templates, the winning template is the one with the highest within-template score among passing tracks.
slug: winning_template
_Avoid_: primary routed template, Shenwan L1 industry bucket

**Template Seat Allocation**:
The rule that fills candidates.yaml from template track seat pools using seat floors, seat caps, and a flex seat pool up to the funnel soft cap. Ensures sector-diverse shortlists without comparing incomparable cross-template scores.
slug: template_seat_allocation
_Avoid_: global supporting-count sort across templates, Shenwan L1 seat quotas, purely fixed per-template quotas

**Seat Floor**:
The minimum number of candidates a template track seat pool receives each run when enough passers exist. Guarantees sector representation before flex seats are distributed.
slug: seat_floor

**Seat Cap**:
The maximum number of candidates a template track seat pool may receive in one run. Prevents a single sector from consuming the full funnel soft cap.
slug: seat_cap

**Flex Seat Pool**:
Seats remaining after seat floors are filled; distributed across template track pools that still have eligible passers, weighted by pool richness and track confluence priority.
slug: flex_seat_pool

**Track Confluence**:
When the same winning template passes both quality and mispricing tracks for one security. The name ranks in a priority tier above single-track quality passers within the quality pool, receives doubled flex-seat-pool weighting, but still consumes only one seat.
slug: track_confluence
_Avoid_: occupying both a quality seat and a mispricing seat, treating mispricing alone as equal to confluence, confluence ranked only by supporting pass count without priority tier

**Template Track Seat Pool**:
The seat-allocation bucket defined by winning template and passed track together. Quality and mispricing passes compete only within their own pool, never for each other's seats.
slug: template_track_seat_pool
_Avoid_: merging quality and mispricing into one template pool

**Vacant Seat Backfill**:
When a template track seat pool cannot fill its quota, empty seats refill in two tiers: first to the quality pool of the same winning template, then to a global quality pool across templates until the funnel soft cap is reached.
slug: vacant_seat_backfill
_Avoid_: backfilling into mispricing pools, leaving seats permanently empty by default

**Funnel Ranking Role**:
Coarse within-market ordering after sector templates pass. Under template seat allocation, rank is meaningful only within each template track seat pool; merged candidates.yaml rank is a Deep queue priority order, not a cross-sector attractiveness verdict.
slug: funnel_ranking_role
_Avoid_: treating merged funnel rank as final conviction order, comparing raw supporting pass counts across templates

**Candidate Rank**:
The integer order on a candidate record in candidates.yaml. Under template seat allocation, rank is the Deep audit queue priority: track confluence first, then remaining quality seats by allocation tier, not a global best-stock score.
slug: candidate_rank
_Avoid_: cross-template attractiveness ranking, equating rank 1 with the best security in the market

**Deferred Candidate**:
A security that passed sector funnel tracks but was not allocated a seat in candidates.yaml for its market in that run. Only a capped watchlist is written to deferred.yaml; additional passers are counted in funnel diagnostics only.
slug: deferred_candidate
_Avoid_: treating deferred as excluded or kill-gated, writing every sector passer to deferred.yaml

**Deferred Watchlist Cap**:
The maximum number of deferred candidate records written per market per run. Overflow sector passers appear only in funnel diagnostics counts, not in deferred.yaml.
slug: deferred_watchlist_cap

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
Moderate sector-template tightening applied after initial spec; includes higher supporting bars, funnel soft cap 20 per market, and template track seat allocation ranker.
slug: tightening_profile_package_m
