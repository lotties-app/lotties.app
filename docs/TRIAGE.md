# Issue triage

Public issues on `lotties-app/lotties.app` and the internal project board (`/hub/board`, see `docs/KEYCLOAK-BOARD.md`) are two views of the same work. The board is the source of truth for planning; a public issue is the intake.

## Labels

- Kind: `bug`, `enhancement`, `question`, `documentation`
- State: `needs-triage` (set by templates), `confirmed`, `needs-info`, `blocked`, `wontfix`, `duplicate`
- Area: `area:web`, `area:api`, `area:mobile`, `area:keycloak`, `area:deploy`, `area:docs`
- Other: `good first issue`, `help wanted`, `accessibility`, `invalid`, `privacy`, `security` (never public detail)

## Flow

1. New issue gets `needs-triage`. Within a week: remove it and set kind and area, or ask with `needs-info`.
2. Confirmed work gets a board item (topic, gap or decision) that links the issue; the issue links back by item id.
3. Close the issue when the fix is deployed, quoting the release number.
4. Anything touching a child's data, privacy or security: move to a private advisory, strip the public text.

All of these labels exist on `lotties-app/lotties.app` (created 2026-10-27 with the GitHub CLI; to recreate one: `gh label create <name> --color <hex> --description "..." -R lotties-app/lotties.app`).
