# Host Handover

> Single handover doc for this repo. Multiple sessions contribute here —
> merge into the existing sections rather than overwriting or duplicating them.

_Last updated: 2026-09-11_

## Current state
Fork of naiba/bonds (open-source PRM, Go/Echo + React/AntD) used to develop the reports overhaul, geocoding, and CardDAV improvements that were upstreamed in Sept 2026. The production instance ("Aria's vault") runs on vps.akn.me.uk behind prm.akn.me.uk.

## Done
- Merged upstream (squash): PR #259 reports overhaul, #262 geocoding/addresses, #263 contact navigation, #264 runtime config — naiba added one surgical fix commit to each before merging (vault-keyed placeholders, optimistic geocode writes, navigation tokens, hot-reload config, OSM attribution). naiba's own #267 built a provider framework on top.
- All local branches pushed to the fork (akn101/bonds) 2026-09-11; the pre-review iteration of vault-reports is archived as `vault-reports-local-archive`.

## In flight
- The VPS still runs a custom image `bonds:0.22.2-akn-reports3`. All upstream PRs are now merged (#266 landed 2026-09-01 per GitHub), so the move to upstream images is unblocked — but it still needs the owner's explicit approval and has NOT happened.

## Branches & PRs
- Upstream PRs: #259/#262/#263/#264/#266 all merged.
- Fork branches: `reports-only`, `vault-reports`, `nav-sticky-sections`, `fix-address-coordinates`, `dav-preserve-coordinates` (the #266 branch), `review-fixes-all`, `vault-reports-main`, `vault-reports-local-archive` (historic), `screenshots-reports`/`pr-screenshots` (synthetic-data PR evidence). All pushed; local branches are stale vs upstream main — rebase before new work.
- Remote note: `origin` (naiba/bonds) has its push URL deliberately disabled — push to `fork` only.

## How to run & verify
- Backend: `go test ./...` from repo root. Frontend: vitest — **local runs carry ~190 pre-existing localStorage failures; CI is the arbiter**, compare against a stashed baseline, never trust raw local counts.
- Lint gotchas: no dialect-specific SQL (SQLite AND Postgres must pass), react-refresh/only-export-components, useDateFormat() for all dates, i18n across 7 locales.
- Demo env quirks and test-noise details: see the bonds-fork-dev-gotchas notes in the owner's Claude memory.

## Gotchas & decisions
- naiba (upstream maintainer, AI-agent-driven) reviews fast and fixes residuals himself — keep PRs narrow, expect his fix commits on the PR branch before squash-merge.
- Never publish screenshots of the real vault — the evidence branches use synthetic data only.
- `git checkout <file>` after demo builds has silently reverted fixes before — re-diff after any demo work.

## Next steps
1. Propose the VPS move to upstream images (needs owner approval; mind the 127.0.0.1:8080 compose binding on the VPS — a naive compose reset exposes the port).
2. Rebase any resumed branch onto upstream main first.
