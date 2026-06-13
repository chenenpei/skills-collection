# Data Contract

Use this reference whenever stock analysis requires financial, market, or benchmark data.

## Required Metadata

Every key number must include:

- Data date
- Fiscal period
- Currency
- Source
- Accounting or calculation basis, such as TTM, annual, quarterly, GAAP, non-GAAP, adjusted, or estimated

If a number cannot be verified, write `N/A`. Do not fabricate, smooth, interpolate, or fill values to complete a table.

## Free Cash Flow

Default definition:

`FCF = Operating Cash Flow - Capital Expenditure`

If using another definition, explain why and label it clearly.

## Data Quality

Use:

- High: primary filings or reliable data providers support most key values, and dates/periods are clear.
- Medium: enough reliable data exists for a directional conclusion, but some values are missing, delayed, or require estimates.
- Low: key identity, financial, valuation, or benchmark data is missing or conflicting.

If data quality is Low, the final verdict must not exceed Watchlist.

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

Use this section when the security is an ETF, index fund, or other pooled fund vehicle.

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

If fund data quality is Low, the final fund verdict must not exceed Watchlist.

## Stop Conditions

Stop or downgrade the analysis when:

- Company identity is not reliable.
- Current security cannot be mapped to the company because of delisting, merger, privatization, or share-class confusion.
- Fund identity, tracked index, or peer fund is ambiguous.
- Issuer and third-party data conflict materially on AUM, expense ratio, or portfolio valuation inputs used in the verdict.
- Key data sources materially conflict.
- No reliable basis exists for valuation or cash-flow quality.
