---
status: accepted
date: 2026-06-14
---

# Template track seat allocation replaces global supporting-count ranker

After the 2026-Q1 CN live run, candidates.yaml used a global sort on raw `supportingPassCount`, which is incomparable across sector templates and produced sector-heavy top lists (e.g. pharma clustering) while deferred.yaml exposed every sector passer (~90+ names). We replace that with **template track seat allocation**: seats are drawn from pools keyed by **winning template × passed track**, using **seat floors**, **seat caps**, and a **flex seat pool** up to **funnel soft cap 20** per market. **Track confluence** (same template passes both quality and mispricing) ranks in a priority tier inside the quality pool, receives doubled flex weighting, but still consumes only one seat. Vacant seats backfill in two tiers: same-template quality, then global quality. **Candidate rank** is Deep queue priority (confluence first, then allocation tiers)—not a cross-market “best stock” score. **deferred.yaml** is capped at 20 watchlist rows; additional sector passers are counted in funnel-diagnostics only.

## Considered options

- **Global supporting-count ranker (rejected):** Simple, but compares unlike denominators across templates; rewards high-margin sectors structurally.
- **Fixed per-template quotas (rejected):** Predictable, but ignores seasonal sector richness and over-constrains flex.
- **Shenwan L1 seat buckets (rejected):** Duplicates sector routing and breaks L2 routing decisions (e.g. devices → manufacturing).
- **Quality + mispricing in one template pool (rejected):** Lets mispricing passes crowd out quality compounders.
- **Full deferred.yaml for all sector passers (rejected):** Correct for audit, wrong for operator UX (~100-name workload).

## Consequences

- Implement `winning_template`, `seat_source`, `track_confluence` on candidate records; stop collapsing dual-track passes to a single track in ranker input.
- CN default floors/caps live in `spec/conventions.yaml`; US mirrors CN initially.
- `CONTEXT.md` glossary updated (`template_seat_allocation`, `track_confluence`, `candidate_rank`, `deferred_watchlist_cap`, etc.).
- Deep default limit (20) aligns with funnel soft cap; rank 1–20 means audit queue order, not funnel conviction.
- filter-breakdown and diagnostics must surface sector-pass totals when deferred is capped.
