# Data Contract and Tool Policy

Use this file whenever analysis requires financial, market, benchmark, fund-wrapper, or portfolio data.

## Required Metadata

Every key number must include:

- Data date
- Fiscal period
- Currency
- Source
- Accounting or calculation basis, such as TTM, annual, quarterly, GAAP, non-GAAP, adjusted, reported, or estimated

If a number cannot be verified, write `N/A`. Do not fabricate, smooth, interpolate, or fill values to complete a table.

## Data Quality

Use `data_quality_high`, `data_quality_medium`, or `data_quality_low` from `../CONTEXT.md`.

If data quality is Low, final company or fund verdict must not exceed a watchlist-level verdict.

## Free Cash Flow

Default definition:

`FCF = Operating Cash Flow - Capital Expenditure`

If using another definition, explain why and label it clearly.

## Required Baselines

Collect or request:

- Company market cap and enterprise value
- Current or TTM revenue, net income, operating cash flow, Capex, FCF
- P/E, P/S, EV/FCF when calculable
- ROE or ROIC when meaningful
- Net cash or net debt
- Relevant 10-year government bond yield
- Nasdaq 100 comparison data
- CSI Dividend Index comparison data
- Local market core index when relevant

## Sector Adjustments

Technology and SaaS:

- Revenue growth
- Gross margin
- Operating leverage
- SBC as percentage of revenue
- Diluted share count change
- Net dollar retention when available
- Churn when available
- Rule of 40 when applicable

AI applications and platform-dependent software:

- Distribution control: app stores, super apps, search, social platforms, cloud marketplaces, or hardware/OS entry points
- Free, bundled, open-source, or subsidized substitutes
- Foundation model, API, cloud compute, chip, data, and channel dependency
- Inference or compute unit cost versus usage-based revenue
- Ability to pass through usage costs without hurting retention or conversion
- LTV/CAC, renewal, churn, ARPU, and paid conversion when available

Financials:

- ROE
- P/B
- Net interest margin
- Non-performing loan ratio
- Provision coverage
- Capital adequacy
- Leverage
- Asset-liability duration risk

Cyclicals:

- Mid-cycle earnings
- Peak versus trough profitability
- Commodity price sensitivity
- Capacity expansion risk
- Balance sheet resilience

Consumer:

- Same-store growth
- Price-band stability
- Channel inventory
- Brand premium
- Repeat purchase behavior
- Margin stability

Manufacturing and hardware:

- Capex intensity
- Inventory turnover
- Supply-chain bargaining power
- Customer concentration
- Technology iteration risk
- Capacity utilization

## Fund and ETF Metrics

Use this section when the security is an ETF, index fund, active fund, or other pooled investment vehicle.

Required fund-wrapper metrics when available:

- NAV and market price
- AUM
- Expense ratio
- Distribution yield
- Beta vs relevant benchmark
- Premium / discount to NAV
- Tracking difference vs index
- Average daily volume

Required portfolio-level metrics when available:

- Number of holdings
- Top 5 and Top 10 weights
- Largest single-name weight
- Sector and country weights
- Portfolio weighted trailing P/E
- Portfolio weighted forward P/E
- Portfolio weighted NTM earnings growth estimate

Prohibited without relabeling:

- Treating the fund as if it has company revenue, net income, operating cash flow, Capex, FCF, ROE, or ROIC
- Using one holding's single-quarter YoY growth as the fund's growth rate
- Using secondary media forward P/E as portfolio forward P/E without issuer disclosure or a shown weighted calculation

Portfolio forward P/E rules:

- Prefer issuer disclosure when available.
- If calculated, show top-holding weights and forward P/E inputs, or provide a reproducible weighted formula.
- Label the result as `calculated`, not `reported`.
- If portfolio forward P/E cannot be verified, write `N/A` and explain the impact on valuation conclusions.

Fund data quality guidance:

- High: issuer fact sheet plus current holdings, and either issuer-disclosed portfolio P/E or a reproducible weighted calculation for key valuation metrics.
- Medium: holdings and fund-level data are reliable, but weighted forward P/E or portfolio growth requires estimates.
- Low: fund identity, holdings, expense ratio, or valuation inputs conflict materially.

## Tool Policy

Use tools to reduce hallucination, not to decorate the report.

Identify the security type before gathering valuation data:

- Single company -> use the company data order, source preference, cross-check rules, and computation rules below.
- ETF / index fund / active fund -> use fund data first: issuer fact sheet, prospectus, holdings page, index methodology, peer fund data, broad benchmark data, and holding-level consensus data when needed.
- Unknown -> stop and ask the user to confirm the security.

## Data Gathering Order

For companies:

1. Identify the company and security.
2. Gather company filings or reliable financial data.
3. Gather market data: price, market cap, enterprise value, share count.
4. Gather benchmark data: Nasdaq 100, CSI Dividend Index, relevant local index, and 10-year government bond yield.
5. Cross-check key values when possible.
6. Analyze only after data is labeled and quality-scored.

For funds and ETFs:

1. Issuer fact sheet, prospectus, annual / semi-annual report, and holdings page.
2. Index provider methodology document, or active mandate documents for active funds.
3. Exchange or regulator data for wrapper facts when needed.
4. Peer fund fee, AUM, holdings, tracking, liquidity, and valuation data.
5. Broad benchmark and risk-free-rate data.
6. Holding-level filings and consensus estimates only when needed for weighted valuation or growth attribution.

## Source Preference

For companies, prefer:

1. Official filings and investor relations materials
2. Exchange or regulator sources
3. Reliable financial data providers
4. Reputable news or research only for qualitative events

For funds, prefer:

1. Fund issuer fact sheet, prospectus, annual/semi-annual report, and holdings page
2. Index provider methodology document
3. Exchange or regulator filings for the fund wrapper
4. Underlying holding filings and primary market data
5. Reliable data providers for holding consensus estimates
6. Secondary media or community analysis only as leads, never as sole evidence for weighted forward P/E or portfolio growth

Do not use unsourced social media claims as evidence.

## Cross-Check Rules

Cross-check at least:

- Company identity and ticker
- Current market cap
- Latest revenue and net income
- Operating cash flow, Capex, and FCF
- Share count and dilution
- Net debt or net cash
- Benchmark and risk-free-rate data

For funds and ETFs, cross-check at least:

- Fund ticker, issuer, and tracked index or mandate
- Expense ratio and AUM
- Top 10 holdings and weights
- Portfolio trailing P/E if issuer-disclosed
- Weighted forward P/E if used in the verdict, labeled as issuer-disclosed, third-party disclosed, or calculated
- Peer fund identity, fee difference, and broad benchmark

If two reliable sources conflict materially, disclose the conflict and use the more primary source, or stop and ask the user if the conflict affects the verdict.

## Computation Rules

Calculate explicitly when possible:

- `FCF = Operating Cash Flow - Capex`
- `FCF Yield = FCF / Market Cap`
- `Earnings Yield = Net Income / Market Cap`
- `EV/FCF = Enterprise Value / FCF`
- `Cumulative FCF conversion = cumulative FCF / cumulative net income`
- `Net debt / EBITDA` when EBITDA and net debt are available
- `Portfolio implied NTM earnings growth ~= (Portfolio trailing P/E / Portfolio forward P/E) - 1`

Label units and currencies. Do not mix fiscal years, TTM, and quarterly values without saying so.

Stop and downgrade rules live in `gates.md`.
