# Company Deep Audit

Use only when the user asks for Deep, full audit, or complete single-company analysis. Work one phase at a time. Do not proceed to the next phase until the current phase output is complete.

## Inputs

- Company / Ticker: `[fill in]`
- Confirmed listing venue: `[optional]`
- Prior Lite output: `[optional]`
- User circle-of-competence notes: `[optional]`

## Phase 1: Data Intake and Identity

Prerequisites: none.

Tasks:

1. Confirm company identity, ticker, listing venue, currency, business, and share-class ambiguity.
2. Request or gather data required by `spec/data.md`.
3. Label every key number with date, fiscal period, currency, source, and basis.
4. Score data quality.

STOP if identity confidence is not High or key data is missing and would change the verdict.

Output: company identification, data quality, missing data, and minimum next data needs.

## Phase 2: Cross-Cycle Financial Audit

Prerequisites: Phase 1 complete.

Tasks:

1. Build the 5-10 year financial table when possible.
2. Analyze revenue, margins, cash conversion, FCF, ROE/ROIC, share dilution, and balance sheet risk.
3. Apply sector-specific metrics from `spec/data.md`.
4. State whether financial evidence supports quality, mispricing, cigar-butt value, value trap, overpriced quality, or insufficient data.

STOP if financial data is too incomplete for a directional conclusion.

## Phase 3: Business Quality, Archetype, Moat, and Hidden Upside

Prerequisites: Phase 2 complete.

Tasks:

1. Answer business model questions.
2. Assign lifecycle stage.
3. Assign one business archetype when evidence supports it.
4. Run profit-pool destruction check.
5. Run hidden-upside check.
6. Score moat dimensions.
7. Rate management capital allocation.
8. Check circle of competence.

STOP if the analysis cannot separate temporary bad news from structural impairment.

## Phase 4: Valuation and Opportunity Cost

Prerequisites: Phase 3 complete.

Tasks:

1. Analyze valuation using P/E, EV/FCF, FCF Yield, Earnings Yield, dividend yield, and relevant sector metrics.
2. Compare opportunity cost against Nasdaq 100, CSI Dividend Index, relevant 10-year government yield, and local core index if relevant.
3. Explain whether current valuation requires unrealistic growth.

STOP if valuation depends on unavailable or conflicting key numbers.

## Phase 5: Classification, Red Team, and Final Verdict

Prerequisites: Phase 4 complete.

Tasks:

1. Classify investment type using `spec/classification.md`.
2. Run red team and inversion.
3. Produce final verdict using `spec/templates-company.md` Deep template.
4. Include falsification metric and re-audit trigger.
5. Include `## Structured Summary`.

Required Structured Summary fields:

- `data_quality`
- `business_archetype`
- `investment_classification`
- `final_verdict`

Do not skip classification before final Deep verdict.
