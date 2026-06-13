# Fund Lite Screening

Use for default ETF, index fund, active fund, or pooled vehicle screening after identity is confirmed.

## Prompt

Perform a Lite fund screening for:

- Fund / Ticker: `[fill in]`
- Confirmed security type: `[ETF / index fund / active fund / other pooled vehicle]`
- Desired exposure: `[optional]`
- Known peer fund: `[optional]`
- User circle-of-competence notes: `[optional]`

If you cannot reliably access current data, do not invent data. Ask for the minimum missing fund data or produce a limited analysis using only provided data.

## Tasks

Follow the fund Lite workflow:

1. Identify the fund and at least one peer alternative.
2. Gather fund-level and portfolio-level data.
3. Assess data quality, especially weighted forward P/E and growth estimates.
4. Explain what exposure the fund actually delivers.
5. Summarize portfolio anatomy.
6. Compare valuation, cost, risk, liquidity, and tracking versus benchmarks and peers.
7. Run growth attribution check.
8. Run bull-side debunking and bear-side hidden re-pricing.
9. Run exposure-level profit-pool destruction check.
10. List top fund-specific risks.
11. Give a preliminary fund verdict.

## Required Checks

- Do not fill company revenue, net income, OCF, Capex, FCF, ROE, or ROIC at fund level.
- Do not use one holding's growth as fund growth.
- Label portfolio forward P/E as issuer-disclosed, third-party disclosed, calculated, or `N/A`.
- Compare at least one peer fund and one broad benchmark before any positive verdict.
- If data quality is Low, final verdict must not exceed watchlist-level.

## Output

Follow `spec/templates-fund.md` section `Lite Fund Screening Template`.

Always include `## Structured Summary` with:

- `data_quality`
- `final_verdict`
- `portfolio_role`
