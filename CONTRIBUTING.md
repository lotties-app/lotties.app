# Contributing

Thanks for helping out.

1. Open an issue first for larger changes so we can agree on the approach.
2. Fork, create a branch from `main`, and keep changes focused.
3. Before opening a pull request, make sure these pass:
   - `dotnet build code/api/Lotties.sln` and `dotnet test code/api/Lotties.sln` (needs the .NET 10 SDK)
   - `npm --prefix code/web run lint`, `npm --prefix code/web run test -- --run`, `npm --prefix code/web run build`
3a. Adding, removing or updating a dependency (npm or NuGet)? Regenerate the credits and commit the result:
   `dotnet restore code/api/Lotties.sln`, then `node code/web/scripts/generate-credits.mjs`
   (updates `CREDITS.md`, `THIRD_PARTY_NOTICES.md` and `code/web/src/credits/*.generated.json`; a test fails when they are stale).
   Open data, services or artwork we start using go into `code/web/src/credits/curated.json`. See `docs/design/25-credits.md`.
4. Never commit secrets. `.env` is gitignored; use `.env.example` for placeholders.
5. Project docs and specs live under `docs/`. See `docs/SPEC.md` and `docs/agents/PLAN.md`; deployment is in `docs/DEPLOY.md`.

By contributing you agree that your contributions are licensed under AGPL-3.0.
