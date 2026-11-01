# Review 1 (static adversarial review of the whole repo)

Status column: `todo` / `wave-N` (assigned) / `done`. Source file:line references are as of commit 96e5b09.

| # | Sev | Finding | Fix direction | Status |
|---|-----|---------|---------------|--------|
| 1 | Critical | Offline edits dropped: client `updatedAt` compared with the server's receive-time `updatedAt`; stale-check ignores the edit and the client then overwrites its copy with the server's | Store `ClientUpdatedAt` on the event (from the request, from create onward); compare client-vs-client; server `UpdatedAt` stays the sync cursor; test with skewed clocks | done |
| 2 | High | Local Dexie/localStorage not cleared or namespaced per user on logout/user switch; queue replayed with another user's token | Namespace DB by `sub`; on logout warn/push then clear; refuse foreign queues | done |
| 3 | High | Napper preview medication suggestion is O(n^2) with Levenshtein, unbounded names (CPU DoS) | Caps per row/file, length precheck, bucketing, timeouts | done |
| 4 | Medium | Permanent 5xx blocks outbox forever; API turns DB errors into 500 (e.g. dose >= 1e7 overflow `numeric(10,3)`, NUL chars) | Validate DB limits -> 400; dead-letter after N attempts | done |
| 5 | Medium | Icon/field key like `constructor` crashes the UI for all members; no error boundary | `Object.hasOwn`/Map, server allowlist for icons, forbid reserved field keys, error boundary | done |
| 6 | Medium | Predictions ignore `payload.kind`: bed_time/woke_up/night_waking miscounted as sleep | Build sleep sessions from kinds | done |
| 7 | Med-Low | Import re-run 409s after an imported medication is renamed (derived id collision) | Look up by derived id too | done |
| 8 | Low | Invite can be accepted twice concurrently | Concurrency token / conditional update | done |
| 9 | Low | Baby can lose all owners under concurrent demotions | Concurrency token on Baby | done |
| 10 | Low | Pull skips events with pending local mutations but advances cursor; rejected/discarded mutation never re-fetches server copy | Re-fetch event on dead-letter/discard | done |
| 11 | Low | "Born in the future" check uses UTC date | Allow today+1 | done |
| 12 | Low | .NET regex `$` accepts trailing newline (HexColor, Slug) | `\z` | done |
| 13 | Low | No request size/timeouts/rate limits (30 MB default body) | Per-endpoint limits, rate limiting | done |
| 14 | Low | docker-compose deploy does not work (no /api proxy, wrong base URL, no build args, no security headers, localdb port exposed, CI lacks `permissions:`) | Fix nginx/compose/Dockerfile/CI | done |
| 15 | Low | Tokens (incl. refresh) in localStorage, no CSP | CSP + document trade-off | done |
| 16 | Low | Users keyed by `sub` only (no issuer) | Unique (issuer, sub) | done |
| 17 | Low | Leaving a baby discards unsynced queue without warning | Warn / push first | done |
| 18 | Low | Email used as display name when no `name` claim | Do not expose email | done |
| 19 | Low | Invite token in URL path ends up in logs | Accept via POST body; keep link fragment (`/invite#token`) | done |
| 20 | Low | .NET 8 EOL 2026-11-10; very new web majors | Plan upgrade to .NET 10 LTS; pin/lock web versions | todo |
| 21 | Low | A sync run (or token renewal) still in flight at `stop()` re-armed its retry timer, so a stopped engine woke up later on a closed account database with a stale token getter (after sign-out, a session end, or the native in-app re-sign-in); made `coldStart.test.tsx` B1 flaky, where an earlier test's engine pushed the queue | `stop()` suppresses retries and follow-up runs of the in-flight run (`SyncEngine`, `SessionRenewal`); regression tests; the B1 test unmounts before its teardown | done |

Reviewed with no findings: route protection and role policies, IDOR across all baby-scoped resources, invite token entropy/hashing, user provisioning races, JWT validation, CORS, error leakage, injection, CSV parser, delta paging ties, soft deletes, migrations snapshot test, import transaction, prediction math, web XSS and redirects, service worker caching, git history secrets.
