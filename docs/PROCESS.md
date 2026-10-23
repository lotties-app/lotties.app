# Parallel work process

How several agents build features at the same time without stepping on each other: one git worktree and one branch per
feature, integration and deploy one feature at a time from the main clone. The scripts live in `scripts/` (Git Bash on
Windows; each has `--help`).

## Roles

- **Owner**: decides what gets built, approves deploys, owns the secrets (root `.env`, `deploy/homelab/.env`), the
  cluster and the database.
- **Orchestrator**: plans and splits the work into features, picks each feature's name and port slot, creates the
  worktrees, briefs the workers, reviews their branches, integrates them one at a time, runs the checks, and deploys
  from the main clone. The only one who writes to `main`.
- **Worker** (one per feature): works only inside its own worktree, on its own branch, and hands back a short report.

## One worktree per feature

| What | Value |
| --- | --- |
| Branch | `feat/<name>` (lower-case, digits, dashes; e.g. `feat/growth-charts`), from the latest `main` |
| Path | `E:/w/<name>` (`WORKTREE_ROOT` changes the root). Short on purpose: Windows paths stop at 260 characters and `node_modules`, `bin/obj` and Playwright outputs are deep |
| node_modules | junctions to the main clone's (`code/web`, `code/mobile`, `tests/e2e`, `code/keycloak-theme`): no install, a few seconds to create |
| Caches | Vite and Vitest caches in `code/web/.vite-cache` per checkout (`cacheDir`, `test.fsModuleCachePath`), never in the shared `node_modules` |
| .NET | `dotnet restore` done at creation; `bin/` and `obj/` are the worktree's own |
| Line endings | checked out with LF, like the main clone (`prettier --check` expects LF) |

Because `node_modules` is shared, **never run `npm install` or `npm ci` in a worktree** and never change dependencies
there: it would rewrite the main clone's `node_modules` under every other agent.

## Commands

```bash
scripts/worktree-new.sh <name> [--base main] [--no-restore]      # orchestrator: create the worktree
scripts/worktree-integrate.sh <name>                             # orchestrator: rebase, regenerate migrations, merge into main
scripts/worktree-remove.sh <name> [--delete-branch|--force-branch]  # orchestrator: after the deploy is verified
scripts/regen-migrations.sh <MigrationName> [--base main] [--checkout <path>] [--no-test]  # used by integrate, or by hand
```

- `worktree-new.sh` fetches `origin`, branches from `origin/main` when the local `main` is behind it (and says so),
  refuses a name whose branch, folder or worktree exists, warns when the main clone has uncommitted tracked changes,
  links the junctions, restores the .NET solution and prints the next steps.
- `worktree-integrate.sh` (from any checkout; it works on the main clone and the feature worktree):
  1. requires `main` checked out in the main clone with no uncommitted tracked change (the owner's two local
     `.gitignore` lines `CLAUDE.md` and `.claude/` are allowed: they are set aside for the merge and put back), and
     nothing uncommitted or untracked in the worktree;
  2. rebases `feat/<name>` onto `main` in the worktree; on a conflict it aborts the rebase (nothing changes) and prints
     each conflicting file with its hot-spot rule (below). It never resolves anything itself;
  3. if the branch adds an EF migration and `main` gained migrations since the branch started (or sorts after it), runs
     `regen-migrations.sh` in the worktree and commits the result on the branch; otherwise, for a branch with a
     migration, runs the migration tests;
  4. merges with `--no-ff` into `main` and prints the checklist (full checks, secrets scan, push, backup, migrations,
     deploy, verify, cleanup). It never pushes, deploys or touches a database.
- `worktree-remove.sh` removes the `node_modules` links first (each must be a reparse point; only the link is deleted,
  with `[System.IO.Directory]::Delete(path, $false)`), refuses if any other reparse point is left, then runs
  `git worktree remove --force` and `git worktree prune`. It refuses anything that is not a registered worktree of this
  repository, the main clone, a locked worktree (an agent is using it) and the worktree it runs in.
  `--delete-branch` deletes the branch only when merged; `--force-branch` deletes it anyway.
- `regen-migrations.sh` is **only for a migration that was never applied to any database**. It refuses a deployed one
  (pinned in `MigrationTests.cs`) and one that exists on the base branch. It deletes the migration, takes the base
  branch's model snapshot, runs `dotnet ef migrations add` with the same name (dummy `DB_*` values: no database is
  contacted), puts the old migration body back (hand edits and comments survive) and prints how it differs from what EF
  generates now (exit 3 when the code differs: review it), replaces the old migration id in docs and tests, and runs the
  migration tests. It does not commit. (`dotnet ef migrations remove` is not used: it only removes the last migration
  and, when the snapshot was merged, rewrites the snapshot instead of removing anything.)

## Worker rules

1. Work and commit only in your worktree, on `feat/<name>`, in a few logical commits. Never commit on `main`, never
   push, never edit files of the main clone or of another worktree.
2. No dependency changes (`package.json`, lock files, `PackageReference`, `dotnet-tools.json`) and no `npm install`.
   If the feature needs one, stop and report: the orchestrator changes dependencies in the main clone between
   features.
3. At most one EF migration per branch, named after the feature. Never edit a deployed migration; never add yours to
   the pinned lists (`DeployedMigrations`, `DeployedKeys`, deployed notification codes).
4. Hot-spot files: follow the "where to add" column of the table below so two branches touch different lines.
5. Servers only on your slot's ports (below); stop every server, watcher and browser you start. Containers: only
   `br-<name>-*` names and high ports, never anything else on the WSL host.
6. Never deploy, never touch the real database or the cluster, never read or print `.env` files.
7. Before handing back: `npm --prefix code/web run lint`, `npx prettier --check .` (in `code/web`),
   `npm --prefix code/web run test -- --run`, `npm --prefix code/web run build`, `dotnet build code/api/Lotties.sln`,
   `dotnet test code/api/Lotties.sln`, everything committed.

## Ports

Each worker gets a slot (the orchestrator assigns it in the brief). Nothing else may use these ports.

| Slot | Web dev server (Vite) | Vite preview, screenshots | API (`dotnet run`) |
| --- | --- | --- | --- |
| main clone / E2E | 5173 | 4173 | 5290 |
| 1 | 5411 | 5421 | 5491 |
| 2 | 5412 | 5422 | 5492 |
| 3 | 5413 | 5423 | 5493 |
| 4 | 5414 | 5424 | 5494 |
| 5 | 5415 | 5425 | 5495 |
| 6 | 5416 | 5426 | 5496 |
| 7 | 5417 | 5427 | 5497 |
| 8 | 5418 | 5428 | 5498 |

```bash
npm --prefix code/web run dev -- --port 5411 --strictPort
ASPNETCORE_URLS=http://localhost:5491 dotnet run --project code/api/src/Lotties.Api
```

The Playwright E2E suite uses the fixed ports 5173/5290 (`tests/e2e/playwright.config.ts`): run it from one checkout at
a time, normally the main clone after an integration.

## Hot spots

Files that many features edit, where each change goes, and how a conflict is resolved (`worktree-integrate.sh` prints
the rule of each conflicting file).

| Hot spot | Where to add | On conflict |
| --- | --- | --- |
| EF migrations: `Persistence/Migrations/` (Designer, `LottiesDbContextModelSnapshot.cs`) | one migration per branch (`dotnet ef migrations add <Feature>`) | keep `main`'s snapshot (during a rebase that is `--ours`), finish the rebase, then `scripts/regen-migrations.sh <Feature> --checkout <worktree>` and commit. Without a conflict, `worktree-integrate.sh` regenerates by itself when `main` gained migrations |
| `MigrationTests.cs` `DeployedMigrations` | never by a worker: the rule tests (ids, Designers, latest Designer = snapshot) cover new migrations | take `main`'s side |
| i18n catalogs `code/web/src/i18n/locales/<lang>/<feature>.json` | the feature's own file, both languages; a new feature area is a new file in both folders | keep both sides' keys (a conflict means two features edited the same feature file) |
| `code/web/src/i18n/catalogEn.ts` (typed list) | one line per new English file, sorted | keep both lines |
| Dexie `SCHEMA_VERSIONS` (`code/web/src/db/database.ts`) | append one entry with the next version number | keep `main`'s entries unchanged and renumber yours to the next free number (`database.test.ts` checks 1..n). Only versions never deployed may be renumbered |
| Endpoint-role matrix (`EndpointRoleMatrixTests.cs`) | your routes as one block, with a comment line naming the feature, after the block of the closest feature (or at the end) | keep both blocks |
| Enums and lists that grow (`NotificationKind` + `NotificationCodes`, `BuiltInEventTypes.All`) | append at the end | keep both, `main`'s first; the tests pin only the deployed prefix |
| `docs/SPEC.md`, `docs/agents/PLAN.md`, `docs/agents/filemap.md`, `CLAUDE.md`, other docs | your own lines or section | keep both sides, `main`'s first |

After each deploy that shipped a migration, a built-in event type or a notification kind, the orchestrator appends it
to the pinned list (`DeployedMigrations` in `MigrationTests.cs`, `DeployedKeys` in `BuiltInEventTypesTests.cs`, the
deployed codes in `NotificationValueObjectTests.cs`) in a small commit on `main`. Workers never edit these lists.

## Integrate and deploy

One feature at a time, in the order they finish:

1. `scripts/worktree-integrate.sh <name>`; fix any conflict in the worktree by its rule, then run it again.
2. In the main clone: the full checks (worker rule 7), a secrets scan of the merge (the command is printed), then
   `git push origin main`.
3. Back up the database before a deploy that applies migrations.
4. Apply migrations first when the merge added any (docs/DEPLOY.md "Applying migrations").
5. Deploy only from the main clone, in WSL, with a clean tree on `main` (the owner's `.gitignore` lines aside):
   `DRY_RUN=1 ./deploy/homelab/deploy.sh`, then `./deploy/homelab/deploy.sh`. Never from a worktree: WSL cannot read a
   Windows worktree's `.git` file, and `deploy.sh` stops when git lists no files.
6. Verify (deploy/homelab/README.md "Verify"), then pin what shipped (above), then
   `scripts/worktree-remove.sh <name> --delete-branch`.
7. Only then integrate the next branch.

**Two workers finish together**: integrate and deploy the first one (the first to finish, or the smaller one when
unsure) completely, steps 1 to 6. The second waits; its integration rebases it onto the new `main` and regenerates its
migration when needed. Never merge two branches before the first is deployed and verified, and never integrate from two
places at once.

## Rollback

- **Before the push**: `git -C <main clone> reset --hard <sha>` with the `main` commit printed before the merge (the
  secrets-scan line shows it); the feature branch is untouched.
- **After the push**: never rewrite `main`. Revert the merge (`git revert -m 1 <merge commit>`), push, deploy.
- **A bad deploy**: `helm rollback` of `lotties-api` / `lotties-web` (deploy/homelab/README.md "Roll back"), then fix
  forward. Migrations are forward only: write them backward compatible (add first, remove later), so the previous API
  build still runs on the new schema; restore the database backup only for real data loss.
- **A bad rebase in a worktree**: `git rebase --abort` (the integrate script already does it on a conflict).

## Notes

- Git for Windows here has `core.autocrlf=true`: files that git rewrites later in a worktree (a checkout, a rebase) may
  come back with CRLF, which `prettier --check` reports. Re-check one out with LF:
  `git -c core.autocrlf=false checkout -- <file>` (only for a file without uncommitted changes).
- A worktree created by a tool (for example `.claude/worktrees/agent-*`) is locked while the agent runs:
  `worktree-remove.sh` refuses it.
