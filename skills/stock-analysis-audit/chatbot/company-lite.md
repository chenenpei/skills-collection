# Company Lite Screening

Use for default single-company screening after identity is confirmed.

## Prompt

Perform a Lite screening for:

- Company / Ticker: `[fill in]`
- Confirmed listing venue: `[optional]`
- User circle-of-competence notes: `[optional; mark insufficient if absent]`

If you cannot reliably access current data, do not invent data. Ask for the minimum missing data or produce a limited analysis using only provided data.

## Tasks

Follow the company Lite workflow:

1. Identify the company.
2. Gather a current financial and valuation snapshot.
3. Assess data quality.
4. Explain the business model.
5. Summarize key financial quality.
6. Compare valuation and opportunity cost against default benchmarks.
7. Run a lightweight potential misunderstanding check.
8. List the top three risks.
9. Give a preliminary verdict and required follow-up data.

## Required Checks

- Include profit-pool destruction before any positive verdict.
- Include hidden-upside check before Reject or strongly negative conclusions.
- Do not generate a 5-10 year table unless data is readily available and reliable.
- Use `N/A` for unverifiable values.
- If data quality is Low, final verdict must not exceed watchlist-level.
- Business archetype is optional in Lite. Use `N/A` if evidence is insufficient.

## Output

Follow `spec/templates-company.md` section `Lite Screening Template`.

Always include `## Structured Summary` with:

- `data_quality`
- `business_archetype` (`archetype_*` or `N/A`)
- `final_verdict`
