# Context Map

## Contexts

- [Stock Analysis Audit](./skills/stock-analysis-audit/CONTEXT.md) — evidence-first single-security audit (Lite / Deep); vocabulary for verdicts, classifications, archetypes, and data quality
- [Market Screener](./skills/market-screener/CONTEXT.md) — quantitative funnel that produces research candidates; independently usable with optional qualitative follow-up

## Relationships

- **Market Screener → Stock Analysis Audit**: optional downstream use: the funnel produces research candidates; a user-selected company may enter a separate Lite or Deep audit as `security_single_company`. Neither skill requires the other
- **Vocabulary ownership**: each context defines its own terms. Screening qualification and audit verdicts are distinct; sharing a company identity does not transfer a verdict or create a runtime dependency
- **Executable policy**: screener rules live in `skills/market-screener/cli/src/policy/`; `CONTEXT.md` is glossary only
