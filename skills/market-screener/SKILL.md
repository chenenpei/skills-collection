---
name: market-screener
description: Deterministic A-share and US equity screening, archived-result inspection, filter diagnostics and landmine price calculation.
disable-model-invocation: true
---

# Market Screener

Use this skill when explicitly requested. It performs quantitative screening independently; qualitative single-company analysis belongs to a separately requested skill.

Read [README.md](README.md) before running or reporting results. For terminology, consult [CONTEXT.md](CONTEXT.md).

## Run

From `skills/market-screener/cli`, use `npm run dev -- run --output <new-directory>`. The default market is CN and the default strategy is `all`. Check `run --help` for options.

- Fresh CN runs collect bounded structured evidence online. Use `--input` for saved evidence or `--collect-from` for frozen identities. PDF is a bounded fallback; `--no-pdf` disables it. Ordinary runs use existing methods and sources without developing new parsers or chasing missing data beyond their budgets.
- US uses its quarterly template workflow: specify `--markets US --quarter YYYY-QN --output <directory> --spec src/policy`. Its default adapter is offline `fixture`; choose `--adapter live` explicitly for collection. Mixed markets execute separately.
- View the full candidate queue (main and backup) with `candidates <directory>`; add `--backups` for the independent backup set or `--financial-leads` for all qualified financial discount leads, including undisplayed companies.
- Inspect saved CN runs with `explain <ticker> --from-run <directory>`, `filter-breakdown --from-run <directory>`, `compare <left> <right>` or `replay <directory>`. These operations do not recollect data.
- Use `landmine` only when requested, with the supplied audit-summary input. It computes observation prices independently of screening qualification.

## Report

Use CLI results and provenance rather than recreating calculations outside the CLI. Report scope and time, collection completion/partial status, complete versus displayed candidate counts, strategy hits, material unknown reasons and the archive path.

Research qualification, price qualification, NCAV, financial book-discount repair and nonfinancial earnings repair are distinct. The main research list and the NCAV/repair backup list have independent capacities (normally 30 + 30), with no backfill or duplicate companies. Main candidates are ordered by the model's price band (undervalued, normal, expensive, unknown), then reported return and earnings yield. Explain these as quantitative research signals, not proven intrinsic value or buy recommendations. Financial book-discount leads retain pending specialist risks. NCAV is listed first by asset coverage; financial and nonfinancial repair leads then share an earnings-yield order, preserving their different annual/seven-year bases. Quality failure does not block independent repair evaluation; missing repair prices cannot qualify. Missing prices do not cancel established research qualification; the display limit does not change the complete qualified set. Report reliable failures, missing evidence and unsupported methods separately. A partial collection is not a completed market screen.

Screening output is research assistance. It neither constitutes a qualitative audit nor automatically starts one. Compare changes in rules, observations and collection failures separately; candidate growth alone does not demonstrate better investment quality.
