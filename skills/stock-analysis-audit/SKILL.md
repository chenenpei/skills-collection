---
name: stock-analysis-audit
description: Performs evidence-first stock analysis and valuation audits. Use when the user asks to analyze a stock, equity, listed company, ETF, index fund, fund, ticker, valuation, moat, financial quality, opportunity cost versus indexes, or wants a Buffett/Munger/Graham-style investment audit.
---

# Stock Analysis Audit

Use this skill to analyze listed companies and pooled fund vehicles with an evidence-first workflow. For single companies, the goal is not to prove a stock is worth buying; it is to decide whether the stock deserves single-name concentration risk versus index alternatives. For ETFs and funds, the goal is to decide whether the fund is a sensible tool for the desired exposure versus peer funds and broad benchmarks.

All conclusions are research assistance only and are not investment advice.

## Default Behavior

- Default to Lite screening unless the user explicitly asks for Deep, full audit, or complete analysis.
- Accept minimal input: company name, ticker, abbreviation, or business keyword.
- Identify the security before analyzing it.
- Default opportunity-cost benchmarks:
  - Nasdaq 100 for global large-cap growth and technology opportunity cost
  - CSI Dividend Index for high-dividend cash-return opportunity cost
  - Relevant 10-year government bond yield as the risk-free-rate baseline
- Add a local core index when the primary listing market is clear.

## Output Locale

- Match the user's message language by default.
- If the user explicitly asks for a language, use that language for headings and narrative.
- Keep standard financial abbreviations such as P/E, FCF, ROE, ROIC, NTM, and AUM.
- Use stable slugs from `CONTEXT.md` in `Structured Summary`.
- Render human-readable labels from the slug according to the user locale.
- Do not mix taxonomy layers: business archetype, investment classification, and final verdict are separate.

## Required References

Read only what is needed:

- Always read `CONTEXT.md` and `spec/gates.md`.
- For data rules, tool use, source order, cross-checking, and calculations: `spec/data.md`.
- For single-company workflow: `spec/workflow-company.md`.
- For ETF / fund workflow: `spec/workflow-fund.md`.
- For Deep single-company investment type classification: `spec/classification.md`.
- For single-company report shapes: `spec/templates-company.md`.
- For ETF / fund report shapes: `spec/templates-fund.md`.

For Lite single-company analysis, read `CONTEXT.md`, `spec/gates.md`, `spec/data.md`, `spec/workflow-company.md`, and `spec/templates-company.md`.

For Deep single-company analysis, also read `spec/classification.md`.

For Lite or Deep fund/ETF analysis, read `CONTEXT.md`, `spec/gates.md`, `spec/data.md`, `spec/workflow-fund.md`, and `spec/templates-fund.md`.

For fund/ETF analysis, do not load `spec/workflow-company.md`, `spec/templates-company.md`, or `spec/classification.md` unless the user explicitly asks for underlying single-company holding analysis.

## Bundled Prompt Kit

This skill directory also ships runtime references, Chatbot assets, and human docs:

- `CONTEXT.md` — canonical vocabulary
- `spec/` — runtime references
- `chatbot/` — staged prompts for tool-less chatbots
- `docs/` — usage guides and examples

## Execution Rules

1. Identify the security first.
   - Confirm security type: single company, ETF/index fund, active fund, or unclear.
   - For single companies: confirm company full name, ticker, primary listing, trading currency, business, and possible ADR/share-class ambiguity.
   - For funds/ETFs: confirm fund name, ticker, issuer, tracked index or mandate, expense ratio, and closest peer fund.
   - If multiple candidates exist, stop and ask the user to choose.
   - If the security is an ETF or fund, use `spec/workflow-fund.md` and `spec/templates-fund.md` instead of company classification, moat scoring, and company output templates.

2. Gather data before analysis.
   - Use available tools to collect company filings, market data, valuation data, and benchmark data.
   - Do not invent unavailable numbers. Use `N/A` and explain the impact.
   - If data quality is Low, final verdict must not exceed Watchlist.

3. Run the appropriate workflow.
   - Single-company Lite: company identity, data quality, business model, key financial snapshot, valuation/opportunity cost, potential misunderstanding, top risks, preliminary verdict.
   - Single-company Deep: cross-cycle financials, industry-specific metrics, profit-pool destruction check, hidden upside check, classification, moat, management, valuation, red-team risks, circle-of-competence, final verdict.
   - Fund/ETF Lite or Deep: fund identity, wrapper quality, portfolio anatomy, weighted valuation, growth attribution, peer comparison, exposure-level profit-pool check, Bull-side misunderstanding check, Bear-side hidden re-pricing check, fund-specific risks, fund verdict.

4. Use classification discipline for single companies only.
   - Classify with necessary conditions, M/N supporting evidence, veto conditions, and industry exceptions.
   - Do not let one attractive metric hide a major flaw.
   - Before positive classification, check who can destroy the product or profit pool without needing to profit from that product.
   - Before Reject, Watchlist, or Value Trap conclusions, check whether the market is using an outdated business classification that misses hidden assets, ecosystem lock-in, capital allocation change, or a new profit pool.
   - Hidden upside requires hard evidence: net-income/cash-flow divergence, real buyback-driven share count reduction, segment/backlog/order evidence, industry clearing effects, or proof that the impairment is cyclical rather than structural.
   - For ETFs and funds, skip company classification and use growth attribution, peer comparison, and exposure-level profit-pool checks from `spec/workflow-fund.md`.

5. Produce a clear final verdict.
   - Single company: choose exactly one company verdict slug from `CONTEXT.md`.
   - ETF/fund: choose exactly one of Reject, Watchlist, Satellite Hold, Core Hold, Tactical Only.
   - Include confidence, data quality, top supporting evidence, top opposing evidence, key falsification metric, and re-audit trigger.
   - Include `## Structured Summary` with `field | slug | label`.

## Stop and Ask

Stop instead of continuing when:

- Company or fund identity is ambiguous.
- Data sources conflict on a key value and cannot be reconciled.
- The company is delisted, privatized, renamed, merged, or materially restructured and the current security is unclear.
- The user asks for an action framework but provides no circle-of-competence or risk context.
- Critical data is unavailable and the missing data would change the verdict.

Ask one question at a time. Prefer multiple-choice options when possible.

## Style

Use clear, direct, auditable language. Avoid vague phrases such as "looks promising" or "worth watching" unless conditions and evidence are stated. Do not treat low valuation as safety margin, and do not treat company quality as stock attractiveness.
