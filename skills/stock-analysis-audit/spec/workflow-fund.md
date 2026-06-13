# Fund and ETF Workflow

Scope: ETFs, index funds, active funds, passive sector funds, and other pooled investment vehicles.

The goal is not to classify fund quality like company quality. The goal is to decide whether the fund is a sensible tool for the exposure the user wants, versus peer funds, broad benchmarks, and the risk-free rate.

Terms live in `../CONTEXT.md`. Data rules live in `data.md`. Stop and downgrade rules live in `gates.md`.

## Security Type Branch

After identification, classify the security as one of:

- Single company -> use `workflow-company.md`
- ETF / index fund -> use this file
- Active mutual fund / active ETF -> use this file, plus Active Fund Add-On
- REIT fund, bond fund, commodity fund, leveraged / inverse ETF, or structured product -> use this file with asset-class notes and stop if risk context is unknown
- Unknown -> ask before continuing

If the user says fund, ETF, index fund, or names a known ETF ticker, default to this workflow unless evidence shows a single company.

Gate: default fund analysis is fund-only. Analyze underlying single-company holdings only when the user explicitly asks for holding-level company analysis.

## Fund Identification

Before valuation work, identify:

- Fund full name and ticker
- Fund type: ETF, mutual fund, closed-end fund, etc.
- Primary listing venue and trading currency
- Issuer / sponsor
- Index tracked, or active mandate if not index-linked
- Index provider and index ticker
- Inception date, AUM, expense ratio
- Distribution policy and recent yield
- Share class, currency hedge, and ADR/OTC ambiguity if relevant
- Closest peer funds, with at least one required before final verdict

Gate: if identification confidence is not High, ask the user to confirm.

Common ambiguities:

- Same sector, different index, such as SMH versus SOXX
- Same index, different issuer, such as IVV versus VOO
- Synthetic versus physical replication
- Leveraged or inverse products

## Lite Fund Screening

Use Lite by default. It answers whether the fund deserves further work as a portfolio tool.

Steps:

1. Identify the fund and at least one peer alternative.
2. Gather fund-level and portfolio-level data per `data.md`.
3. Assess data quality, especially weighted forward P/E and growth estimates.
4. Explain what exposure the fund actually delivers.
5. Summarize portfolio anatomy: concentration, sector/country mix, largest weights.
6. Compare valuation, cost, risk, liquidity, and tracking versus default benchmarks and peer funds.
7. Run growth attribution check.
8. Run symmetric misunderstanding checks: bull-side debunking and bear-side hidden re-pricing.
9. Run industry-level profit-pool destruction check on the underlying exposure.
10. List the top three fund-specific risks.
11. Give a preliminary fund verdict using `templates-fund.md`.

Gate: do not fill company income-statement fields at the fund level. Use `N/A` and redirect to portfolio-level metrics.

## Deep Fund Audit

Use Deep only when the user asks for it or when Lite shows enough evidence to justify further work.

Steps:

1. Identify the fund, share class, peer set, and broad benchmark.
2. Collect and label data according to `data.md`.
3. Document index methodology: weighting scheme, rebalance frequency, concentration limits, inclusion rules.
4. Build a holdings anatomy table for top 10-20 names with weight, trailing P/E, forward P/E, and NTM earnings growth where available.
5. Calculate portfolio weighted trailing P/E and weighted forward P/E. Show the calculation or cite issuer disclosure.
6. Estimate portfolio weighted NTM earnings growth. Separate leader contribution from drag names.
7. Compare fund cost, liquidity, tracking quality, tax characteristics, and structure risk versus peers.
8. Analyze underlying industry cycle, profit-pool destruction, and hidden upside at exposure level.
9. Run red-team risks and inversion on the fund as a tool, not as a company.
10. Check circle of competence for the underlying industry and fund structure.
11. Produce final verdict using `templates-fund.md`.

Gate: do not assign company investment-type classifications to the fund.

## Three-Layer Analysis Model

Always separate these layers:

1. Fund wrapper: expense ratio, spread, premium/discount, tax drag, tracking difference, replication method, AUM, volume, issuer durability.
2. Portfolio exposure: economic exposure, concentration, weighted valuation, weighted growth, sector/country mix.
3. Underlying holdings: names that drive or drag the thesis, distort valuation, or create concentration risk.

Required for Lite when top 10 weight exceeds 50%:

- Top 10 table with weight, trailing P/E, forward P/E, and NTM earnings growth
- Explicit note on drag holdings and distorted P/E names

## Index Methodology Questions

Answer:

- What index is tracked, and what does it represent?
- Weighting scheme: market cap, equal weight, modified weight, factor tilt
- Rebalance and reconstitution schedule
- Maximum number of holdings or concentration rules
- Whether foreign listings, ADRs, or depositary receipts are included
- How quickly new industry leaders enter the fund

Why it matters:

- A market-cap-weighted sector ETF can become a concentrated bet on the largest winners.
- An equal-weight ETF may offer broader exposure but different valuation and rebalance drag.
- Index rule changes can alter risk without changing the ticker.

## Growth Attribution Check

Mandatory for sector and thematic ETFs.

Do not:

- Use one holding's single-quarter YoY earnings growth as the fund's growth rate
- Use one holding's peak-cycle growth as the portfolio base case
- Use media forward P/E for the fund without issuer disclosure or a shown weighted calculation

Do:

1. Estimate portfolio weighted NTM earnings growth from holdings or reliable consensus data.
2. Compare implied growth from valuation:
   - `Implied NTM earnings growth ~= (Portfolio trailing P/E / Portfolio forward P/E) - 1`
   - Label this as mechanical and approximate.
3. Compare implied growth vs weighted consensus growth.
4. Identify extreme contributors.
5. State whether current price appears to underprice or overprice portfolio growth, not leader growth alone.

Required conclusion:

- Portfolio implied growth
- Portfolio consensus growth
- Leader-driven contribution
- Drag names
- Verdict on attribution: leader extrapolation, balanced, or unclear

## Bull-side debunking

Use this to test whether optimistic claims are valid at portfolio level.

Answer:

- What is the bullish claim?
- Which layer does it belong to: wrapper, portfolio, single holding, or media narrative?
- Is trailing P/E compression real de-rating or earnings catch-up to price?
- Is leader growth being mistaken for portfolio growth?
- Does industry optimism equal fund alpha versus peers and broad benchmarks?
- What evidence would disprove the bullish claim?

## Bear-side hidden re-pricing

Use this before treating a sector ETF as too expensive, a bubble, or a value trap.

Answer:

- What is the main bear narrative?
- Is it cyclical delay, narrative bias, transition pain, or structural decline?
- Is the market using an outdated exposure classification?
- Does the weighted portfolio show underappreciated evidence such as earnings catch-up, forward P/E below trailing P/E, leader earnings revisions, industrial recovery, or cyclical consolidation?
- Have the latest 2-4 quarters shown portfolio-level evidence that bears may not have repriced yet?
- If bears are wrong, where exactly are they wrong: wrapper, portfolio, or a few leader names?
- If the analyst is wrong, what evidence proves this is only a value trap or peak-cycle illusion?

## Peer Fund Comparison

Before any positive fund verdict, compare at least one peer fund and a relevant broad benchmark.

Compare:

- Expense ratio
- Holdings count and concentration
- Top 10 weights
- Weighted trailing and forward P/E if calculable
- Beta and drawdown history
- Tracking quality
- Liquidity

Required answer:

- Why this fund instead of the peer?
- What extra risk does this fund take?
- What extra cost does the investor pay?

Gate: if no clear advantage appears, the verdict must not exceed `verdict_fund_watchlist`.

## Active Fund Add-On

For active mutual funds and active ETFs, also answer:

- Manager tenure and mandate stability
- Active share vs benchmark
- Turnover and tax efficiency
- Whether outperformance is explained by factor exposure rather than skill
- Fee load relative to passive alternative

If a passive peer exists with similar exposure and lower cost, require strong evidence before a positive active verdict.

## Fund-Specific Risks

Prioritize:

- Single-name concentration
- Sector or theme concentration
- Cyclical exposure at a possible peak
- Index methodology lag
- Premium / discount volatility for CEFs
- Currency exposure for non-local investors
- Dividend tax and distribution tax character
- Leverage, inverse, or options-overlay decay
- Small AUM / liquidity risk

## Circle of Competence

Check whether the user understands:

- What exposure the fund actually provides
- How the index or mandate differs from peer funds
- The main industry variables that move the NAV
- Whether recent gains came from broad beta, concentration, or valuation expansion
- Whether they are using the fund as core, satellite, or tactical exposure

Gate: if circle of competence is weak, do not assign `verdict_core_hold`.

## Shared Checks

Use `gates.md` for:

- Fund symmetric misunderstanding check
- Exposure-level profit-pool destruction check
- Stop conditions
- Downgrade conditions
- Structured Summary requirements
