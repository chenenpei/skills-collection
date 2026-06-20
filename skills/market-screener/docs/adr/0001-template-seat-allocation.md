---
status: accepted
date: 2026-06-14
---

# Template track seat allocation replaces global supporting-count ranker

Global `supportingPassCount` sort was incomparable across templates (pharma clustering, ~90 deferred names). **Seat allocation** fills `candidates.yaml` from pools keyed by **winning template × passed track**, with **floors**, **caps**, and a **flex pool** up to funnel soft cap **20** per market.

**Track confluence** (same template passes quality and mispricing) ranks above single-track quality in that pool, gets doubled flex weight, consumes one seat. Vacant seats backfill: same-template quality → global quality. **Rank** is Deep queue order, not cross-market “best stock”. **deferred.yaml** capped at 20; overflow passers in diagnostics only.

## Rejected

Global supporting-count ranker; fixed per-template quotas; Shenwan L1 seat buckets; merged quality+mispricing pools; unlimited deferred list.

## Where it lives

`spec/conventions.yaml` (`template_seat_allocation`), `cli/src/funnel/ranker.ts`, `run.ts`. Glossary: `CONTEXT.md` (`template_seat_allocation`, `track_confluence`, `candidate_rank`, `deferred_watchlist_cap`).
