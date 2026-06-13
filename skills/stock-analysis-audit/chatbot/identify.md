# Identify Security

Use after `system.md`. Do not produce financial analysis, valuation analysis, or a verdict in this step.

## Prompt

Identify the security from this keyword:

`[company name / ticker / fund name / ETF ticker / abbreviation / business or exposure keyword]`

## Tasks

1. List the most likely security.
2. Identify ticker, security type, primary listing venue, and trading currency.
3. Classify security type:
   - `security_single_company`
   - `security_etf_or_index_fund`
   - `security_active_fund`
   - `security_other_pooled_vehicle`
   - unclear
4. If single company, note main business and ADR, dual listing, A/H share, share-class, or same-name ambiguity.
5. If fund or ETF, note issuer/sponsor, tracked index or active mandate, expense ratio if available, and closest peer fund candidates.
6. Assign identification confidence: High / Medium / Low.

## Stop Rules

- If multiple reasonable candidates exist, stop and ask the user to choose one.
- If ticker, listing venue, share class, fund wrapper, tracked index, or security type cannot be confirmed, ask one question only.
- Do not invent financial data, valuation, holdings, or fund metrics.

## Output

```markdown
## Security Identification

- Identified security:
- Ticker:
- Security type:
- Primary listing:
- Trading currency:
- Single-company notes:
- Fund / ETF notes:
- Potential ambiguity:
- Identification confidence:

## Next Step

- If High confidence and single company: use `company-lite.md` by default.
- If High confidence and fund/ETF: use `fund-lite.md` by default.
- If not High confidence: ask the minimum confirmation question.
```
