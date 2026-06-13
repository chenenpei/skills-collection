# Stock Analysis Audit Runtime Spec

This directory is the runtime specification for the `stock-analysis-audit` skill. Human-facing documentation lives in `README.md` and `docs/`.

## Maintenance Rule

- Concept vocabulary, slugs, labels, and domain definitions live in `../CONTEXT.md`.
- Data definitions, source order, and computation rules live in `data.md`.
- Stop, downgrade, and workflow gates live in `gates.md`.
- Company execution flow lives in `workflow-company.md`.
- Fund and ETF execution flow lives in `workflow-fund.md`.
- Single-company M/N investment classification lives in `classification.md`.
- Company report shapes live in `templates-company.md`.
- Fund report shapes live in `templates-fund.md`.

Do not reintroduce a monolithic prompt source. Keep one truth source per responsibility.

## Runtime Loading Map

Always read:

- `../CONTEXT.md`
- `gates.md`

For single-company Lite:

- `data.md`
- `workflow-company.md` section `Lite Screening`
- `templates-company.md` section `Lite Screening Template`

For single-company Deep:

- `data.md`
- `workflow-company.md` section `Deep Audit`
- `classification.md`
- `templates-company.md` section `Deep Audit Template`

For ETF, index fund, active fund, or other pooled vehicle:

- `data.md`
- `workflow-fund.md`
- `templates-fund.md`

## Core Principle Summary

- Low valuation is not a margin of safety by itself.
- A good company is not automatically a good stock.
- Single stocks must justify concentration risk versus index alternatives.
- Funds must justify their role versus peers, broad benchmarks, and the risk-free rate.
- Qualitative claims require evidence.
- Positive conclusions require profit-pool destruction checks.
- Negative conclusions require hidden-upside checks where relevant.
- Fund analysis must separate wrapper, portfolio exposure, and underlying holdings.
