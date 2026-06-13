# Fund Deep Audit

Use only when the user asks for Deep, full audit, or complete fund analysis. Work one phase at a time. Do not proceed to the next phase until the current phase output is complete.

## Inputs

- Fund / Ticker: `[fill in]`
- Confirmed security type: `[ETF / index fund / active fund / other pooled vehicle]`
- Desired exposure: `[optional]`
- Peer set: `[optional]`
- Prior Lite output: `[optional]`

## Phase 1: Data, Wrapper, and Methodology

Prerequisites: fund identity is confirmed.

Tasks:

1. Confirm fund name, ticker, issuer, fund type, listing venue, currency, tracked index or mandate, share class, expense ratio, AUM, and peer set.
2. Gather issuer fact sheet, prospectus, holdings page, index methodology, peer fund data, broad benchmark data, and risk-free rate.
3. Assess data quality.
4. Document index methodology: weighting scheme, rebalance frequency, concentration rules, inclusion rules.

STOP if fund identity, tracked index, peer fund, or product structure is ambiguous.

## Phase 2: Portfolio Anatomy and Growth Attribution

Prerequisites: Phase 1 complete.

Tasks:

1. Build holdings anatomy table for top 10-20 names when available.
2. Calculate or cite portfolio weighted trailing P/E and weighted forward P/E.
3. Estimate portfolio weighted NTM earnings growth.
4. Separate leader contribution from drag names and distorted P/E names.
5. Compare wrapper quality, cost, liquidity, tracking, tax characteristics, and structure risk versus peers.

STOP if weighted forward P/E cannot be verified and valuation is central to the verdict.

## Phase 3: Exposure-Level Checks and Misunderstanding Audit

Prerequisites: Phase 2 complete.

Tasks:

1. Analyze underlying industry cycle and exposure-level profit-pool destruction.
2. Run bull-side debunking.
3. Run bear-side hidden re-pricing check.
4. Check whether market narratives misunderstand wrapper, portfolio, or a few leader holdings.
5. Analyze fund-specific risks.

STOP if the report cannot validate growth claims at portfolio level.

## Phase 4: Red Team, Portfolio Role, and Final Verdict

Prerequisites: Phase 3 complete.

Tasks:

1. Run red team and inversion on the fund as a tool, not as a company.
2. Check circle of competence for the exposure and wrapper.
3. Define best portfolio role: core, satellite, tactical, watch, or avoid.
4. Produce final verdict using `spec/templates-fund.md` Deep template.
5. Include falsification metric and re-audit trigger.
6. Include `## Structured Summary`.

Required Structured Summary fields:

- `data_quality`
- `final_verdict`
- `portfolio_role`

Do not assign company investment classification to the fund.
