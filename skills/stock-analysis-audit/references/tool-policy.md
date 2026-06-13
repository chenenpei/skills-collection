# Tool Policy

Use tools to reduce hallucination, not to decorate the report.

## Security Type Branch

Identify the security type before gathering valuation data:

- Single company → use the company data order, source preference, cross-check rules, and computation rules below.
- ETF / index fund / active fund → use fund data first: issuer fact sheet, prospectus, holdings page, index methodology, peer fund data, broad benchmark data, and holding-level consensus data when needed.
- Unknown → stop and ask the user to confirm the security.

For detailed fund source priority and stop conditions, use `references/fund-workflow.md` section `Source Preference (Fund Version)`.

## Data Gathering Order

1. Identify the company or fund and security type.
2. Gather company filings or reliable financial data.
3. Gather market data: price, market cap, enterprise value, share count.
4. Gather benchmark data: Nasdaq 100, CSI Dividend Index, relevant local index, and 10-year government bond yield.
5. Cross-check key values when possible.
6. Analyze only after data is labeled and quality-scored.

For funds and ETFs, gather in this order:

1. Issuer fact sheet, prospectus, annual / semi-annual report, and holdings page.
2. Index provider methodology document, or active mandate documents for active funds.
3. Exchange or regulator data for wrapper facts when needed.
4. Peer fund fee, AUM, holdings, tracking, liquidity, and valuation data.
5. Broad benchmark and risk-free-rate data.
6. Holding-level filings and consensus estimates only when needed for weighted valuation or growth attribution.

## Source Preference

Prefer:

1. Official filings and investor relations materials
2. Exchange or regulator sources
3. Reliable financial data providers
4. Reputable news or research only for qualitative events

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

Label units and currencies. Do not mix fiscal years, TTM, and quarterly values without saying so.

## Stop Conditions

Stop and ask one question when:

- Multiple securities match the user keyword.
- The security has changed because of merger, delisting, privatization, or ticker change.
- The user asks for a decision framework but does not provide circle-of-competence or risk context.

Continue with downgrade when:

- Some non-critical data is missing but the direction is clear.
- Qualitative evidence is incomplete but financial data is sufficient for Lite.

Do not continue when:

- The identity is uncertain.
- Key valuation or cash-flow data is unavailable and would likely change the verdict.
- Data quality is Low but the user asks for a high-conviction conclusion.

## Reporting Rules

- Cite source names or URLs when available.
- Distinguish facts, calculations, and judgments.
- Use `N/A` for missing values.
- State the impact of missing data.
- Do not imply certainty beyond the data quality score.
