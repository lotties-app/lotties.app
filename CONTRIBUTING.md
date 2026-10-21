# Contributing

Thanks for helping out.

1. Open an issue first for larger changes so we can agree on the approach.
2. Fork, create a branch from `main`, and keep changes focused.
3. Before opening a pull request, make sure these pass:
   - `dotnet build api/BabyRoutine.sln` and `dotnet test api/BabyRoutine.sln`
   - `npm --prefix web run lint`, `npm --prefix web run test -- --run`, `npm --prefix web run build`
4. Never commit secrets. `.env` is gitignored; use `.env.example` for placeholders.
5. Project docs and specs live under `docs/`. See `docs/SPEC.md` and `docs/PLAN.md`; deployment is in `docs/DEPLOY.md`.

By contributing you agree that your contributions are licensed under AGPL-3.0.
