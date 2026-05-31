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
7. Run a lightweight potential misunderstanding check.
8. List the top three risks.
9. Give a preliminary verdict and required follow-up data.

Do not generate a 5-10 year table in Lite unless data is readily available and reliable.

## Deep Audit

Use Deep only when the user asks for it or when Lite shows enough evidence to justify further work.

Steps:

1. Identify the company and security.
2. Collect and label data according to `data-contract.md`.
3. Build a 5-10 year financial table when possible.
4. Analyze revenue, margins, cash conversion, FCF, ROE/ROIC, share dilution, and balance sheet risk.
5. Apply sector-specific metrics.
6. Run a profit-pool destruction check before valuation or positive classification.
7. Run a hidden upside check before rejecting the asset or classifying it as a value trap.
8. Classify investment type using `classification-rules.md`.
9. Audit moat and management.
10. Analyze valuation and opportunity cost.
11. Run red-team risks and inversion.
12. Check circle of competence.
13. Produce final verdict using `output-templates.md`.

## Profit-Pool Destruction Check

Before treating growth as durable or valuation as attractive, answer:

- Who does not need to profit from this product but can destroy its economics?
- Could an ecosystem owner, platform, hardware/OS vendor, upstream supplier, foundation model provider, channel, or regulator make the product free, bundled, technically obsolete, or uneconomic?
- What are 3-5 mechanisms that could drive long-term excess profits toward zero?
- Are those mechanisms already visible in leading indicators such as gross margin, usage cost, churn, ARPU, CAC, channel take rate, system bundling, free alternatives, or model/API dependency?

## Hidden Upside Check

Before classifying a disliked stock as a value trap or issuing a Reject verdict, test whether the market may be pricing the company with a stale or incomplete label.

Answer:

- What is the market's main reason for disliking the company?
- Is that reason a short-term cycle, narrative bias, transition pain, or permanent structural decline?
- Is there a mismatch between the old label and the current profit driver?
- Does the company have an underappreciated hidden asset such as ecosystem access, sticky user relationships, data, distribution, supply-chain position, service/software revenue, separable assets, improved capital allocation, or a new profit pool?
- Have the latest 2-4 quarters shown early evidence that the market has not repriced yet?
- If the market is wrong, where exactly is it wrong?
- If the analyst is wrong, what evidence proves this is only a value trap?

## Hidden Upside Evidence Checklist

Do not accept a hidden-upside thesis based on management storytelling. Look for hard evidence:

1. Cash-flow/profit scissors:
   - Bad headlines or falling net income, while operating cash flow or FCF is flat or rising.
   - Explain whether the cash strength comes from durable bargaining power, working-capital advantage, prepaid demand, or only from one-time payables stretch, investment cuts, or business shrinkage.

2. Counter-cyclical buybacks and real share count reduction:
   - Management repurchases aggressively when valuation is depressed, and diluted shares actually decline.
   - Do not treat buybacks as positive if they only offset SBC, are debt-funded under stress, or fail to reduce share count.

3. Quantitative spark in a new growth curve:
   - Segment revenue, backlog, orders, ARR, NDR, capacity utilization, customer count, or unit economics show early acceleration.
   - Reject PowerPoint-only transformation claims without financial statement or operating metric evidence.

4. Industry winter as clearing mechanism:
   - Weak competitors exit, lose access to funding, cut R&D, or lose customers while the company gains share, bargaining power, or strategic supply.
   - If the whole profit pool is permanently shrinking, it is not clearing; it is decline.

5. Cancer or cold:
   - Classify the core wound as cyclical demand delay, transition pain, clearing price war, permanent technical substitution, or business model failure.
   - Only cyclical delay, transition pain, or clearing price war can support hidden upside without stronger contrary evidence.

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
