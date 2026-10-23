# Machine verification of the curated medicine list (design, 2026-10-23)

The curated list (docs/design/13-anvisa-catalog.md section 7) drives "same active ingredient" suggestions, so a wrong ingredient is a safety risk, and it was entered by hand and never reviewed. This document describes the `verify-curated` command that cross-checks every curated entry against ANVISA's open data automatically, what it can and cannot honestly say, the state it records, and what is left for a human (checklist: docs/curated-review-checklist.md).

## 0. What this is not

It is a **machine cross-check of names, ingredients, form and route against an official file**. It is not a pharmacist's or pediatrician's review. It says nothing about age suitability, warnings, contraindications, or whether two products are interchangeable for treatment, and it never produces or checks a dose (doses come only from the doctor's prescription). `"reviewed"` stays `false` on every entry; the UI label stays "Curated list (not reviewed by a pharmacist)". Nothing in the app text, the docs or the report may call an entry "reviewed" or "clinically checked" because of this command.

## 1. Command

```bash
# Needs the importer's cache (never downloaded by this command; no database, no network):
dotnet run --project code/api/tools/Lotties.CatalogImporter -- --dry-run          # fills the cache once (and prints the plan)
dotnet run --project code/api/tools/Lotties.CatalogImporter -- verify-curated [--fix-proposals]
```

Options: `--cache-dir <dir>` (default `<temp>/lotties-anvisa-cache`, the importer's default), `--source`, `--forms-source` (explicit paths of the two CSVs), `--curated <path>` (default `Data/curated-products.json`), `--out-dir <dir>` (default `<cache-dir>/verify-curated`), `--fix-proposals`, `--help`.

- If the cache files are missing, it prints which ones and the exact importer command that downloads them, and exits with code 3.
- Writes `curated-verification.md` and `curated-verification.json` to the out dir (the cache area; **never committed**, they quote the official data) and prints a concise summary.
- Exit code: 0 = no MISMATCH and no consistency error; 1 = MISMATCH, consistency error, or a suggestion whose official ingredient sets differ; 2 = bad arguments; 3 = files missing.
- `--fix-proposals` prints proposed corrections (ingredient/form/route to the official values, and the `anvisaCheck` block to paste). It never edits the curated file.

Code: pure logic in `code/api/src/Lotties.Domain/Catalog/Official/Verification/` (`CuratedVerifier`, `CuratedVerificationRunner`, models); file readers `AnvisaFiles.ReadRegistrationDetails/ReadPresentationDetails` and the report renderers `CuratedVerificationReports` in Infrastructure; the command `VerifyCommand.cs` in the importer tool. Tests with synthetic rows only: `Lotties.Domain.Tests/Catalog/CuratedVerificationTests.cs`, `Lotties.Infrastructure.Tests/Catalog/CuratedVerificationReportTests.cs` and the checks added to `CuratedProductListTests.cs`.

## 2. How an entry is matched and judged

Match: by `registration` when the entry has one, else by the exact official name (`officialName` when set, otherwise `name`), compared without case, accents or extra spaces. Rows are grouped per registration number, or per notified product (no registration number) by name and holder. A registration is active when any of its rows is `Ativo`. Nothing is inferred: a similar name is listed as "related", never used as evidence, and an ingredient is never taken from another product.

Compared fields: active ingredients (normalised, resolved through the curated substance map, compared as sets), pharmaceutical form and route (from the CMED presentation text of the same registration, through `PharmaceuticalForms` and the route abbreviations `OR`/`NAS`/`DERM`/...), registration status (active or not). Reported as information only: holder, regulatory category, CMED strengths (the entry makes no strength claim, so there is nothing to compare), the CMED substance column.

| Status | Meaning |
|---|---|
| `VERIFIED` | One or more active official registrations; ingredient set equal to the entry's; form and route agree (or CMED has no presentation, noted). |
| `MISMATCH` | Active official registration with another ingredient set, or the same ingredients but another form or route; or only inactive records whose ingredients differ. Field-by-field diff. |
| `NOT_FOUND` | No official record with that exact name. May be exempt from registration or notification (food supplements, probiotics) or sold under another name. |
| `AMBIGUOUS` | Active official products under the name with different ingredient sets (an unlisted set counts as one). Lists them. |
| `CANCELLED` | Only inactive official records (the official import does not offer them) and their ingredients agree; notes whether CMED still prices them. |
| `UNVERIFIABLE` | An active official record exists but lists no ingredient (notified low-risk products), or the entry lists none. Inactive records of the same name that do list an ingredient are shown as context, not as evidence for the active one. Added to the five statuses of the request because "found" without a comparable ingredient must not read as verified. |

Internal consistency (errors fail the command): `DUPLICATE_ID`, `DUPLICATE_NAME` (same name and form twice), `EMPTY_INGREDIENTS`, `NAME_COLLISION` (the curated name is also an active official product with other ingredients: the Sorine rule), `EQUIVALENCE_SPLIT` (the same generic ingredient set resolves to different substance keys, so suggestions would be missed), `STALE_CHECK` (a recorded `VERIFIED` that the official data no longer supports is an error; any other difference is a warning). Warnings: `UNMAPPED_INGREDIENT` (not in the curated substance map: becomes its own substance and will not match official spellings), `INGREDIENT_SPELLING_VARIES`, `NAME_SHARED_WITH_UNLISTED` (an active official product has the same name and lists no ingredient), `BASIS_REGISTRATION` / `BASIS_REGISTRATION_UNKNOWN` (registration numbers quoted in the entry's `basis` text, checked against the file: official name, active or not, ingredient).

Suggestions: for every entry the command calls the app's own `ProductSearch.SameActiveIngredient` over in-memory `Product`s built from the official plan plus the curated plan, and for each suggested pair compares the official ingredient sets of both sides: `AGREES`, `DIFFERS` (fails the command) or `UNVERIFIED` (an entry whose official set could not be read, e.g. NOT_FOUND or UNVERIFIABLE: the suggestion rests on curated data only). It also records when the suggested product has another form than the entry.

## 3. State recorded in the curated file (machine-verified vs reviewed)

`reviewed` keeps its meaning (a pharmacist or pediatrician checked the entry; `false` everywhere). New and separate, optional per entry: `anvisaCheck: { date, status, evidence[] }`, the result of the last machine run (evidence = registration numbers, or `notified:<name>` for products without one; no bulk data), plus the verifier inputs `officialName`, `registration`, `route`. Only `status: "VERIFIED"` counts as "verified against ANVISA on <date>". A test keeps every recorded status well formed, requires evidence for `VERIFIED`, and requires `reviewed` to stay `false` unless a person changes it. Re-running the command flags a recorded status that no longer matches (`STALE_CHECK`), e.g. after the monthly ANVISA update.

UI: none changed. The curated marker is the existing "Curated list (not reviewed by a pharmacist)" line in `ProductInfo.tsx`, driven by `status == curated`; the check state is not stored in the database or the API (no column, no migration), so there is nothing for the UI to show, and a second line next to "not reviewed" would add noise for the one entry kind that could ever be VERIFIED. If the owner wants it later: add the check to the curated product's stored data (migration) and extend that one line ("Checked against Anvisa data on <date>; not reviewed by a pharmacist").

## 4. Result on the local data (2026-10-23)

Files: the cache copy downloaded 2026-10-22 (registered medicines 228,869 rows; CMED price list). Updated the same day after the owner's packaging photos added five products (12 entries now; two are aliases, see section 6). Exit code 0 (no mismatch, no inconsistency error). 7 warnings (2 `NAME_SHARED_WITH_UNLISTED` for Sorine Jet Baby and Colicaliv, whose names are active notified products without ingredient; 5 basis registrations, all consistent with the entries' basis text), 62 suggestions: 0 AGREES, 0 DIFFERS, 62 UNVERIFIED (40 of another form than the entry; the first run, before the five entries, had 36 of 42).

| Entry | Status | Evidence (registration or notified name) | What the official data says |
|---|---|---|---|
| `flygas-drops` Flygas (now an alias of `fly-gotas-drops`) | NOT_FOUND | none | No registration or notification named Flygas: it is not a product, only the owner's wording for Fly Gotas. |
| `fly-gotas-drops` Fly Gotas (150 mg/mL; 15 mL; packaging) | CANCELLED | notified:FLY GOTAS (inactive) | Only inactive notified FLY GOTAS records (Biolab, low risk, 2024 and 2025) exist and they list no ingredient. The product is on the shelf, so a newer notification under another record or name is likely; the data cannot confirm composition or concentration. |
| `colicaliv-drops` Colicaliv (homeopathic; 30 mL; packaging) | UNVERIFIABLE | notified:COLICALIV | An active notified COLICALIV (Herbarium, "dinamizado") exists and lists no ingredient; four other COLICALIV records are inactive. Homeopathic products are registered or notified without a composition column in this file, so the four ingredients rest on the packaging only. |
| `rinosoro-jet-infantil-spray` Rinosoro Jet Infantil (0,9%; 100 mL; packaging) | UNVERIFIABLE | notified:RINOSORO JET | Looked up by the broader official name "Rinosoro Jet" (active, no ingredient listed); the data does not say whether that record is the Infantil presentation. No record is named "Rinosoro Jet Infantil". |
| `sorine-jet-baby-spray` Sorine Jet Baby (0,9%; 100 mL; packaging) | UNVERIFIABLE | notified:SORINE JET BABY | An active notified SORINE JET BABY (Aché, low risk) exists and lists no ingredient. The name rule holds: the registered plain "Sorine" is naphazoline and is not this product. |
| `sorine-infantil-jet-baby-spray` Sorine Infantil Jet Baby (alias of Sorine Jet Baby) | NOT_FOUND | none | The shop label's name; an alias, not a product. |
| `luftal-drops` Luftal | CANCELLED | 101800120, 173900009 (both inactive); also an inactive notified LUFTAL without ingredient | Both inactive Luftal registrations list simeticona, which agrees with the entry; CMED (173900009) still prices drops and tablets, oral route. Not offered by the official import, so the curated entry is the only Luftal in the app. |
| `colidis-drops` Colidis (supplement; 10 mL; packaging) | NOT_FOUND | none | Not registered (a food supplement per the packaging and the manufacturer page in the basis). L. reuteri DSM 17938 cannot be checked against ANVISA medicine data. |
| `sorine-saline-spray` Sorine Solução Nasal Salina | UNVERIFIABLE | notified:SORINE SSC (active) | Active notified product "Sorine SSC" lists no ingredient. An inactive registration of the same name (105730362) lists cloreto de sódio, which is context only. |
| `sorine-saline-drops` Sorine Solução Nasal Salina | AMBIGUOUS | notified:SORINE (active), 105730050 (active) | The plain name "Sorine" is naphazoline (105730050, nasal drops) and an unlisted notified product. This is exactly why the curated names say "Solução Nasal Salina". |
| `rinosoro-saline-spray` Rinosoro Solução Nasal Salina | UNVERIFIABLE | notified:RINOSORO SIC (active) | Active notified product lists no ingredient; inactive registrations of RINOSORO SIC (103940526, 178170081, 172870152) list cloreto de sódio (context only). |
| `rinosoro-saline-drops` Rinosoro Solução Nasal Salina | UNVERIFIABLE | notified:RINOSORO GOTAS (active) | Active notified product lists no ingredient. |

Findings of note:
- **No entry is clearly wrong**, so no curated ingredient was changed. Nothing reached VERIFIED either: the data cannot confirm any entry (notified products list no ingredient, the others are unregistered, inactive or ambiguous). The ingredient of every entry therefore still rests on its `basis` (for the five newest: the owner's packaging photo, read by the orchestrator) and needs the human checklist. The packaging is the first primary source for composition and concentration, but it is a photo read by a person, not data.
- **"Flygas" is not a product.** The name does not exist in the official data; the product the owner bought is Biolab's "Fly Gotas 150" (simethicone 150 mg/mL), which the data knows only as an inactive notified record. `flygas-drops` stays (stable id, existing medications may use it) and became an alias of `fly-gotas-drops`.
- **Concentrations differ inside one ingredient set.** Fly Gotas is 150 mg/mL and Luftal drops 75 mg/mL (CMED); the app still treats them as "same ingredient", now with the 150 mg/mL on the product's presentation line. The structured strength is not stored, so the rule cannot separate them (section 6).
- The name rule works: no curated name collides with an active official product with other ingredients (`NAME_COLLISION` would have failed the command).
- **Suggestions cross forms and concentrations.** Each saline entry gets 10 "same active ingredient" suggestions; 36 of the 42 suggestions in total have another form than the entry. They are official sodium chloride products of other forms (for example an irrigation solution; the verifier does not read concentrations, so some may be hypertonic), because the suggestion rule is only "same ingredient set". That is information the app already shows with "ask your doctor or pharmacist"; whether sodium chloride suggestions should be restricted (same form, or exclude `other`) is a product decision for the owner and a pharmacist question, not changed here.
- Registered-medicine rows hold no strength and no form; the form and route come from CMED, which has no presentation for notified products, so the saline entries' form and route cannot be machine-checked at all.

## 5. Label facts, categories and aliases (curated file fields added 2026-10-23)

Optional per-entry fields, all validated by the planner and the verifier: `strength` (concentration exactly as printed), `packageSize`, `category` (`medicine`, `homeopathic`, `supplement`), `aliasOf` (id of another entry). `strength; packageSize` is stored as the product's `presentation` text. New consistency errors: `ALIAS_TARGET` (alias that points to nothing, to an alias, or to a product with another form or ingredient set), `CATEGORY_EQUIVALENCE` (entries of two categories share an ingredient set; no category counts as `medicine`), `UNKNOWN_CATEGORY`. Alias entries are not verified as products' suggestions (never offered as alternatives); their own row still shows the official lookup of the name.

## 6. Suggestions: what changed in the rule, and what did not

- **Equivalence stays exact ingredient-set equality** (`Product.HasSameActiveIngredientsAs`). Colicaliv's four homeopathic ingredients are four substances of their own (`matricaria_chamomilla_4ch`, `mentha_piperita_6ch`, `magnesia_phosphorica_5ch`, `colocynthis_6ch`: the potency is part of the key), so it can only be a sibling of a product with exactly those four, and never of simethicone, Luftal or Fly Gotas, and vice versa. Colidis (a supplement, L. reuteri) is the same. Tests prove it on the real curated list (`CuratedProductListTests`) and on synthetic sets (`OfficialProductTests`), and the verifier fails on a category clash.
- **New (safe) ordering:** `ProductSearch.SameActiveIngredient` lists, among the products with the same ingredients and one per name, first those in the same *known* form as the searched product (form `other` = unknown never counts as the same), then official, curated, community, by name. Nothing was removed from or added to the list: only the order, so a spray's first suggestions are sprays, and the cap of 10 now keeps same-form ones first. The response already carries each sibling's form, so the app can show that it differs.
- **Not done, deliberately:** a strength-aware rule ("same ingredient AND same strength AND same form"). Official products have no strength in the data the importer reads (the registered-medicines file has none; CMED strengths are not imported), imported products never carry a structured strength (`ProductSubstance.Strength` is cleared by the importer, and keeping a strength through updates needs a data model change and migration), and a free-text presentation like `150 mg/mL` cannot be compared safely. Restricting by form alone would also drop legitimate other-form listings the app shows today, so only the order changed. Whether saline suggestions should be limited to nasal products, or hypertonic ones excluded (the official "Hipertonic" drops and "Maresis Ht" still appear next to the 0,9% sprays), needs concentrations in the data first: a pharmacist question (checklist) and a possible next feature (import CMED strengths).
- **Limits of the effect:** the sibling pool is the first 50 products per ingredient set, official first by name, so a curated product can still miss the pool for a very common ingredient; the order change only applies inside the pool.

## 7. Running it again

After each monthly ANVISA refresh (`--refresh` on the importer) run `verify-curated --fix-proposals`. A status change is a signal to look at the entry: a `VERIFIED` that turns `CANCELLED` means the product left the market register; `UNVERIFIABLE` turning `VERIFIED` means ANVISA now lists the ingredient. Paste the proposed `anvisaCheck` blocks by hand, keep `reviewed: false`, and commit only the curated file and docs, never the generated reports or the CSVs.
