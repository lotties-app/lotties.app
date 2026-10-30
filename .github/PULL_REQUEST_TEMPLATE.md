## What and why

<!-- Link the issue. Larger changes should have one first. -->

## Checks

- [ ] `dotnet build code/api/Lotties.sln` and `dotnet test code/api/Lotties.sln`
- [ ] `npm --prefix code/web run lint`, `test -- --run`, `build`
- [ ] New UI strings go through `t()` in both `en` and `pt-BR`
- [ ] New API route has a row in `EndpointRoleMatrixTests`
- [ ] Dependency changed: credits regenerated (`node code/web/scripts/generate-credits.mjs`)
- [ ] No secrets, no real child data, no `.env` content
- [ ] Docs and `docs/agents/filemap.md` updated when files moved or were added
