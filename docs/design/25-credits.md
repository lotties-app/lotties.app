# Credits and open-source acknowledgements (design, 2026-10-23)

Owner request: the app must credit, very explicitly, the open-source libraries, data sources and integrations it builds on. Lotties is AGPL-3.0 itself and uses third-party software and public data. The credits must be visible before sign-in (landing page), inside the signed-in app, and in the GitHub repository.

## 1. Decisions

- **One source of truth, generated.** `code/web/scripts/generate-credits.mjs` (Node, no dependencies; shared logic in `credits-lib.mjs`) reads the real dependency files and writes every surface:
  - `code/web/src/credits/third-party.generated.json`: the package list (name, version, SPDX license, homepage, repository, direct flag, license text id), loaded lazily by the credits page;
  - `third-party-licenses.generated.json`: the license texts by id (identical texts share an id), a separate lazy chunk fetched when the first text is opened;
  - `third-party-summary.generated.json`: count and headline names, the only data the landing page imports (a few hundred bytes);
  - `CREDITS.md` (the thanks page: data and services, direct dependencies, compact list of indirect ones) and `THIRD_PARTY_NOTICES.md` (every license text, each once) at the repository root.
- **Hand-written part is small and typed.** `code/web/src/credits/curated.json` (names, links, license names of data sources, services, platforms, fonts, icons, our artwork) with `curatedCredits.ts` (types; `CuratedId` must have a sentence in `credits.curated.<id>` of both `credits.json` files, a test checks it). The sentence about what each is used for is i18n text (en and pt-BR); the generator writes the English one into `CREDITS.md`. Names, links and licenses are facts and stay as published.
- **What counts as "shipped".** npm: the lock file's production tree (`npm ci --omit=dev` semantics: entries without `dev`/`devOptional`) of `code/web` and `code/mobile`, minus packages that are only there as an optional peer of a dev dependency (typescript via cosmiconfig), plus `workbox-precaching` and `workbox-routing` with their dependencies: package.json lists them under devDependencies but the service worker bundles them (`SHIPPED_DEV_DEPENDENCIES` in `credits-lib.mjs`). Build and test tools (Vite, Vitest, TypeScript, ESLint, Prettier, Playwright, sharp) are credited in one curated line ("not part of what runs on your phone"), not package by package. NuGet: the closure of the PackageReferences of the four `code/api/src` projects from `obj/project.assets.json` (so `dotnet restore code/api/Lotties.sln` first), minus `Microsoft.EntityFrameworkCore.Design` (PrivateAssets=all, design time only). The ASP.NET Core shared framework is not a package: curated entry ".NET and ASP.NET Core".
- **License text.** npm: the license file of the package folder (MIT/BSD/ISC/Apache notices with their copyright lines). NuGet packages ship no license file, only an SPDX id in the `.nuspec`: for MIT, PostgreSQL and Apache-2.0 the notice is the package's own `<copyright>` (or authors) line plus the standard text of that license (Apache: the standard "Licensed under..." notice with the link, not the full 11 kB text). Nothing is synthesized for any other license; a package without text shows "does not ship a license file, license X, standard text at spdx.org".
- **Not credited on purpose.** Brevo: only `docs/DEPLOY.md` mentions it as one possible SMTP relay for Keycloak emails and `code/keycloak-theme/deploy/configure-realm-smtp.sh` is generic SMTP; the app itself uses no Brevo API or SDK. Credit it only if the owner makes it the documented production relay. OneSignal/FCM: not used (docs/design/09). No analytics or tracking service exists.
- **No endorsement.** Every surface says: naming a source or project credits it and does not mean that it endorses, reviewed or is affiliated with Lotties. SBP and SBIm are "references, only scheduling facts used, with attribution". The Ministry of Health calendar is CC BY-ND 3.0: we show attribution and say the app shows facts reorganized in our own words, not the original document (docs/design/17 section 2; the owner's reading of ND for factual data is still pending there, R-DOC-1).

## 2. Surfaces

| Where | What |
| --- | --- |
| Landing page (`/`, signed out) | A visible section "Built on open source" (`landing/OpenSourceStrip.tsx`, h2, after "How it works"): thanks sentence, the package count and a few direct dependency names (from the generated summary), AGPL-3.0 and "not a medical device" lines, button "See all credits and licenses" (`/credits`) and the source link. The footer also links "Credits and licenses". The existing medical callout keeps its place and prominence |
| `/credits` (public) | `credits/CreditsPage.tsx`, lazy chunk, declared in `AppRoutes.tsx` above `LandingGate`/`RequireAuth`, so it needs no sign-in (and a signed-in user opening it sees the same page). The service worker's navigation fallback serves the app shell for any path and every chunk is precached, so it also opens offline |
| Hub > App > Credits and licenses | Entry `credits` in `hub/hubEntries.ts` (visible to every role, also with no baby and in the native app), route `/hub/credits` (`HubCreditsPage` in `pages/HubSubPages.tsx`), same `CreditsContent` inside the app shell |
| About | One link line "Built on open source. Credits and licenses" to `/hub/credits` |
| Doctor shell | `/doctor/credits` (`DoctorCreditsPage`), linked from her account menu (`layout/UserMenu.tsx`, doctor mode only; the Hub is not part of her shell). `navModel.ts` treats `credits` like `settings` (not a patient id) |
| Repository | `CREDITS.md`, `THIRD_PARTY_NOTICES.md`, a "Credits and open-source acknowledgements" section in `README.md`, mentioned in `CONTRIBUTING.md` |
| Store listings | Include the public URL https://lotties.app/credits (docs/MOBILE-RELEASE.md) |

Page (`credits/CreditsContent.tsx`, no h1 of its own; the route supplies it): sections as h2 "Our license and source", "Data and services" (h3 per kind: data sources, services we call, platforms and standards, fonts/icons/artwork), "Open-source software we build on" (direct dependencies grouped web/mobile and server, with version, license and link), "All packages and license texts" (a button reveals the list; a search box filters by name, version or license; each row has a License button that expands its text in a keyboard-focusable `pre` region with `lang="en"`; license texts stay original English). External links use `ExternalLink`: a normal `target="_blank" rel="noopener noreferrer"` link with a visually hidden "(opens in a new window)", and inside the native app `isNativeApp()` makes it open the system browser through `platform/nativeShell` (`openBrowser`). Layout is one column at 320-430 px (`overflow-wrap: anywhere`, 44 px targets), colors only from theme tokens (axe tests in light and dark, en and pt-BR).

## 3. Regenerating (do it when dependencies change)

```bash
dotnet restore code/api/Lotties.sln          # NuGet closure comes from obj/project.assets.json
node code/web/scripts/generate-credits.mjs   # writes the 3 JSON files, CREDITS.md and THIRD_PARTY_NOTICES.md
node code/web/scripts/generate-credits.mjs --check   # writes nothing, exit 1 when stale
```

Run it after any change to `code/web/package.json`/lock, `code/mobile/package.json`/lock or a `PackageReference` (also after a plain update). It needs `node_modules` of `code/web` and `code/mobile` (license files) and the NuGet cache; the orchestrator runs it in the main clone after the dependency change (workers do not change dependencies, docs/PROCESS.md). `npm --prefix code/web run test` fails (`src/credits/thirdParty.test.ts`) when a production package of either lock file or a `PackageReference` is missing from the generated list, when `CREDITS.md`/`THIRD_PARTY_NOTICES.md` do not mention the packages, or when any package has a license that is not on the reviewed list. The test reads only lock files and `.csproj` files, so it needs neither `node_modules` nor a restore. The `--check` run is the stricter check (versions and texts).

A new curated credit: add it to `curated.json`, add `credits.curated.<id>` to both `credits.json` files, run the generator.

## 4. License review (generated list, 2026-10-23)

155 packages: 141 MIT, 4 Apache-2.0, 3 ISC, 3 BSD-3-Clause, 2 PostgreSQL (Npgsql), 1 OFL-1.1 (Fraunces font), 1 0BSD. `classifyLicense` in `credits-lib.mjs` lists the permissive ids (MIT, ISC, BSD-2/3, Apache-2.0, 0BSD, Zlib, Unlicense, CC0, BlueOak) and the individually reviewed ones (`REVIEWED_LICENSES`): the generator prints them and the test fails for anything else.

- **Apache-2.0** is compatible with AGPL-3.0 (one-way, into a v3 work). Apache packages: dexie, dexie-react-hooks, oidc-client-ts, EFCore.NamingConventions.
- **PostgreSQL License** (Npgsql, Npgsql.EntityFrameworkCore.PostgreSQL): permissive, BSD/MIT-like, OSI approved, compatible.
- **OFL-1.1** (Fraunces via Fontsource): fonts may be bundled in an app; the font files are not sold alone and keep their notice (the license file is in the notices).
- **CC BY-ND 3.0** (Ministério da Saúde calendar) is content, not code, and ND forbids distributing adaptations of the documents: we copy no text, table or artwork, only facts. This is the one item that depends on a reading of ND (still the owner's decision, docs/design/17 R-DOC-1). SBP and SBIm are all rights reserved: facts only, attribution, no endorsement.
- **ODbL** (OpenStreetMap): attribution shown; coordinates not stored; produced text allowed (docs/design/23 section 6).
- Nothing is GPL/AGPL/SSPL-incompatible. Not covered by the tooling: native Gradle/CocoaPods/SwiftPM libraries the Capacitor Android and iOS projects pull in at build (AndroidX, Google Material, Capacitor's own native code): they are named by the store builds, not by this list; Capacitor's native code is MIT and is in the list as `@capacitor/android` and `@capacitor/ios`. Listing AndroidX etc. would need a Gradle license plugin and is left out.
- Keycloak (Apache-2.0) and PostgreSQL run as separate services and Keycloakify (MIT) builds the login theme in `code/keycloak-theme` (own lock file, not part of the web bundle): credited as curated entries, not generated.

## 5. Not done

- No per-package changelog or SBOM export (CycloneDX/SPDX). The JSON could feed one later.
- The Gradle/CocoaPods native dependency list (section 4).
- The Keycloak theme's own npm tree is not listed package by package (it is a separate build that runs inside the identity provider).
- The credits are not translated per license text (original English by design).
