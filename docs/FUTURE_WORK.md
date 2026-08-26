# RADAR — planned assessor work

Future work, not yet scheduled. Context: step-2 assessor (`src/assess/`) is live and committed
through `640b824` plus the uncommitted-at-the-time "v-prefix retry + silence-is-not-safety" fixes
(`src/assess/fetch.ts`, `src/assess/engine.ts`). Resume from this file.

## 1. `non_applicable` risk level for non-drifted components

**Problem.** Components with `current == latest` (no update available) currently get assessed like
drifted ones. Layer 2 note analysis can flag them `breaking` (observed live: Blackbox exporter,
`v0.28.0 → v0.28.0`, flagged breaking because the release notes of the version it _already runs_
contain a breaking section). Elsewhere they report `likely_safe`, which is equally wrong — there is
nothing to be safe about when nothing would change.

**Decision (user, 2026-08-25).** When `current` and `latest` match, the verdict is `non_applicable`,
not `likely_safe`. Prechecks that are about the component itself rather than the upgrade
(deprecated, EOL, floating tag, custom fork) must still fire — Tempo's `eol_warning` and the CNPG
image's `deprecated` are correct on non-drifted components.

**Implementation sketch.**

- `src/schema/assessment.ts`: add `non_applicable` to `RISK_LEVELS` and place it in `SEVERITY_ORDER`
  (suggest least severe, below `likely_safe`). This is a contractual schema — update validators and
  docs in the same change.
- `src/assess/engine.ts`: after prechecks + versioning hints (those stay valid regardless of drift),
  if `!update_available` / versions match, short-circuit to `non_applicable` before the major-bump
  rule and layers 1–5. Decide the exact drift test: `update_available` flag vs normalized version
  equality (current handles multi-tag strings like curl's `"8.9.1 / 8.10.1 /
  latest"` — prefer
  reusing `parseSemver` equality, not the raw flag, and define behavior for `latest: unknown` →
  stays `unknown`).
- `src/server/routes.ts`: `?risk_level=non_applicable` filter works automatically once the enum is
  extended; verify the 400 path still rejects junk.
- DB: `assessments.risk_level` is a plain text column — no migration needed, but confirm.
- Tests to expect fallout in (they assert `likely_safe` on in-sync components today):
  - `tests/unit/assess_engine_test.ts` — including the "in-sync → likely_safe" assertion added in
    the notes-unavailable test (flip it to `non_applicable`).
  - `tests/unit/assess_run_test.ts` — CFSSL `v1.6.5 → v1.6.5` expects `likely_safe` and a specific
    severity sort order; both change.
  - Any layer tests that use equal current/latest fixtures.
- Docs: `docs/API.md` (enum list), `docs/ARCHITECTURE.md` + `docs/DEVELOPMENT.md` (layer lists and
  the severity table in `docs/SCHEMA.md`).

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
