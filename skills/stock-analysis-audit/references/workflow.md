# Workflow

## Company Identification

Before any financial analysis, identify:

- Company full name
- Ticker
- Primary listing venue
- Trading currency
- Main business
- ADR, dual listing, A/H share, share-class, or same-name ambiguity

If identification confidence is not High, ask the user to confirm.

## Lite Screening

Use Lite by default. It answers whether the stock deserves more research.

Steps:

1. Identify the company.
2. Gather a current financial and valuation snapshot.
3. Assess data quality.
4. Explain the business model.
5. Summarize key financial quality.
6. Compare valuation and opportunity cost against default benchmarks.
7. List the top three risks.
8. Give a preliminary verdict and required follow-up data.

Do not generate a 5-10 year table in Lite unless data is readily available and reliable.

## Deep Audit

Use Deep only when the user asks for it or when Lite shows enough evidence to justify further work.

Steps:

1. Identify the company and security.
2. Collect and label data according to `data-contract.md`.
3. Build a 5-10 year financial table when possible.
4. Analyze revenue, margins, cash conversion, FCF, ROE/ROIC, share dilution, and balance sheet risk.
5. Apply sector-specific metrics.
6. Classify investment type using `classification-rules.md`.
7. Audit moat and management.
8. Analyze valuation and opportunity cost.
9. Run red-team risks and inversion.
10. Check circle of competence.
11. Produce final verdict using `output-templates.md`.

## Business Model Questions

Answer:

- What does the company sell?
- Who is the customer and who pays?
- Is revenue subscription, transaction-based, one-time, cyclical, spread-based, advertising, licensing, or another model?
- Why do customers choose it?
- What is the cost of switching away?
- Does it depend on one customer, upstream platform, regulation, commodity price, supply chain, or capital market condition?
- Which lifecycle stage applies: chaotic, evidence-established, fully priced, or declining?

## Moat and Management

Score each dimension High, Medium, or Low:

- Switching cost
- Pricing power
- Network effects
- Scale economies
- Brand or trust
- Data or workflow lock-in
- Regulation or license barriers
- Upstream, platform, or major customer dependence

Management conclusion must be one of:

- Excellent capital allocator
- Acceptable capital allocator
- Questionable capital allocator
- Poor capital allocator
- Insufficient data

## Circle of Competence

Check whether the user understands:

- How the company earns money
- The key industry variables
- The leading indicators to track
- Whether bad news is temporary or structural
- Whether they have informational or experiential advantage

If circle of competence is weak, do not assign High Conviction Candidate.
