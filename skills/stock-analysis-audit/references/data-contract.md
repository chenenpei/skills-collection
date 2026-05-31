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

## Stop Conditions

Stop or downgrade the analysis when:

- Company identity is not reliable.
- Current security cannot be mapped to the company because of delisting, merger, privatization, or share-class confusion.
- Key data sources materially conflict.
- No reliable basis exists for valuation or cash-flow quality.
