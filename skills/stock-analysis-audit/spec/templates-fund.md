# Fund and ETF Output Templates

Scope: ETFs, index funds, active funds, and other pooled vehicles.

Do not use company verdict labels unless explicitly mapping back to a single-stock decision inside the fund. Fund verdicts describe tool quality and role, not operating-business quality.

Render headings and narrative in the user's requested language. Use stable slugs from `../CONTEXT.md` in `Structured Summary`.

## Lite Fund Screening Template

Required sections:

1. One-Sentence Verdict
2. Fund Identification
3. Data Quality and Missing Items
4. Exposure Summary
5. Fund Wrapper Snapshot
6. Portfolio Anatomy
7. Top Holdings and Growth Attribution
8. Valuation and Opportunity Cost
9. Peer Fund Comparison
10. Industry Profit-Pool Destruction Check
11. Bull-side Misunderstanding
12. Bear-side Hidden Re-pricing Check
13. Top Three Risks
14. Preliminary Verdict
15. Data Needed for Further Work
16. Structured Summary

```markdown
## 1. One-Sentence Verdict

Final verdict: [rendered label from `final_verdict` slug]
Confidence: [1-5]
Data quality: [High / Medium / Low]

## 2. Fund Identification

- Fund:
- Ticker:
- Fund type:
- Primary listing:
- Trading currency:
- Issuer:
- Index tracked / mandate:
- Peer fund(s) compared:
- Identity ambiguity:

## 3. Data Quality and Missing Items

- As-of date:
- Main sources:
- Issuer-disclosed metrics used:
- Calculated metrics used:
- Missing or unreliable data:
- Impact of missing data:

## 4. Exposure Summary

- What economic exposure this fund provides:
- Index weighting scheme:
- Rebalance / reconstitution notes:
- Why an investor would use this instead of a broad index:
- Lifecycle of the underlying exposure:

## 5. Fund Wrapper Snapshot

| Metric | Value | Basis | Date | Source |
|---|---:|---|---|---|
| NAV / market price |  |  |  |  |
| AUM |  |  |  |  |
| Expense ratio |  |  |  |  |
| Distribution yield |  |  |  |  |
| Beta vs benchmark |  |  |  |  |
| Premium / discount to NAV |  |  |  |  |
| Tracking difference |  |  |  |  |
| Average daily volume |  |  |  |  |

## 6. Portfolio Anatomy

| Metric | Value | Basis | Date | Source |
|---|---:|---|---|---|
| Number of holdings |  |  |  |  |
| Top 5 weight |  |  |  |  |
| Top 10 weight |  |  |  |  |
| Largest single-name weight |  |  |  |  |
| Sector / country concentration |  |  |  |  |
| Portfolio weighted trailing P/E |  |  |  |  |
| Portfolio weighted forward P/E |  | issuer / calculated |  |  |
| Portfolio implied NTM earnings growth |  | trailing P/E / forward P/E - 1 |  |  |
| Portfolio consensus NTM earnings growth |  | weighted estimate |  |  |

## 7. Top Holdings and Growth Attribution

| Holding | Weight % | Trailing P/E | Forward P/E | NTM earnings growth | Role [leader / core / drag / distorted] |
|---|---:|---:|---:|---:|---|

Growth attribution conclusion:

- Leader-driven contribution:
- Drag names:
- Can leader growth be extrapolated to the portfolio? [Yes / No / Partially]
- Why:

## 8. Valuation and Opportunity Cost

| Metric | Fund | Peer fund / benchmark | Comment |
|---|---:|---:|---|
| Expense ratio |  |  |  |
| Portfolio trailing P/E |  |  |  |
| Portfolio forward P/E |  |  |  |
| Distribution yield |  |  |  |
| Beta |  |  |  |
| YTD / 1Y return |  |  |  |
| 10-year government yield |  |  |  |

Required comparisons:

- Versus broad benchmark:
- Versus cash-return benchmark if relevant:
- Versus closest peer fund:

## 9. Peer Fund Comparison

| Item | This fund | Peer fund | Broad benchmark | Comment |
|---|---|---|---|---|
| Expense ratio |  |  |  |  |
| Holdings count |  |  |  |  |
| Top 10 weight |  |  |  |  |
| Portfolio forward P/E |  |  |  |  |
| Beta |  |  |  |  |
| Main advantage |  |  |  |  |
| Main disadvantage |  |  |  |  |

Peer conclusion:

- Why this fund, if any:
- Why not the peer:

## 10. Industry Profit-Pool Destruction Check

- Underlying exposure:
- Who can destroy the profit pool without needing to profit from it:
- Mechanism:
- Evidence now:
- Impact on fund verdict:

## 11. Bull-side Misunderstanding

- Bullish claim being evaluated:
- Layer of the claim: [wrapper / portfolio / single holding / media narrative]
- Is trailing P/E compression real de-rating or earnings catch-up to price?
- Is leader growth being mistaken for portfolio growth?
- Does industry optimism equal fund alpha?
- What would disprove the bullish claim:

## 12. Bear-side Hidden Re-pricing Check

- Main bear narrative:
- Bear narrative type: [cyclical / narrative bias / transition pain / structural decline]
- Is the market using an outdated exposure classification?
- Portfolio-level evidence bears may be missing:
  - Trailing vs forward P/E gap:
  - Implied growth vs consensus growth:
  - Latest 2-4 quarter evidence:
- Evidence gate hit: [earnings catch-up / implied-vs-consensus gap / cyclical recovery / peer misunderstanding / none]
- If bears are wrong, where exactly:
- If the analyst is wrong, what proves this is only a peak-cycle illusion:
- Bottom line: [exposure misunderstanding / partial re-pricing / no credible hidden upside / inconclusive]
- Verdict impact:

## 13. Top Three Risks

1.
2.
3.

## 14. Preliminary Verdict

- Verdict:
- Best role in portfolio: [core / satellite / tactical / avoid]
- Supporting evidence:
- Opposing evidence:
- Key falsification metric:
- Re-audit trigger:

## 15. Data Needed for Further Work

-

## Structured Summary

| field | slug | label |
|---|---|---|
| data_quality | data_quality_[high/medium/low] | [rendered label] |
| final_verdict | verdict_fund_* | [rendered label] |
| portfolio_role | [core / satellite / tactical / avoid / watch] | [rendered label] |
```

## Deep Fund Audit Template

Required sections:

1. Final Verdict
2. Fund Identification
3. Data Quality
4. Index Methodology
5. Fund Wrapper Quality
6. Portfolio Anatomy
7. Top Holdings Table
8. Growth Attribution
9. Historical Performance and Cycle Context
10. Industry Profit-Pool Destruction Check
11. Hidden Upside Check at Exposure Level
12. Valuation and Opportunity Cost
13. Red Team and Inversion
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

## 2. Fund Identification

- Fund:
- Ticker:
- Fund type:
- Primary listing:
- Trading currency:
- Issuer:
- Index tracked / mandate:
- Share class / hedging notes:
- Peer fund(s) compared:
- Identity ambiguity:

## 3. Data Quality

- As-of date:
- Main sources:
- Issuer-disclosed metrics used:
- Calculated metrics used:
- Missing or unreliable data:
- Impact of missing data:

## 4. Index Methodology

- Index provider:
- Weighting scheme:
- Number of holdings:
- Rebalance frequency:
- Reconstitution rules:
- Inclusion / exclusion rules:
- Methodology risks:

## 5. Fund Wrapper Quality

| Metric | Value | Peer / benchmark | Comment |
|---|---:|---:|---|
| Expense ratio |  |  |  |
| AUM |  |  |  |
| Average daily volume |  |  |  |
| Premium / discount to NAV |  |  |  |
| Tracking difference (1Y / 3Y) |  |  |  |
| Distribution yield |  |  |  |
| Tax / distribution character |  |  |  |

Wrapper conclusion:

## 6. Portfolio Anatomy

| Metric | Fund | Peer fund | Benchmark | Source |
|---|---:|---:|---:|---|
| Holdings count |  |  |  |  |
| Top 5 weight |  |  |  |  |
| Top 10 weight |  |  |  |  |
| Largest single-name weight |  |  |  |  |
| Portfolio weighted trailing P/E |  |  |  |  |
| Portfolio weighted forward P/E |  |  |  |  |
| Portfolio implied NTM earnings growth |  |  |  |  |
| Portfolio consensus NTM earnings growth |  |  |  |  |
| Beta |  |  |  |  |

## 7. Top Holdings Table

| Holding | Weight % | Trailing P/E | Forward P/E | NTM earnings growth | Revenue growth | Role | Key risk |
|---|---:|---:|---:|---:|---:|---|---|

Leader / drag summary:

## 8. Growth Attribution

- Portfolio implied NTM earnings growth:
- Portfolio consensus NTM earnings growth:
- Extreme contributors:
- Drag names:
- Is the portfolio being priced like leaders only? [Yes / No / Partially]
- Required portfolio growth to justify current price:

## 9. Historical Performance and Cycle Context

| Period | Fund return | Peer return | Benchmark return | Comment |
|---|---:|---:|---:|---|
| YTD |  |  |  |  |
| 1Y |  |  |  |  |
| 3Y |  |  |  |  |
| 5Y |  |  |  |  |
| Worst recent drawdown |  |  |  |  |

Cycle conclusion:

- Is recent performance mostly beta, concentration, or valuation expansion?

## 10. Industry Profit-Pool Destruction Check

| Destroyer | Mechanism | Evidence now | Leading indicator | Impact on exposure |
|---|---|---|---|---|

Strongest bear case for the underlying exposure:

## 11. Hidden Upside Check (Exposure Level)

- Main reason the exposure is disliked:
- Cyclical, narrative, transition pain, or structural issue:
- Is the market treating the exposure with an outdated classification?
- Early evidence from latest 2-4 quarters:
- What would prove this is only a cyclical or narrative overshoot:

Bottom line: [exposure misunderstanding / no credible underappreciated upside / inconclusive]

## 12. Valuation and Opportunity Cost

| Metric | Fund | Peer fund | Nasdaq 100 / local core index | CSI Dividend | 10Y government bond | Comment |
|---|---:|---:|---:|---:|---:|---|
| Expense ratio |  |  |  |  |  |  |
| Portfolio trailing P/E |  |  |  |  |  |  |
| Portfolio forward P/E |  |  |  |  |  |  |
| Distribution yield |  |  |  |  |  |  |
| Beta |  |  |  |  |  |  |
| Earnings yield (1 / forward P/E) |  |  |  |  |  |  |

## 13. Red Team and Inversion

| Risk scenario | Trigger | Evidence now | Probability | Impact | Leading indicator |
|---|---|---|---|---|---|

Strongest bear case against using this fund now:

Fact-based rebuttal:

## 14. Circle of Competence

- Understands the exposure:
- Understands index / peer differences:
- Can track leading indicators:
- Can distinguish temporary from structural bad news:
- Knows whether this is core, satellite, or tactical:

## 15. Action Framework

- Recommended role: [avoid / watch / satellite / core / tactical]
- Versus peer fund:
- Versus broad benchmark:
- Add condition:
- Reduce condition:
- Exit condition:

## 16. Falsification

- Key falsification metric:
- Re-audit trigger:

## Final Three Questions

1. Is this fund a better tool than the relevant peer fund and broad benchmark for the exposure the user wants?
2. Which fact is most likely to overturn the conclusion?
3. If not using it now, what should change before re-audit?

## Structured Summary

| field | slug | label |
|---|---|---|
| data_quality | data_quality_[high/medium/low] | [rendered label] |
| final_verdict | verdict_fund_* | [rendered label] |
| portfolio_role | [core / satellite / tactical / avoid / watch] | [rendered label] |
```

## Required Closing Rules

Every fund report must explicitly state:

1. Whether the verdict applies to the fund as a tool, not the underlying industry alone.
2. Whether portfolio forward P/E was issuer-disclosed or calculated, with source or formula shown.
3. Whether bullish growth claims were validated at portfolio level, not leader level only.
4. Whether bearish narratives were tested for hidden re-pricing evidence before issuing Reject or cautious verdicts.
5. Which peer fund and broad benchmark were used in the comparison.
6. The best portfolio role: core, satellite, tactical, or avoid.
