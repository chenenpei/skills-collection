# Fund and ETF Workflow

Use this reference when the security is an ETF, index fund, passive sector fund, or other pooled investment vehicle — not a single operating company.

The goal is not to classify fund quality like company quality. The goal is to decide whether the fund is a sensible **tool** for the exposure the user wants, versus index alternatives, peer funds, and the risk-free rate.

Do not run `classification-rules.md`, company moat scoring, or company management scoring on the fund itself. Apply those lenses to underlying holdings only when needed to explain portfolio risk.

## Security Type Branch

After identification, classify the security as one of:

- Single company → use `workflow.md`
- ETF / index fund → use this file
- Active mutual fund / active ETF → use this file, plus manager and active-share sections
- REIT fund, bond fund, commodity fund, leveraged/inverse ETF → use this file with asset-class notes
- Unknown → ask before continuing

If the user says "fund", "ETF", "index fund", or names a known ETF ticker, default to this workflow unless evidence shows a single company.

## Fund Identification

Before any valuation work, identify:

- Fund full name and ticker
- Fund type: ETF, mutual fund, closed-end fund, etc.
- Primary listing venue and trading currency
- Issuer / sponsor
- Index tracked, or active mandate if not index-linked
- Index provider and index ticker
- Inception date, AUM, expense ratio
- Distribution policy and recent yield
- Share class, currency hedge, and ADR/OTC ambiguity if relevant
- Closest peer funds (at least one required before final verdict)

If identification confidence is not High, ask the user to confirm.

Common ambiguities to resolve:

- Same sector, different index (example: SMH vs SOXX)
- Same index, different issuer (example: IVV vs VOO)
- Synthetic vs physical replication
- Leveraged or inverse products

## Lite Fund Screening

Use Lite by default. It answers whether the fund deserves further work as a portfolio tool.

Steps:

1. Identify the fund and at least one peer alternative.
2. Gather fund-level and portfolio-level data per `data-contract.md` fund rules.
3. Assess data quality, especially for weighted NTM P/E and growth estimates.
4. Explain what exposure the fund actually delivers.
5. Summarize portfolio anatomy: concentration, sector/country mix, largest weights.
6. Compare valuation, cost, and risk versus default benchmarks and peer funds.
7. Run growth attribution check.
8. Run symmetric misunderstanding checks:
   - Bull-side debunking: test whether bullish claims are valid at portfolio level.
   - Bear-side hidden re-pricing: test whether bearish narratives miss portfolio-level earnings catch-up, cyclical recovery, or exposure misunderstanding.
9. Run industry-level profit-pool destruction check on the underlying exposure.
10. List the top three fund-specific risks.
11. Give a preliminary fund verdict using `fund-output-templates.md`.

Do not fill company income-statement fields at the fund level. Use `N/A` and redirect to portfolio-level metrics.

## Deep Fund Audit

Use Deep only when the user asks for it or when Lite shows enough evidence to justify further work.

Steps:

1. Identify the fund, share class, and peer set.
2. Collect and label data according to `data-contract.md` fund rules.
3. Document index methodology: weighting scheme, rebalance frequency, concentration limits, inclusion rules.
4. Build a holdings anatomy table for top 10-20 names with weight, trailing P/E, forward P/E, and NTM earnings growth where available.
5. Calculate portfolio weighted trailing P/E and weighted forward P/E. Show the calculation or cite issuer disclosure.
6. Estimate portfolio weighted NTM earnings growth. Separate leader contribution from drag names.
7. Compare fund cost, liquidity, tracking quality, and tax characteristics versus peers.
8. Analyze underlying industry cycle, profit-pool destruction, and hidden upside at the **exposure** level.
9. Run red-team risks and inversion on the fund as a tool, not as a company.
10. Check circle of competence for the underlying industry and fund structure.
11. Produce final verdict using `fund-output-templates.md`.

Do not assign company investment-type classifications (A/B/C/D/E) to the fund.

## Three-Layer Analysis Model

Always separate these layers. Mixing them is a common source of error.

### Layer 1: Fund wrapper

Questions:

- What does the investor pay for access? Expense ratio, spread, premium/discount, tax drag
- How well does the vehicle track its target? Tracking difference, replication method
- Is the wrapper liquid and durable? AUM, volume, issuer credibility

Metrics:

- Expense ratio
- AUM
- Average daily volume
- Premium / discount to NAV
- Tracking difference vs index over 1Y and 3Y if available
- Distribution yield

### Layer 2: Portfolio exposure

Questions:

- What economic exposure does the fund actually own?
- How concentrated is the portfolio?
- What valuation and growth does the **weighted portfolio** imply?

Metrics:

- Number of holdings
- Top 5 / Top 10 weight
- Largest single-name weight
- Sector and country weights
- Portfolio weighted trailing P/E
- Portfolio weighted forward P/E
- Portfolio weighted NTM earnings growth estimate
- Beta vs relevant benchmark

### Layer 3: Underlying holdings

Questions:

- Which names drive the thesis?
- Which names drag performance or distort valuation?
- Are leader growth rates being mistaken for portfolio growth?

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

Why this matters:

- A market-cap-weighted sector ETF can become a concentrated bet on the largest winners.
- An equal-weight ETF may offer broader exposure but different valuation and rebalance drag.
- Index rule changes can alter risk without changing the ticker.

## Growth Attribution Check

This check is mandatory for sector and thematic ETFs.

Do not:

- Use one holding's single-quarter YoY earnings growth as the fund's growth rate
- Use one holding's peak-cycle growth as the portfolio base case
- Use media "forward P/E" for the fund without issuer disclosure or a shown weighted calculation

Do:

1. Estimate portfolio weighted NTM earnings growth from holdings or reliable consensus data.
2. Compare implied growth from valuation:
   - `Implied NTM earnings growth ≈ (Portfolio trailing P/E / Portfolio forward P/E) - 1`
   - Label this as mechanical and approximate.
3. Compare implied growth vs weighted consensus growth.
4. Identify extreme contributors (example: memory upcycle, one-off base effects).
5. State whether the fund's current price appears to underprice or overprice **portfolio** growth, not leader growth alone.

Required conclusion format:

- Portfolio implied growth:
- Portfolio consensus growth:
- Leader-driven contribution:
- Drag names:
- Verdict on attribution: [leader extrapolation / balanced / unclear]

## Potential Misunderstanding Check (Fund Version)

Use this as a **symmetric** audit, not only a bull-debunking exercise.

- **Bull-side debunking**: test whether optimistic claims are valid at portfolio level.
- **Bear-side hidden re-pricing**: before Reject, Watchlist, or "too expensive" conclusions, test whether bearish narratives miss portfolio-level earnings catch-up, cyclical recovery, index methodology effects, or exposure misunderstanding.

### Bull-side debunking

Common fund-analysis errors to test:

1. **Trailing P/E fell, so the fund got cheaper**
   - Check whether price also rose sharply over the same period.
   - A falling trailing P/E can mean earnings caught up to an already rerated price.

2. **Leader growth equals fund growth**
   - Check top weights and drag names before accepting a bullish portfolio growth claim.

3. **Industry bull case equals fund alpha**
   - A strong sector outlook does not automatically make one ETF better than a peer ETF or broad index.

4. **Forward valuation already fully priced in**
   - Do not assert this unless portfolio forward P/E is calculated or issuer-disclosed.
   - Secondary media estimates alone are insufficient.

5. **Recent performance proves future edge**
   - Compare peer funds and benchmark over the same period.

Answer:

- What is the bullish claim?
- Which layer does it belong to: wrapper, portfolio, or single holding?
- Is the claim mathematically valid at portfolio level?
- What evidence would disprove it?

### Bear-side hidden re-pricing check

Before treating a sector ETF as "too expensive", a bubble, or a value trap, test whether the market is using an outdated exposure classification or ignoring verifiable positive evidence at the **portfolio** level.

Answer:

- What is the market's main reason for disliking this exposure or fund?
- Is that reason cyclical delay, narrative bias, transition pain, or structural decline?
- Is there a mismatch between the bearish label (example: "cyclical peak", "AI bubble", "too concentrated") and the current profit driver?
- Does the weighted portfolio show underappreciated evidence such as earnings catch-up, forward P/E below trailing P/E, leader earnings revisions, industrial recovery, or cyclical consolidation?
- Have the latest 2-4 quarters shown portfolio-level evidence that bears may not have repriced yet?
- If bears are wrong, where exactly are they wrong: wrapper, portfolio, or a few leader names?
- If the analyst is wrong, what evidence proves this is only a value trap or peak-cycle illusion?

### Hidden upside evidence checklist (portfolio level)

Do not accept a bear-side hidden-repricing thesis from unsupported narrative alone. Look for verifiable evidence:

1. **Trailing vs forward earnings mismatch**
   - Trailing portfolio P/E looks extreme, while calculated portfolio forward P/E is materially lower because leader earnings are rising fast.
   - Explain whether the gap comes from durable earnings power or only one-time cycle spikes.

2. **Portfolio implied growth below consensus growth**
   - `Portfolio trailing P/E / portfolio forward P/E - 1` is lower than weighted NTM earnings growth consensus.
   - This can support mild underpricing even when absolute valuation is not cheap.

3. **Earnings catch-up after price rerating**
   - Price rose first, then portfolio earnings accelerated over the next 2-4 quarters.
   - This is not the same as "cheap", but it can disprove a simple "peak bubble" label.

4. **Cyclical recovery inside the portfolio**
   - Some weighted holdings show restocking, margin recovery, or industrial rebound while the market still prices the whole basket as pure peak AI exposure.

5. **Peer or index misunderstanding**
   - The market compares the fund to the wrong benchmark, ignores index methodology, or treats a sector beta tool as if it were a single stock bubble.

Required conclusion format:

- Main bear narrative:
- Bear narrative type: [cyclical / narrative bias / transition pain / structural decline]
- Hidden re-pricing evidence: [yes / partial / no]
- Verdict impact: [supports Satellite Hold / supports Watchlist only / does not overturn caution]

## Industry Profit-Pool Destruction Check (Exposure Level)

Apply the destruction lens to the **underlying industry exposure**, not to the fund as an operating business.

Answer:

- Who can destroy the economics of this exposure without needing to profit from the same product?
- What mechanisms could compress the portfolio's weighted earnings faster than price?
- Which leading indicators should be tracked at exposure level?

Examples:

- Hyperscaler capex slowdown for semiconductor ETFs
- Storage price collapse for memory-heavy portfolios
- Regulatory or geopolitical shock for concentrated country exposure
- Index methodology lag for fast-changing industries

## Peer Fund Comparison

Before any positive fund verdict, compare at least one peer fund or the most relevant broad index ETF.

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

If no clear advantage appears, the verdict must not exceed Watchlist.

## Active Fund Add-On

For active mutual funds and active ETFs, also answer:

- Manager tenure and mandate stability
- Active share vs benchmark
- Turnover and tax efficiency
- Whether outperformance is explained by factor exposure rather than skill
- Fee load relative to passive alternative

If a passive peer exists with similar exposure and lower cost, require strong evidence before a positive active verdict.

## Fund-Specific Risks To Prioritize

Consider:

- Single-name concentration
- Sector or theme concentration
- Cyclical exposure at a possible peak
- Index methodology lag
- Premium / discount volatility (CEFs)
- Currency exposure for non-local investors
- Dividend tax and distribution tax character
- Leverage, inverse, or options-overlay decay
- Small AUM / liquidity risk

## Circle of Competence (Fund Version)

Check whether the user understands:

- What exposure the fund actually provides
- How the index or mandate differs from peer funds
- The main industry variables that move the NAV
- Whether recent gains came from broad beta, concentration, or valuation expansion
- Whether they are using the fund as core, satellite, or tactical exposure

If circle of competence is weak, do not assign Core Hold or Tactical Buy.

## Stop Conditions

Stop and ask when:

- Fund identity is ambiguous (SMH vs SOXX, share class confusion, wrong listing)
- Issuer and third-party valuation data conflict materially on weighted P/E or AUM
- Weighted forward P/E cannot be calculated and issuer does not disclose it, and the verdict depends on valuation
- The product is leveraged, inverse, or structured and the user's risk context is unknown

Downgrade rather than stop when:

- Some holding-level consensus data is missing but top weights are clear
- One drag name has distorted P/E and cannot be cleanly weighted

Do not continue when:

- The user wants a high-conviction fund verdict but the product type is unclear
- Data quality is Low and the missing data would change the allocation verdict

## Source Preference (Fund Version)

Prefer, in order:

1. Fund issuer fact sheet, prospectus, annual/semi-annual report, and holdings page
2. Index provider methodology document
3. Exchange or regulator filings for the fund wrapper
4. Underlying holding filings and primary market data
5. Reliable data providers for holding consensus estimates
6. Secondary media or community analysis only as leads, never as sole evidence for weighted forward P/E or portfolio growth

Cross-check at least:

- Fund ticker and tracked index
- Expense ratio and AUM
- Top 10 holdings and weights
- Portfolio trailing P/E if issuer-disclosed
- Weighted forward P/E if used in the verdict
- Peer fund identity and fee difference
