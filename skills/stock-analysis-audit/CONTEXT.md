# Stock Analysis Audit Context

Vocabulary for the stock-analysis-audit skill. This file defines domain terms only; process rules, thresholds, data contracts, and report templates live in `spec/`.

## Language

Use the slug as the stable structured value. Render labels in the user's requested language. If no output language is specified, match the user's message language.

## Security Types

**Single company**:
A listed operating company whose business, financial statements, moat, management, and valuation can be audited directly.
slug: security_single_company
_Avoid_: stock when the security may be an ETF or fund

**ETF or index fund**:
A pooled vehicle designed to track an index or passive mandate. Analyze it as an exposure tool, not as an operating company.
slug: security_etf_or_index_fund
_Avoid_: company, issuer quality

**Active fund**:
A pooled vehicle whose portfolio is selected by a manager or active mandate. Analyze wrapper quality, portfolio exposure, fees, manager evidence, and active-share evidence.
slug: security_active_fund
_Avoid_: treating manager reputation as proof of skill

**Other pooled vehicle**:
A REIT fund, bond fund, commodity fund, closed-end fund, leveraged ETF, inverse ETF, options-overlay fund, or structured product.
slug: security_other_pooled_vehicle
_Avoid_: ordinary ETF

## Analysis Modes

**Lite screening**:
Default mode. It answers whether the security deserves more research or a cautious portfolio role with limited data burden.
slug: mode_lite
_Avoid_: full audit, deep dive

**Deep audit**:
Full workflow used only when the user asks for Deep, full audit, or complete analysis, or when Lite provides enough evidence to justify further work.
slug: mode_deep
_Avoid_: quick take

## Taxonomy Layers

**Business archetype**:
A qualitative business-model label used to describe how a company tends to earn and defend profits. It is not an investment classification and not a final verdict.
slug: taxonomy_business_archetype
_Avoid_: using archetype as a buy/sell conclusion

**Investment classification**:
A Deep-only single-company M/N classification with necessary conditions, supporting evidence, veto conditions, and sector exceptions.
slug: taxonomy_investment_classification
_Avoid_: conflating with final verdict or business archetype

**Final verdict**:
The final decision label for the security. Company and fund verdicts use different scales.
slug: taxonomy_final_verdict
_Avoid_: investment type

## Company Verdicts

**Reject**:
The stock does not currently justify single-name concentration risk versus alternatives.
slug: verdict_reject
zh: 一票否决
_Avoid_: value trap unless classification rules specifically support it

**Watchlist**:
The stock may be worth monitoring, but data, valuation, quality, risks, or opportunity cost do not support positive action now.
slug: verdict_watchlist
zh: 观察名单
_Avoid_: vague "worth watching" without trigger conditions

**Medium-term revaluation opportunity**:
A bounded, medium-term opportunity whose thesis depends on identifiable re-pricing, catalysts, and falsification conditions.
slug: verdict_medium_term_revaluation
zh: 中期估值修复机会
_Avoid_: long-term compounder

**High-quality company at reasonable price**:
A long-term candidate where business quality, cash generation, and valuation pass the audit, subject to competence and sizing.
slug: verdict_quality_reasonable_price
zh: 合理价格的高质量公司
_Avoid_: high conviction unless all stricter gates are met

**High conviction candidate**:
A rare positive verdict requiring at least Medium data quality, clear business model, strong moat, real cash generation, valuation margin, superior opportunity cost, no visible asymmetric destroyer, and user competence.
slug: verdict_high_conviction
zh: 高 conviction 候选
_Avoid_: using for Low data quality or weak circle of competence

## Fund Verdicts

**Fund reject**:
The fund's fee, structure, tracking, liquidity, concentration, valuation, or exposure is clearly inferior to relevant alternatives.
slug: verdict_fund_reject
zh: Reject
_Avoid_: company-style Reject

**Fund watchlist**:
The exposure may be useful, but current data, price, cycle, structure, or peer comparison does not support action now.
slug: verdict_fund_watchlist
zh: Watchlist
_Avoid_: core holding

**Satellite hold**:
The fund is reasonable as a small satellite exposure for users who specifically want this exposure.
slug: verdict_satellite_hold
zh: Satellite Hold
_Avoid_: core holding

**Core hold**:
The fund is a durable, transparent, cost-effective tool with clear advantages versus peers and broad benchmarks for long-term allocation.
slug: verdict_core_hold
zh: Core Hold
_Avoid_: using without peer and broad benchmark comparison

**Tactical only**:
The fund may be useful for a defined cycle, event, or valuation window, but should not be treated as a long-term core holding.
slug: verdict_tactical_only
zh: Tactical Only
_Avoid_: permanent allocation

## Investment Classification Types

**Cigar-butt undervalued asset**:
An investment type where the thesis mainly comes from low price rather than high business quality. Detailed thresholds live in `spec/classification.md`.
slug: classification_cigar_butt
zh: 烟蒂型低估资产
_Avoid_: business archetype cigar-butt; this is not a moat label

**High-quality company at reasonable price classification**:
An investment type where business quality, cash conversion, resilience, and valuation are all credible.
slug: classification_quality_at_reasonable_price
zh: 合理价格的高质量公司
_Avoid_: final verdict unless the report is explicitly in verdict context

**Quantitative mispricing with high upside**:
An investment type where above-average business quality plus excessive market pessimism creates high upside with a resilient balance sheet.
slug: classification_quantitative_mispricing
zh: 定量错配的高赔率机会
_Avoid_: cigar-butt value

**Value trap**:
A cheap-looking stock whose revenue, margin, cash flow, moat, leverage, or industry structure is deteriorating after the hidden-upside check fails.
slug: classification_value_trap
zh: 价值陷阱
_Avoid_: using before hidden-upside check

**Overpriced excellent company**:
A high-quality company whose valuation likely limits medium-term shareholder returns despite good fundamentals.
slug: classification_overpriced_excellent
zh: 估值透支的优秀公司
_Avoid_: Reject without explaining quality

## Lifecycle Stages

**Chaotic stage**:
Business direction is not stable, financial validation is insufficient, and the business model is still being tested.
slug: lifecycle_chaotic
zh: 混沌期
_Avoid_: evidence-established stage

**Evidence-established stage**:
Business model has been validated by consecutive financial evidence, but the market may still undervalue it due to historical bias, short-term negative events, or macro pressure.
slug: lifecycle_evidence_established
zh: 证据确立期
_Avoid_: 证据确认期, 证据验证期

**Fully priced stage**:
The company's advantages are widely recognized and valuation already reflects optimistic expectations.
slug: lifecycle_fully_priced
zh: 摊牌期
_Avoid_: cheap quality

**Declining stage**:
Core business, margins, cash flow, or competitive position show structural deterioration.
slug: lifecycle_declining
zh: 衰退期
_Avoid_: temporary bad news

## Business Archetypes

**Toll-road business**:
A business with strong barriers, predictable cash flow, and a low need for reinvestment to maintain its position.
slug: archetype_toll_road
zh: 收费公路型
_Avoid_: calling any high-margin business a toll road without evidence

**Quasi toll-road business**:
A business that resembles a toll road but has weaker pricing power, weaker durability, or more dependency risk.
slug: archetype_quasi_toll_road
zh: 准收费公路型
_Avoid_: toll-road business

**Gold in quicksand business**:
A business that may contain valuable assets or growth but requires continuous heavy investment, adaptation, or reinvention to avoid erosion.
slug: archetype_gold_in_quicksand
zh: 流沙淘金型
_Avoid_: stable compounder

**Cyclical asset**:
A business whose earnings power and valuation are strongly driven by industry cycles, capacity, commodity prices, or demand timing.
slug: archetype_cyclical_asset
zh: 周期资产
_Avoid_: using peak-cycle earnings as normalized earnings

**Financial leverage asset**:
A business whose shareholder returns are primarily shaped by leverage, spreads, duration, asset quality, or regulatory capital.
slug: archetype_financial_leverage_asset
zh: 金融杠杆资产
_Avoid_: ordinary industrial company

## Data Quality

**High data quality**:
Primary filings or reliable data providers support most key values, and dates, periods, currencies, and calculation bases are clear.
slug: data_quality_high
_Avoid_: using secondary media as primary evidence

**Medium data quality**:
Enough reliable data exists for a directional conclusion, but some values are missing, delayed, or estimated.
slug: data_quality_medium
_Avoid_: high-conviction certainty

**Low data quality**:
Key identity, financial, valuation, benchmark, fund-wrapper, or portfolio data is missing or materially conflicting.
slug: data_quality_low
_Avoid_: verdict above Watchlist

## Core Principles

**Margin of safety**:
Safety margin must come from reasonable valuation, verifiable cash flow, stable business quality, and tolerable downside scenarios.
slug: principle_margin_of_safety
_Avoid_: treating low valuation alone as safety

**Good company versus good stock**:
A good company is not automatically an attractive stock if valuation already absorbs future returns.
slug: principle_good_company_good_stock
_Avoid_: quality-only conclusions

**Opportunity cost**:
A single stock must justify concentration risk versus index alternatives; a fund must justify its role versus peer funds, broad benchmarks, and the risk-free rate.
slug: principle_opportunity_cost
_Avoid_: analyzing in isolation

**Evidence-first language**:
Qualitative claims such as moat, management quality, or industry runway require verifiable evidence.
slug: principle_evidence_first
_Avoid_: vague optimism

## Qualitative Frameworks

**Moat dimensions**:
Switching cost, pricing power, network effects, scale economies, brand or trust, data or workflow lock-in, regulation or license barriers, and upstream/platform/customer dependence.
slug: framework_moat_dimensions
_Avoid_: single-metric moat

**Management allocator rating**:
Capital allocation conclusion must be Excellent, Acceptable, Questionable, Poor, or Insufficient data.
slug: framework_management_allocator
_Avoid_: personality-based management praise

**Circle of competence**:
User competence depends on understanding the business model, industry variables, leading indicators, temporary versus structural bad news, and any informational or experiential edge.
slug: framework_circle_of_competence
_Avoid_: high conviction without competence

## Audit Concepts

**Profit-pool destruction**:
The check for actors who do not need to profit from the product but can make the profit pool free, bundled, obsolete, regulated away, or uneconomic.
slug: audit_profit_pool_destruction
_Avoid_: ordinary volatility risk

**Hidden upside check**:
The check for whether negative market narratives miss underappreciated assets, new profit pools, business reclassification, capital allocation change, or cyclical rather than structural impairment.
slug: audit_hidden_upside
_Avoid_: management promises without evidence

**Bull-side debunking**:
For funds, the check that bullish claims hold at portfolio level rather than only at leader-holding, industry-narrative, or media level.
slug: audit_bull_side_debunking
_Avoid_: leader growth equals fund growth

**Bear-side hidden re-pricing**:
For funds, the check that bearish narratives do not miss portfolio earnings catch-up, cyclical recovery, index methodology effects, or exposure misunderstanding.
slug: audit_bear_side_hidden_repricing
_Avoid_: calling an exposure too expensive without portfolio evidence

## Sector Adjustments

**Healthcare sector adjustment**:
Deep audit metrics for pharmaceutical, biotech, vaccine, CXO, and healthcare-services companies: gross margin and pricing power, R&D and pipeline quality, patent cliff, FCF conversion or pre-profit cash runway, reimbursement and procurement risk, and CXO customer concentration.
slug: sector_adjustment_healthcare
_Avoid_: screening healthcare via consumer or tech_saas sector blocks

## Fund Concepts

**Fund wrapper**:
The vehicle layer: fee, liquidity, AUM, premium or discount, tracking, tax drag, and structural durability.
slug: fund_layer_wrapper
_Avoid_: portfolio exposure

**Portfolio exposure**:
The economic exposure the fund actually owns, including concentration, sector/country mix, weighted valuation, and weighted growth.
slug: fund_layer_portfolio_exposure
_Avoid_: wrapper quality

**Underlying holdings**:
The individual holdings that drive or distort the fund thesis.
slug: fund_layer_underlying_holdings
_Avoid_: fund-level company analysis

**Growth attribution**:
The decomposition of portfolio growth into leader contribution, drag names, cycle effects, earnings catch-up, and one-off distortions.
slug: fund_growth_attribution
_Avoid_: one holding's growth equals fund growth

**Implied NTM earnings growth**:
Mechanical approximation: portfolio trailing P/E divided by portfolio forward P/E minus one.
slug: fund_implied_ntm_growth
_Avoid_: consensus growth

## Structured Summary

**Structured Summary**:
A fixed report block containing `field`, `slug`, and rendered `label`. Narrative text may use the user's language, but this block keeps outputs auditable.
slug: output_structured_summary
_Avoid_: unstructured final labels only

## Concept Index

- Verdict slugs: this file; report shape in `spec/templates-company.md` and `spec/templates-fund.md`
- Investment classification slugs: this file; M/N rules in `spec/classification.md`
- Lifecycle and archetype slugs: this file; usage in `spec/workflow-company.md`
- Data quality definitions: this file; downgrade gates in `spec/gates.md`
- Data metrics and calculations: `spec/data.md`
- Company workflow: `spec/workflow-company.md`
- Fund workflow: `spec/workflow-fund.md`
