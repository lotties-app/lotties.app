# Resolving a GitHub issue (for AI agents)

How an agent takes a public issue on `lotties-app/lotties.app` from report to fix. Labels and the human triage flow
are in `docs/TRIAGE.md`; the rules of the repository are in `CLAUDE.md` and always apply.

## Never

- Ask the reporter for a baby's name, birth date, photos, events, health records, a backup file, a Napper export,
  a token or anyone's personal data. Ask for steps, the screen and made-up values instead.
- Paste personal data from an issue into a commit, a test, a fixture or a doc. If an issue contains some, tell the
  owner (the issue text must be edited or hidden) and work from a synthetic version.
- Discuss a security problem in public. It goes to a private advisory (`SECURITY.md`); stop and tell the owner.

## Read the form

The bug form (`.github/ISSUE_TEMPLATE/bug.yml`) is prefilled by "Report a problem" in the app
(`code/web/src/landing/outboundLinks.ts`, `useProblemReportUrl.ts`): version, platform, language and screen.

| Field | Where it leads |
| --- | --- |
| `screen` (a route path, ids replaced by `:id`) | `code/web/src/AppRoutes.tsx` for the route, then `pages/` or the feature folder; `docs/agents/filemap.md` maps every folder |
| `version` (`v0.1.80`) | the git tag `v0.1.80`: `git log v0.1.80..main` shows what changed since; `dev` or a commit means a local or preview build |
| `platform` | Web browser: the PWA; iOS app / Android app: the Capacitor shell (`code/mobile`, native code only behind `isNativeApp()`, `code/web/src/platform`) |
| `language` | catalogs in `code/web/src/i18n/locales/<lang>/`; a wrong or missing text is often a missing key in one language |
| `severity` "I could not log an event" | treat first: offline store, outbox and sync (SPEC "Events sync contract") |

## Reproduce

- Web: `npm --prefix code/web run dev` (in a worktree: your slot's port, `docs/PROCESS.md` "Ports"); developer-only
  previews under `/dev/*` render many screens without an account.
- Unit tests: `npm --prefix code/web test -- --run <path>`; API: `dotnet test code/api/Lotties.sln` (SQLite).
- Full flow with Keycloak and a database: `docs/E2E.md` (needs the owner's root `.env`; never read or print it).
- Native-only problems cannot be reproduced here: say so, and fix what the web layer can show.

## Fix

1. Work in your own worktree (`scripts/worktree-new.sh`), never on `main`.
2. Write a failing test that shows the bug first, then fix it; the test stays.
3. Follow `CLAUDE.md` (i18n for every string, roles and consent tests for routes, privacy policy for any new data
   flow, the vaccine, age norm and unit vectors shared by C# and TS).
4. Run lint, tests and build (`CONTRIBUTING.md`); open a PR that says `Fixes #<number>`.

## Labels

`needs-triage` (set by the form) -> `confirmed` (reproduced or clearly understood; add an `area:*` label) ->
`in-progress` (a PR or a worktree exists) -> closed when the fix is deployed, quoting the release (`docs/TRIAGE.md`).
Use `needs-info` when the report cannot be reproduced and say what is missing, never asking for personal data.
