# Context Map

## Contexts

- [Stock Analysis Audit](./skills/stock-analysis-audit/CONTEXT.md) — evidence-first single-security audit (Lite / Deep); vocabulary for verdicts, classifications, archetypes, and data quality
- [Market Screener](./skills/market-screener/CONTEXT.md) — quarterly quantitative funnel that scans an investable universe and feeds candidates into stock-analysis-audit

## Relationships

- **Market Screener → Stock Analysis Audit**: the funnel outputs a short candidate list; each candidate enters Deep audit as `security_single_company`
- **Shared vocabulary**: screener uses `security_single_company` and investment-classification slugs from Stock Analysis Audit; screener-specific terms (Quantitative Funnel, Investable Universe) live in Market Screener context only
- **Executable spec**: screener rules live in `skills/market-screener/spec/`; `CONTEXT.md` is glossary only
