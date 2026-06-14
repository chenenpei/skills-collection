# Company Output Templates

Scope: single companies only. Use `templates-fund.md` for ETFs, index funds, active funds, and other pooled vehicles.

Render headings and narrative in the user's requested language. Use stable slugs from `../CONTEXT.md` in `Structured Summary`.

## Rendering Rules

- Use user-language labels in prose.
- Use slugs in `Structured Summary`.
- Include `N/A` for missing values and explain impact.
- Distinguish facts, calculations, and judgments.
- Cite source names or URLs when available.
- Do not imply certainty beyond data quality.

## Lite Screening Template

Required sections:

1. One-Sentence Verdict
2. Company Identification
3. Data Quality and Missing Items
4. Business Model
5. Financial Snapshot
6. Valuation and Opportunity Cost
7. Profit Pool Destruction Check
8. Potential Misunderstanding
9. Top Three Risks
10. Preliminary Verdict
11. Data Needed for Further Work
12. Structured Summary

```markdown
## 1. One-Sentence Verdict

Final verdict: [rendered label from `final_verdict` slug]
Confidence: [1-5]
Data quality: [High / Medium / Low]

## 2. Company Identification

- Company:
- Ticker:
- Primary listing:
- Trading currency:
- Business:
- Identity ambiguity:

## 3. Data Quality and Missing Items

- As-of date:
- Latest fiscal period:
- Main sources:
- Missing or unreliable data:

## 4. Business Model

- How it makes money:
- Customers and payers:
- Revenue type:
- Main dependencies:
- Lifecycle stage:
- Business archetype: [rendered label or N/A]

## 5. Financial Snapshot

| Metric | Value | Basis | Date | Source |
|---|---:|---|---|---|
| Revenue growth |  |  |  |  |
| Gross margin |  |  |  |  |
| Net income |  |  |  |  |
| Operating cash flow |  |  |  |  |
| FCF |  |  |  |  |
| ROE/ROIC |  |  |  |  |
| Net cash/debt |  |  |  |  |

## 6. Valuation and Opportunity Cost

| Metric | Stock | Benchmark / risk-free asset | Comment |
|---|---:|---:|---|
| P/E |  |  |  |
| EV/FCF |  |  |  |
| FCF Yield |  |  |  |
| Dividend yield |  |  |  |
| 10-year government yield |  |  |  |

## 7. Profit Pool Destruction Check

- Who can destroy the product without needing to profit from it:
- Mechanism:
- Evidence now:
- Valuation/verdict impact:

## 8. Potential Misunderstanding

- Market's main reason for disliking the stock:
- Is it cyclical, narrative-driven, transition pain, or structural decline:
- Possible outdated business classification or underappreciated asset:
- Evidence from the latest 2-4 quarters:
- Quick evidence check: [net-income/cash-flow divergence / buybacks / segment-level growth evidence / competitive consolidation / cyclical-vs-structural impairment]
- What would disprove the underappreciated-upside case:

## 9. Top Three Risks

1.
2.
3.

## 10. Preliminary Verdict

- Verdict:
- Supporting evidence:
- Opposing evidence:
- Key falsification metric:
- Re-audit trigger:

## 11. Data Needed for Further Work

-

## Structured Summary

| field | slug | label |
|---|---|---|
| data_quality | data_quality_[high/medium/low] | [rendered label] |
| business_archetype | [archetype_* or N/A] | [rendered label or N/A] |
| final_verdict | verdict_* | [rendered label] |
```

## Deep Audit Template

Required sections:

1. Final Verdict
2. Company Identification
3. Data Quality
4. Business Model
5. Cross-Cycle Financials
6. Sector-Specific Metrics
7. Profit Pool Destruction Check
8. Hidden Upside Check
9. Hidden Upside Evidence
10. Investment Type Classification
11. Moat and Management
12. Valuation and Opportunity Cost
13. Inversion and Red Team
14. Circle of Competence
15. Action Framework
16. Falsification
17. Final Three Questions
18. Structured Summary

```markdown
## 1. Final Verdict

Final verdict: [rendered label from `final_verdict` slug]
Confidence: [1-5]
Data quality: [High / Medium / Low]

## 2. Company Identification

- Company:
- Ticker:
- Primary listing:
- Trading currency:
- Business:
- Security/share-class notes:

## 3. Data Quality

- As-of date:
- Latest fiscal period:
- Main sources:
- Missing or unreliable data:
- Impact of missing data:

## 4. Business Model

- Products/services:
- Customers and payers:
- Revenue type:
- Switching cost:
- Main dependencies:
- Lifecycle stage:
- Business archetype:

## 5. Cross-Cycle Financials

| Year | Revenue | Gross margin | Operating margin | Net income | OCF | Capex | FCF | ROE/ROIC | Diluted shares | Net debt/cash |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|

## 6. Sector-Specific Metrics

- For healthcare/pharma routed candidates (`routed_templates` includes `healthcare`), use `data.md` **Healthcare and pharma** metrics.

- Most important sector metrics:
- Company performance:
- Red flags:

## 7. Profit Pool Destruction Check

| Destroyer | Mechanism | Evidence now | Leading indicator | Valuation/classification impact |
|---|---|---|---|---|

## 8. Hidden Upside Check

| Question | Evidence | Implication |
|---|---|---|
| Market's main reason for disliking the company |  |  |
| Short-term cycle, narrative bias, transition pain, or structural decline |  |  |
| Outdated business classification vs current profit driver |  |  |
| Underappreciated asset or second profit pool |  |  |
| Latest 2-4 quarter evidence |  |  |
| Evidence that would prove value trap |  |  |

Bottom line: [market misunderstanding / no credible underappreciated upside / inconclusive]

## 9. Hidden Upside Evidence

| Evidence gate | What to check | Evidence | Verdict impact |
|---|---|---|---|
| Net-income/cash-flow divergence | Net income falls or headlines are negative while OCF/FCF is flat or rising; distinguish durable bargaining power from one-time working-capital changes |  |  |
| Counter-cyclical buybacks | Repurchases occur at depressed valuation and diluted share count actually declines; exclude SBC-offset or stressed debt-funded buybacks |  |  |
| Early quantitative evidence of a new growth driver | Segment revenue, backlog, orders, ARR, NDR, capacity utilization, customers, or unit economics show early acceleration |  |  |
| Downturn-driven competitive consolidation | Weak competitors exit or lose share while the company gains share, bargaining power, or strategic supply |  |  |
| Cyclical vs structural impairment | Classify the impairment as cyclical delay, transition pain, competition-consolidating price war, permanent technical substitution, or business model failure |  |  |

## 10. Investment Type Classification

- Primary classification:
- Necessary conditions:
- Supporting evidence hit rate: [M/N]
- Veto conditions triggered:
- Sector exceptions:

## 11. Moat and Management

| Dimension | Rating | Supporting evidence | Opposing evidence |
|---|---|---|---|
| Switching cost |  |  |  |
| Pricing power |  |  |  |
| Network effects |  |  |  |
| Scale economies |  |  |  |
| Brand or trust |  |  |  |
| Data/workflow lock-in |  |  |  |
| Regulation or license barrier |  |  |  |
| Upstream/platform/customer dependence |  |  |  |

Management conclusion: [Excellent / Acceptable / Questionable / Poor / Insufficient data]

## 12. Valuation and Opportunity Cost

| Metric | Stock | Nasdaq 100 | CSI Dividend | 10Y government bond | Comment |
|---|---:|---:|---:|---:|---|
| FCF Yield |  |  |  |  |  |
| Earnings Yield |  |  |  |  |  |
| Dividend yield |  |  |  |  |  |
| Expected growth |  |  |  |  |  |
| Drawdown risk |  |  |  |  |  |
| Research burden |  |  |  |  |  |

## 13. Inversion and Red Team

| Risk scenario | Trigger | Evidence now | Probability | Impact | Leading indicator |
|---|---|---|---|---|---|

Strongest bear case:

Fact-based rebuttal:

## 14. Circle of Competence

- Understands business model:
- Understands industry variables:
- Can track leading indicators:
- Can distinguish temporary from structural bad news:
- Has information or experience advantage:

## 15. Action Framework

- Action:
- Position limit if applicable:
- Add condition:
- Reduce condition:
- Exit condition:

## 16. Falsification

- Key falsification metric:
- Re-audit trigger:

## Final Three Questions

1. Is this stock worth extra concentration risk versus indexes?
2. Which fact is most likely to overturn the conclusion?
3. If not buying now, what should change before re-audit?

## Structured Summary

| field | slug | label |
|---|---|---|
| data_quality | data_quality_[high/medium/low] | [rendered label] |
| business_archetype | archetype_* | [rendered label] |
| investment_classification | classification_* | [rendered label] |
| final_verdict | verdict_* | [rendered label] |
```
