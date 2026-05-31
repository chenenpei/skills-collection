---
name: stock-analysis-audit
description: Performs evidence-first stock analysis and valuation audits. Use when the user asks to analyze a stock, equity, listed company, ticker, valuation, moat, financial quality, opportunity cost versus indexes, or wants a Buffett/Munger/Graham-style investment audit.
---

# Stock Analysis Audit

Use this skill to analyze listed companies with an evidence-first workflow. The goal is not to prove a stock is worth buying; it is to decide whether the stock deserves single-name concentration risk versus index alternatives.

All conclusions are research assistance only and are not investment advice.

## Default Behavior

- Default to Lite screening unless the user explicitly asks for Deep, full audit, or complete analysis.
- Accept minimal input: company name, ticker, abbreviation, or business keyword.
- Identify the company before analyzing it.
- Default opportunity-cost benchmarks:
  - Nasdaq 100 for global large-cap growth and technology opportunity cost
  - CSI Dividend Index for high-dividend cash-return opportunity cost
  - Relevant 10-year government bond yield as the risk-free-rate baseline
- Add a local core index when the primary listing market is clear.

## Required References

Read only what is needed:

- For data rules: `references/data-contract.md`
- For execution flow: `references/workflow.md`
- For investment type classification: `references/classification-rules.md`
- For final report shapes: `references/output-templates.md`
- For tool use and stop conditions: `references/tool-policy.md`

For Lite analysis, read `data-contract.md`, `workflow.md`, `output-templates.md`, and `tool-policy.md`.

For Deep analysis, also read `classification-rules.md`.

## Bundled Prompt Kit (same directory)

This skill directory also ships maintainers' and Chatbot assets:

- `source/stock-analysis-audit-prompt.md` — canonical full spec
- `chatbot/` — staged prompts for tool-less chatbots
- `manuals/` — usage guides and examples
- `PROMPT-KIT.md` — overview

Do not load the entire `source/` file into context for routine analysis; use `references/` instead.

## Execution Rules

1. Identify the security first.
   - Confirm company full name, ticker, primary listing, trading currency, business, and possible ADR/share-class ambiguity.
   - If multiple candidates exist, stop and ask the user to choose.

2. Gather data before analysis.
   - Use available tools to collect company filings, market data, valuation data, and benchmark data.
   - Do not invent unavailable numbers. Use `N/A` and explain the impact.
   - If data quality is Low, final verdict must not exceed Watchlist.

3. Run the appropriate workflow.
   - Lite: company identity, data quality, business model, key financial snapshot, valuation/opportunity cost, top risks, preliminary verdict.
   - Deep: cross-cycle financials, industry-specific metrics, classification, moat, management, valuation, red-team risks, circle-of-competence, final verdict.

4. Use classification discipline.
   - Classify with necessary conditions, M/N supporting evidence, veto conditions, and industry exceptions.
   - Do not let one attractive metric hide a major flaw.

5. Produce a clear final verdict.
   - Choose exactly one: Reject, Watchlist, Medium-Term Revaluation Opportunity, High-Quality Company at Reasonable Price, High Conviction Candidate.
   - Include confidence, data quality, top supporting evidence, top opposing evidence, key falsification metric, and re-audit trigger.

## Stop and Ask

Stop instead of continuing when:

- Company identity is ambiguous.
- Data sources conflict on a key value and cannot be reconciled.
- The company is delisted, privatized, renamed, merged, or materially restructured and the current security is unclear.
- The user asks for an action framework but provides no circle-of-competence or risk context.
- Critical data is unavailable and the missing data would change the verdict.

Ask one question at a time. Prefer multiple-choice options when possible.

## Style

Use clear, direct, auditable language. Avoid vague phrases such as "looks promising" or "worth watching" unless conditions and evidence are stated. Do not treat low valuation as safety margin, and do not treat company quality as stock attractiveness.
