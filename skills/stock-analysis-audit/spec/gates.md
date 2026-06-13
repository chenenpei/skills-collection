# Gates and Shared Checks

Use this file to decide when to stop, downgrade, continue, or require a workflow section. Domain terms and slugs are defined in `../CONTEXT.md`.

## Security Branch Gate

Before valuation or final verdict:

1. Identify the security type.
2. Confirm identity confidence is High.
3. Route to the correct workflow.

Routes:

- Single company -> `workflow-company.md`
- ETF / index fund / active fund / other pooled vehicle -> `workflow-fund.md`
- Unknown -> stop and ask one question

Do not apply company M/N investment classifications, company moat scoring, or company management scoring to funds.

## Stop Conditions

Stop and ask one question when:

- Multiple securities match the user keyword.
- Company or fund identity is ambiguous.
- The current security cannot be mapped to the company because of delisting, merger, privatization, ticker change, or share-class confusion.
- Fund identity, tracked index, mandate, issuer, share class, or peer fund is ambiguous.
- Reliable sources conflict materially on a key value and the conflict would affect the verdict.
- Weighted forward P/E cannot be calculated or issuer-disclosed for a fund, and the verdict depends on valuation.
- The product is leveraged, inverse, structured, or otherwise path-dependent and the user's risk context is unknown.
- The user asks for an action framework but provides no circle-of-competence or risk context.

Ask one question at a time. Prefer multiple-choice options when possible.

## Downgrade Conditions

Continue with downgrade when:

- Some non-critical data is missing but the direction is clear.
- Qualitative evidence is incomplete but financial data is sufficient for Lite.
- Some holding-level consensus data is missing but top weights are clear.
- One drag holding has distorted P/E and cannot be cleanly weighted.
- Data quality is Low. In that case, final company or fund verdict must not exceed a watchlist-level verdict.

Do not continue when key valuation or cash-flow quality data is unavailable and would likely change the verdict.

## Company Workflow Gates

- Do not run valuation before data is labeled and data quality is scored.
- Do not give a positive company verdict before running the profit-pool destruction check.
- Do not classify a disliked stock as `classification_value_trap` before running the hidden-upside check.
- Do not assign `verdict_high_conviction` unless data quality is at least Medium, business model is clear, moat is strong, cash generation is real, valuation provides margin, opportunity cost is superior, no visible asymmetric destroyer exists, and the user is inside the circle of competence.
- In Deep mode, do not produce final company verdict without using `classification.md`.

## Fund Workflow Gates

- Do not analyze a fund as an operating company.
- Do not fill company revenue, net income, operating cash flow, Capex, FCF, ROE, or ROIC fields at fund level.
- Do not use one holding's single-quarter growth as the fund's growth rate.
- Do not use secondary media forward P/E as portfolio forward P/E without issuer disclosure or a reproducible weighted calculation.
- Do not issue a positive fund verdict without at least one peer fund and one relevant broad benchmark.
- Do not assign `verdict_core_hold` if circle of competence for exposure and wrapper is weak.
- For default fund analysis, stay fund-only. Analyze underlying single-company holdings only when the user explicitly asks for that holding-level company analysis.

## Profit-Pool Destruction Check

Before treating growth as durable or valuation as attractive, answer:

- Who does not need to profit from this product or exposure but can destroy its economics?
- Could an ecosystem owner, platform, hardware/OS vendor, upstream supplier, foundation model provider, channel, or regulator make it free, bundled, technically obsolete, or uneconomic?
- What 3-5 mechanisms could drive long-term excess profits toward zero?
- Are those mechanisms already visible in leading indicators such as gross margin, usage cost, churn, ARPU, CAC, channel take rate, system bundling, free alternatives, API dependency, or capex slowdown?

For funds, apply this at exposure level, not to the wrapper as an operating business.

## Company Hidden-Upside Check

Before rejecting a disliked stock, classifying it as `classification_value_trap`, or treating it as permanently impaired, answer:

- What is the market's main reason for disliking the company?
- Is that reason cyclical delay, narrative bias, transition pain, or permanent structural decline?
- Is there a mismatch between the outdated business classification and the current profit driver?
- Does the company have underappreciated positive evidence such as ecosystem access, sticky user relationships, data, distribution, supply-chain position, service/software revenue, separable assets, improved capital allocation, or a new profit pool?
- Have the latest 2-4 quarters shown evidence that the market has not repriced yet?
- If the market is wrong, where exactly is it wrong?
- If the analyst is wrong, what evidence proves this is only a value trap?

Evidence gates:

1. Net-income/cash-flow divergence.
2. Counter-cyclical buybacks and real diluted share count reduction.
3. Early quantitative evidence of a new growth driver.
4. Downturn-driven competitive consolidation.
5. Cyclical versus structural impairment.

Do not accept management claims without verifiable evidence.

## Fund Symmetric Misunderstanding Check

For funds and ETFs, run both sides:

- Bull-side debunking: test whether optimistic claims are valid at portfolio level.
- Bear-side hidden re-pricing: test whether bearish narratives miss portfolio earnings catch-up, cyclical recovery, index methodology effects, or exposure misunderstanding.

Common bull-side errors:

1. Trailing P/E fell, so the fund got cheaper.
2. Leader growth equals fund growth.
3. Industry bull case equals fund alpha.
4. Forward valuation is fully priced without issuer disclosure or weighted calculation.
5. Recent performance proves future edge.

Portfolio-level hidden re-pricing evidence:

1. Trailing versus forward earnings mismatch.
2. Portfolio implied growth below consensus growth.
3. Earnings catch-up after price rerating.
4. Cyclical recovery inside the portfolio.
5. Peer or index misunderstanding.

## Required Structured Summary

Every final report must include `## Structured Summary`.

Company Lite fields:

- `data_quality`
- `business_archetype` if evidence supports it; otherwise `N/A`
- `final_verdict`

Company Deep fields:

- `data_quality`
- `business_archetype`
- `investment_classification`
- `final_verdict`

Fund Lite and Deep fields:

- `data_quality`
- `final_verdict`
- `portfolio_role`

Each row must include `field`, `slug`, and user-locale `label`.
