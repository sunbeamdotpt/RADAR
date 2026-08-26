# RADAR — planned assessor work

Future work, not yet scheduled. Context: step-2 assessor (`src/assess/`) is live and committed
through `640b824` plus the uncommitted-at-the-time "v-prefix retry + silence-is-not-safety" fixes
(`src/assess/fetch.ts`, `src/assess/engine.ts`). Resume from this file.

## 1. `non_applicable` risk level for non-drifted components ✅ DONE

**Problem.** Components with `current == latest` (no update available) currently get assessed like
drifted ones. Layer 2 note analysis can flag them `breaking` (observed live: Blackbox exporter,
`v0.28.0 → v0.28.0`, flagged breaking because the release notes of the version it _already runs_
contain a breaking section). Elsewhere they report `likely_safe`, which is equally wrong — there is
nothing to be safe about when nothing would change.

**Decision (user, 2026-08-25).** When `current` and `latest` match, the verdict is `non_applicable`,
not `likely_safe`. Prechecks that are about the component itself rather than the upgrade
(deprecated, EOL, floating tag, custom fork) must still fire — Tempo's `eol_warning` and the CNPG
image's `deprecated` are correct on non-drifted components.

**Implementation (completed in commit after resume).** Added `non_applicable` to
`RISK_LEVELS`/`SEVERITY_ORDER` in `src/schema/assessment.ts`, `isVersionMatch()` in
`src/assess/version.ts`, and an early `layer_0_in_sync` short-circuit in `src/assess/engine.ts`
after prechecks. Updated engine/run/server tests, `L4_ACTIONS`, and docs (`API.md`,
`ARCHITECTURE.md`, `SCHEMA.md`, `DEVELOPMENT.md`). Live rerun confirmed Blackbox exporter moves from
`breaking` to `non_applicable`.

## 2. Option C: fetch release notes across the whole version gap

**Problem.** Only the _latest_ release's notes are fetched. Breaking changes announced in an
intermediate release (e.g. Longhorn v1.12.0 when latest is v1.12.1) are invisible. User said "we
will probably need C soon after" A+B.

**Implementation sketch.**

- For github_release / github_tags sources (and github link_templates generally): use
  `GET /repos/{owner}/{repo}/releases?per_page=100`, select releases with tags strictly between
  `current` and `latest` (parse with `src/assess/version.ts` `parseSemver`; skip unparseable tags),
  concatenate their `body` fields newest-first with a `# <tag>` separator so L2 headers stay
  attributable.
- Cap total notes size (suggest ~200 KB) and page count (1 page) to bound runtime and memory; log a
  line when truncating.
- Keep the v-toggle retry from fix A for the single-release path; the list endpoint doesn't need it.
- Forward `GITHUB_TOKEN` (already plumbed); mind rate limits — one extra call per drifted github
  component per run.
- `RADAR_OFFLINE` / injected `opts.releaseNotes` behavior unchanged (tests stay hermetic).
- Engine: no layer changes needed — L2/L4 already analyze a combined notes string.
- Tests: unit-test the range selection (v-prefixed, unprefixed, mixed, prereleases, gap with no
  intermediate releases); stub-HttpClient test that concatenation order and separators are right.

## Observations parked during the 2026-08-25 session

- Blackbox exporter flagged `breaking` on `v0.28.0 → v0.28.0` (fixed by item 1).
- Duplicate-ish pairs remain by design (exact-case, different upstream):
  `Scaleway cert-manager
  webhook` vs `scaleway-certmanager-webhook`, `curl` vs
  `curl (monitoring)`. If they are the same artifact tracked twice, the fix is seed curation, not
  dedupe logic.
- 14 components pinned to floating tags (`latest`, `stable`) can never show reliable drift — the
  biggest registry-hygiene issue; a seed cleanup, not code.
