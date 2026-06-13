# Company Workflow

Scope: single operating companies only. For ETFs, index funds, active funds, and other pooled vehicles, use `workflow-fund.md`.

Terms live in `../CONTEXT.md`. Data rules live in `data.md`. Stop and downgrade rules live in `gates.md`.

## 0. Company Identification

Before any financial analysis, identify:

- Company full name
- Ticker
- Primary listing venue
- Trading currency
- Main business
- ADR, dual listing, A/H share, share-class, or same-name ambiguity

Gate: if identification confidence is not High, stop and ask the user to confirm.

## Lite Screening

Use Lite by default. It answers whether the stock deserves more research.

Steps:

1. Identify the company.
2. Gather a current financial and valuation snapshot.
3. Assess data quality.
4. Explain the business model.
5. Summarize key financial quality.
6. Compare valuation and opportunity cost against default benchmarks.
7. Run a lightweight potential misunderstanding check.
8. List the top three risks.
9. Give a preliminary verdict and required follow-up data.

Gate: do not generate a 5-10 year table in Lite unless data is readily available and reliable.

Gate: Lite may include a `business_archetype` row in Structured Summary if evidence supports it; otherwise use `N/A`.

## Deep Audit

Use Deep only when the user asks for it or when Lite shows enough evidence to justify further work.

Steps:

1. Identify the company and security.
2. Collect and label data according to `data.md`.
3. Build a 5-10 year financial table when possible.
4. Analyze revenue, margins, cash conversion, FCF, ROE/ROIC, share dilution, and balance sheet risk.
5. Apply sector-specific metrics.
6. Run a profit-pool destruction check before valuation or positive classification.
7. Run a hidden upside check before rejecting the asset or classifying it as `classification_value_trap`.
8. Classify investment type using `classification.md`.
9. Audit moat and management.
10. Analyze valuation and opportunity cost.
11. Run red-team risks and inversion.
12. Check circle of competence.
13. Produce final verdict using `templates-company.md`.

Gate: Deep must include `business_archetype`, `investment_classification`, and `final_verdict` in Structured Summary.

Gate: do not run valuation before the profit-pool destruction check.

Gate: do not produce final Deep verdict without `classification.md`.

## Business Model Questions

Answer:

- What does the company sell?
- Who is the customer and who pays?
- Is revenue subscription, transaction-based, one-time, cyclical, spread-based, advertising, licensing, or another model?
- Why do customers choose it?
- What is the cost of switching away?
- Does it depend on one customer, upstream platform, regulation, commodity price, supply chain, or capital market condition?
- Which lifecycle stage applies: `lifecycle_chaotic`, `lifecycle_evidence_established`, `lifecycle_fully_priced`, or `lifecycle_declining`?
- Which business archetype applies, if evidence is sufficient: `archetype_toll_road`, `archetype_quasi_toll_road`, `archetype_gold_in_quicksand`, `archetype_cyclical_asset`, or `archetype_financial_leverage_asset`?

Do not use a business archetype as an investment classification or final verdict.

## Cross-Cycle Financial Audit

For Deep, use the past 5-10 years when possible. If the company has a shorter listing history, use all available history.

Analyze:

- Whether revenue growth is stable or depends on cycle, acquisitions, price increases, or one-time factors
- Structural trends in gross margin and operating margin
- Whether cumulative operating cash flow covers cumulative net income
- Whether FCF is sustainable or comes from underinvestment, delayed payments, layoffs, or one-time effects
- Whether ROE/ROIC comes from operating advantage, leverage, buybacks, low equity base, or cycle peak
- Whether diluted shares are increasing
- Whether debt, interest expense, and maturities amplify stress risk

## Sector-Specific Metrics

Use `data.md` section `Sector Adjustments`. Do not apply one generic metric set mechanically across industries.

## Moat and Management

Score each moat dimension High, Medium, or Low:

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

Gate: if circle of competence is weak, do not assign `verdict_high_conviction`.

## Shared Checks

Use `gates.md` for:

- Profit-pool destruction check
- Company hidden-upside check
- Stop conditions
- Downgrade conditions
- Structured Summary requirements
