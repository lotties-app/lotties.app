# Official medicine list from ANVISA, plus a curated list (design, 2026-10-22)

Owner request: look up alternatives of a medicine by name ("Flygas is similar to simeticona, which is similar to Luftal"). The shared catalog already links products to active substances and shows "Contains the same active ingredient as ...", but it was empty (6 seeded substances, no products). This document covers the importer of Brazil's official open data into the catalog, the small curated list next to it, the ingredient search, and the safety rules around them.

## 0. Guardrails

The guardrails of docs/design/06-medications.md section 0 apply unchanged: the app is not a medical device, the doctor's prescription is the only source of a dose, nothing is ever substituted automatically, and "same active ingredient" is information only ("Ask your doctor or pharmacist before substituting."). The import adds brand names, forms and active ingredients only: no dose, strength, price, indication or company data.

The links between products are derived from official registration data, **not reviewed by a pharmacist**. They must not be treated as medical advice or as a substitution table (two products with the same active ingredient can differ in strength, form, excipients and indication). The app says so next to the attribution.

Safety rules added after the first review (the registered-medicines file reuses brand names for different products: "Sorine" is a naphazoline decongestant in its only active registration, while the saline "Sorine" that parents mean is a notified product without registration or ingredient):
- **Never infer an ingredient** from another product with the same name, from the name itself, or from another registration. An empty ingredient field is inherited only from other rows of the *same* registration number; otherwise the product is imported without ingredients and shown as "Ingredient not listed in the official data".
- **Never merge different ingredient sets under one name.** A name used by products with different ingredient sets becomes one product per (name, ingredient set, form); each variant's name carries its ingredients ("Sorine (cloridrato de nafazolina)", "Sorine (princípio ativo não informado)") and is marked with the shared name (`ambiguous_name`). Search shows all variants together and each says "Different products share this name with different ingredients. Check the box."
- **Inactive rows never create or revive a product**; they only feed ingredient inheritance within their registration.
- Products missing or ambiguous in the official data that parents commonly mean come from a small **curated list**, kept apart (status `curated`, source `curated`, label "Curated list (not reviewed by a pharmacist)"), never mixed into the official records (section 7).

## 1. Source (checked 2026-10-22)

ANVISA publishes its open data as plain files at `https://dados.anvisa.gov.br/dados/` (a directory listing; the national catalog dados.gov.br links to these files).

| File | URL | Size / rows | Encoding, format | Updated |
|---|---|---|---|---|
| Registered medicines (primary) | `https://dados.anvisa.gov.br/dados/DADOS_ABERTOS_MEDICAMENTOS.csv` | 45,920,138 bytes; 228,869 rows + header | Windows-1252 ("ANSI 1252" per the dictionary; 27 bytes in 0x80-0x9F, so not plain ISO-8859-1), `;` delimiter, fields quoted with `"` | Last-Modified 2026-10-13; dictionary: monthly, data up to the last day of the previous month |
| CMED price list (forms) | `https://dados.anvisa.gov.br/dados/TA_PRECO_MEDICAMENTO.csv` | 17,148,070 bytes; 26,635 presentations | UTF-8 with BOM, `;` delimiter | Last-Modified 2026-10-09 (CMED publishes about monthly) |

Columns of the registered-medicines file: `TIPO_PRODUTO; NOME_PRODUTO; DATA_FINALIZACAO_PROCESSO; CATEGORIA_REGULATORIA; NUMERO_REGISTRO_PRODUTO; DATA_VENCIMENTO_REGISTRO; NUMERO_PROCESSO; CLASSE_TERAPEUTICA; EMPRESA_DETENTORA_REGISTRO; SITUACAO_REGISTRO; PRINCIPIO_ATIVO` (the names `NO_PRODUTO`/`NO_PRINCIPIO_ATIVO` assumed in the brief do not exist). The importer reads `NOME_PRODUTO`, `NUMERO_REGISTRO_PRODUTO`, `SITUACAO_REGISTRO` (`Ativo`/`Inativo`) and `PRINCIPIO_ATIVO` (comma-separated, lower case). It has **no pharmaceutical form**: the form comes from the CMED price list, whose `REGISTRO` is the 13-digit presentation registration (its first nine digits are the product registration) and whose `APRESENTAÇÃO` describes form, strength and package with ANVISA's abbreviations (e.g. `75 MG/ML EMU OR CT FR PLAS OPC GOT X 15 ML`). Of the price list the importer reads only `REGISTRO`, `PRODUTO` and `APRESENTAÇÃO`, never prices, CNPJ, EAN or therapeutic class.

Data dictionaries: `https://dados.anvisa.gov.br/dados/Documentacao_e_Dicionario_de_Dados_Registros_Validos_Medicamento_V1.pdf` (December 2020: fields, monthly update, `;`, encoding 1252) and `https://dados.anvisa.gov.br/dados/TA_PRECO_MEDICAMENTO%20-%20Dicionario%20de%20Dados.pdf` (field meanings: `APRESENTAÇÃO` = form, strength and quantity; `REGISTRO` = registration number).

## 2. Licence and terms of reuse (finding)

- Decree 8.777/2016 (Política de Dados Abertos do Poder Executivo federal, `https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2016/decreto/d8777.htm`) applies to ANVISA (a federal autarchy). It defines open data as data under an open licence allowing free use, "limitando-se a creditar a autoria ou a fonte" (art. 2, III), lists unrestricted reuse of published open databases as a principle (art. 3, IV), and states that the data published by the federal executive are free to use by public bodies and society (art. 4, wording of Decree 9.903/2019, which also authorises free use of databases whose copyright belongs to the Union).
- dados.gov.br (read through its public API on 2026-10-22): "Preço de Medicamentos no Brasil – Consumidor" (resource `TA_PRECO_MEDICAMENTO.csv`) is licensed "Other (Public Domain)"; ANVISA's sibling datasets "Produtos ... Registrados no Brasil" (health products, cannabis, cosmetics, sanitising products, tobacco) are "Creative Commons Attribution". The page of the registered-medicines dataset (`medicamentos-registrados-no-brasil`) no longer exists on the current portal (404), so its own licence label could not be read; the earlier CKAN listing is reported by search engines as Creative Commons Attribution.
- The footer of ANVISA's website (gov.br) puts the *site content* under CC BY-ND 3.0. That covers the web pages, not the open data files published under the decree; nothing from the web pages is copied. Recorded as a residual doubt for the owner (section 11).

Conclusion: reuse, transformation and redistribution inside the app are allowed with attribution of the source. The import was built.

Attribution wording (shown in the app wherever an official product is listed, i18n `medications.catalog.officialAttribution`):
- en: "Source: Anvisa open data (registered medicines and the CMED price list). Not reviewed by a pharmacist; not medical advice."
- pt-BR: "Fonte: dados abertos da Anvisa (medicamentos registrados e lista de preços da CMED). Não revisado por farmacêutico; não é orientação médica."
- Each official product carries "Official list (ANVISA)" / "Lista oficial (Anvisa)"; each curated product "Curated list (not reviewed by a pharmacist)" / "Lista curada (não revisada por farmacêutico)".
- For docs and the repository: "Medicine names, forms and active ingredients: Agência Nacional de Vigilância Sanitária (Anvisa), open data (dados.anvisa.gov.br: DADOS_ABERTOS_MEDICAMENTOS.csv and TA_PRECO_MEDICAMENTO.csv), reorganised by Lotties; not reviewed by a pharmacist."

Privacy: the files hold no personal data (registration holders are companies, and the importer does not store them). Nothing about families or babies is sent anywhere by the importer.

## 3. Mapping rules (pure Domain: `code/api/src/Lotties.Domain/Catalog/Official/`)

1. **Records.** Rows with a registration number are grouped by `NUMERO_REGISTRO_PRODUTO` (digits only, nine digits with leading zeros restored); a registration repeats on several rows that differ only in `SITUACAO_REGISTRO`. Rows without a registration number are notified low-risk products (21,495 rows; most saline sprays, "Simeticona gotas" of small makers, "Luftal Gel Caps").
2. **Inclusion.** A registration is imported only when one of its rows is `Ativo`; active notified rows are imported by name. Inactive rows never create or revive a product, even when the CMED price list still prices the registration (707 such registrations, Luftal 1.7390.0009 among them; the curated list covers the ones parents need, section 7).
3. **Ingredients** (`ActiveIngredientNames`, `SubstanceDictionary`): the ingredient field of the registration's active rows; if empty, the first non-empty field of *another row of the same registration number* (inheritance; the current file has no such case, every registration repeats the same field); if still empty, none. A notified row has only its own field (usually empty). Nothing is taken from another registration, another product or the name. The field is split on commas (the only separator the file uses between ingredients), regulatory notes such as `(port. 344/98 lista c 1)` are dropped, duplicates removed. Each name is looked up (case and accents ignored) in the curated substance map `code/api/src/Lotties.Infrastructure/Catalog/Official/curated-substances.json`: one data file with, per substance, the catalog key (the seed key for the six seeded substances, whose names must stay identical to the seed, which a test checks), the English (INN/USAN) and Brazilian (DCB) generic names, synonyms, and the source spellings grouped under it. Only salts, esters, hydrates and spelling variants of the same active moiety are grouped (`dipirona`, `dipirona monoidratada`, `dipirona sódica` -> metamizole; `amoxicilina tri-hidratada`/`trihidratada` -> amoxicillin; `cloridrato de nafazolina` -> naphazoline). 51 substances are curated (common pediatric and OTC ones). Any other name becomes its own substance: key = ASCII lower snake_case slug of the name (a leading digit gets `s_`, keys over 50 characters keep their start plus an 8-hex hash), both names = the source name in title case (no translation is invented). `dimeticona` is deliberately **not** grouped with simethicone (simethicone is dimethicone with silica; DCB lists them apart). Products with more than 40 ingredients keep no ingredient links (none in the current data).
4. **Form** (`PharmaceuticalForms`), from each CMED presentation of the registration, first rule wins: injectable/infusion/diluent/dialysis -> other; `SUP` -> suppository; inhalation aerosol or powder (`INAL` with `AER`/`PO`/`CAP`, or `AER` not for skin/mouth/nose) -> inhaler; `SPR`/`SPRAY`/`JET`, a skin/mouth/nose aerosol, or a nasal solution without a dropper -> spray; `GOT` (dropper) -> drops; `XPE` -> syrup; `POM`, `CREM`, or a gel that is not a capsule -> ointment; `COM`/`DRG` -> tablet; `PO`/`GRAN` -> powder; else other. Capsules, oral solutions and suspensions without a dropper, lotions and patches stay "other" (the catalog has no such forms; "tablet" or "syrup" would misname them). Registrations without presentations and notified products get "other".
5. **Products.** One catalog product per (normalized name, ingredient set, form): the same brand name is often registered several times (one registration per manufacturer of a generic) and one registration covers several forms (Novalgina 1.8620.0018: drops, tablet, suppository, injectable). An "other" product that exists only because a registration had no presentations is dropped when the same name and ingredients have a real form.
6. **Ambiguous names.** When the included records of one normalized name have different ingredient sets (an empty set counts as a set), every variant's display name gets its ingredients in parentheses, as the source writes them (`Sorine (cloridrato de nafazolina)`), or `(princípio ativo não informado)` when none is listed, and `ambiguous_name` holds the shared name (`Sorine`). 127 names, 313 products in the current data, mostly generics and IV fluids spelled several ways (`Amoxicilina (amoxicilina trihidratada)`). Names longer than 100 characters are cut with "…" and numbered if two cuts collide.
7. **Names** (`OfficialNames`): title case with Portuguese connectors in lower case (`SIMETICONA + METILBROMETO DE HOMATROPINA` -> `Simeticona + Metilbrometo de Homatropina`), words with digits kept upper case (`Vitamina D3`), and a trailing dosage (a number with a unit: `MANITOL 20%`) moved to the product's `presentation` (shown after the form).
8. **Keys.** `external_ref` = `{normalized name}:{form}` (the name already carries the ingredients of ambiguous variants), unique per `source` (`anvisa`). Deterministic UUID v5 ids (`OfficialCatalogImporter.IdNamespace`, per source and ref), so replays on any database create the same ids.
9. **Writes** (`OfficialCatalogImporter`, Infrastructure, one transaction, batches of 500): substances are matched by key and only added, never changed (seeded rows included). A product is matched by (`source`, `external_ref`), else by the catalog key (normalized name, form, BR) among non-merged products: a product of the same source is updated in place; a community product is **adopted** (becomes official or curated, keeps its id and medication links, takes the source's ingredients) only when the planned product lists ingredients, otherwise the planned product is skipped and the community product stays as it is; a product of the other source keeps its key and the planned product is skipped (both reported). A row is written only when something changed. Products of a source that left it are **retired** (`inactive_since`), never deleted; `--limit` runs never retire.

Schema (migration `ProductExternalRef`, after `DiaperHeadsUpPrefs`, not applied anywhere yet when it was amended): nullable `products.source` (32), `external_ref` (128), `presentation` (100), `ambiguous_name` (100), `inactive_since` (timestamptz) and the partial unique index `ix_products_source_external_ref` on (`source`, `external_ref`) where both are set. `ProductStatus` gains `official` and `curated` (stored as text).

## 4. Search and API

- `GET /catalog/products?q=` searches names and ingredients as before (accent-insensitive compact keys, prefix and typo buckets: plain `LIKE`/length predicates, no `pg_trgm`, so SQLite tests and PostgreSQL behave the same). `simeticona`, `simethicone`, `SIMETHICONE`, `luftal` and the typo `simethicon` all work. New rules: retired products are never offered; a substance that is only a typo away counts only when no substance matched exactly or by prefix (otherwise `simeticona` also brought dimeticona products); every variant of an ambiguous name follows its first result matched by name, so all variants show together (results matched through an ingredient are not expanded: the other variants do not contain it); `sameActiveIngredient` lists active products with exactly the same substance set, official first, then curated, then the rest, by name, one per name (the same brand in another form is not a sibling), at most 10.
- `GET /catalog/substances/{substanceId}/products?offset=&limit=` (new): one page (default 20, at most 50) of the active products containing the substance, combinations included, official first, then curated, then the rest, by name, with the total; 404 `substance_not_found`; global per-user rate limit like the other catalog reads.
- `ProductDto` gains `source`, `presentation`, `inactive` and `ambiguousName` (additive); `status` gains `official` and `curated`. Contract details: docs/SPEC.md "Medications: catalog, prescriptions, status".

## 5. Offline and sync (decision)

The catalog was never part of the delta sync: search is online (`GET /catalog/products?q=`), and the device keeps a cache of at most 200 products (Dexie `catalogProducts`, most recently used) for offline search and for the details of linked products. With thousands of official products this stays the design:
- official products are searched online only; search results that are official are **not** cached (community, seed and curated results still are), only the official product the parent picks;
- the sync pull fetches the products the family's medications link to and the device lacks (`GET /catalog/products/{id}`, at most 20 per baby and pull, best effort), so every device of the family shows the linked product's form and ingredients and finds it offline; the catalog itself is never pulled (a test checks that no other catalog request is made);
- the offline fallback lists siblings like the API (active, official then curated first, not the same name).

## 6. Web

In the medication picker (prescription editor and Settings), results matched by name come first, with every variant of an ambiguous name next to each other; results matched through an ingredient are a separate section "Products with this ingredient" / "Produtos com este princípio ativo" with the line "Information only. Ask your doctor or pharmacist before substituting."; tapping one selects it like any result. Each row shows form and ingredients under the name; an official or curated product without ingredients says "Ingredient not listed in the official data" / "Princípio ativo não informado nos dados oficiais"; each variant of an ambiguous name says "Different products share this name with different ingredients. Check the box." / "Produtos diferentes usam este nome com princípios ativos diferentes. Confira a embalagem."; official products carry "Official list (ANVISA)", curated ones "Curated list (not reviewed by a pharmacist)", and the ANVISA attribution (section 2) is shown once under the results whenever an official product is listed. The existing "Contains the same active ingredient as ..." note is unchanged. Strings in en and pt-BR; component, axe and pt-BR tests in `code/web/src/medications/catalog.test.tsx`.

## 7. Curated list

`code/api/tools/Lotties.CatalogImporter/Data/curated-products.json` holds common Brazilian baby products that are missing or ambiguous in the official data. It is imported with the official list (status `curated`, source `curated`, external ref = entry id) and is clearly separate from it in data and UI.

**Not reviewed.** Every entry has `"reviewed": false`. Curated entries need a pharmacist or pediatrician review before being trusted; until then the app labels them "Curated list (not reviewed by a pharmacist)". A test (`code/api/tests/Lotties.Infrastructure.Tests/Catalog/CuratedProductListTests.cs`) checks the file loads, that no entry is marked reviewed, and the entries below.

| Id | Name | Form | Ingredient | Basis |
|---|---|---|---|---|
| `fly-gotas-drops` | Fly Gotas (150 mg/mL; 15 mL) | drops | simethicone | packaging photo provided by the owner, 2026-10-23 (Biolab, emulsão oral); the ANVISA file has an inactive notified FLY GOTAS without ingredient |
| `flygas-drops` | Flygas (alias of Fly Gotas) | drops | simethicone | the owner's earlier wording; no product named Flygas exists in the ANVISA file or CMED. Kept only as an alias (`aliasOf`), see below |
| `luftal-drops` | Luftal | drops | simethicone | CMED price list (LUFTAL 1739000090031, substance SIMETICONA); its registry rows are all inactive, so the official import leaves it out; owner statement |
| `colicaliv-drops` | Colicaliv (30 mL) | drops | Matricaria chamomilla 4CH, Mentha piperita 6CH, Magnesia phosphorica 5CH, Colocynthis 6CH | packaging photo provided by the owner, 2026-10-23 (Herbarium): **homeopathic**, 0,25 mL/mL of each; category `homeopathic`; the ANVISA file has an active notified COLICALIV (dinamizado) without ingredient |
| `rinosoro-jet-infantil-spray` | Rinosoro Jet Infantil (9 mg/mL = 0,9%; 100 mL) | spray | sodium chloride | packaging photo provided by the owner, 2026-10-23; isotonic |
| `sorine-jet-baby-spray` (+ alias `sorine-infantil-jet-baby-spray`) | Sorine Jet Baby (0,9%; 100 mL) | spray | sodium chloride | packaging photo provided by the owner, 2026-10-23 (Aché); the ANVISA file has an active notified SORINE JET BABY without ingredient |
| `colidis-drops` | Colidis (10 mL, category supplement) | drops | Limosilactobacillus reuteri | packaging photo provided by the owner, 2026-10-23 and manufacturer page `https://www.ache.com.br/produto/suplementos-alimentares/colidis/`: a food supplement (not a registered medicine), L. reuteri DSM 17938, drops. **Not simethicone** (the review request suggested simeticona; the primary source says otherwise) |
| `sorine-saline-spray`, `sorine-saline-drops` | Sorine Solução Nasal Salina | spray, drops | sodium chloride | review request; the saline Sorine products are notified without ingredient in the file, the registered Sorine is naphazoline; inactive "SORINE H" lists sodium chloride; composition otherwise from retail listings (not a primary source) |
| `rinosoro-saline-spray`, `rinosoro-saline-drops` | Rinosoro Solução Nasal Salina | spray, drops | sodium chloride | review request; CMED lists RINOSORO SIC as a nasal spray, its registry rows (sodium chloride) are inactive; concentration varies by product |

Label facts (packaging photos of 2026-10-23) use optional fields: `strength` (the concentration exactly as printed, composition only, never an amount to give), `packageSize`, `category` (`medicine`, `homeopathic` or `supplement`, what the label says) and `aliasOf` (the id of the product this entry is only another name for). `strength` and `packageSize` become the product's `presentation` text (for example `9 mg/mL (0,9%); 100 mL`), shown with the product; no structured per-ingredient strength is stored for imported products (no migration), so strength is information, not part of the equivalence rule. An alias entry is imported as a merged product (`MergedIntoId` = its product): searching its name finds the product as an alias match, it is never listed as a "same active ingredient" alternative, and an existing row with the alias id keeps its id and links (a new medication can no longer pick the merged row; existing ones keep it).

Saline variants say "Solução Nasal Salina" (or are the "Jet Baby" / "Jet Infantil" products) in the name, so they never collide with the official "Sorine (cloridrato de nafazolina)"; the older generic entries do not claim a concentration ("soro fisiológico" means 0.9 %, and some Rinosoro products are 3 %).

**Machine verification (2026-10-23).** `verify-curated` cross-checks every entry against the official files in the importer's cache (name, ingredients, form, route, registration status, internal consistency, the suggestions the app would make) and records the result per entry as `anvisaCheck` (date, status, evidence references), separate from `reviewed`. Result today: Flygas NOT_FOUND, Luftal CANCELLED (ingredient agrees), Colidis NOT_FOUND, Sorine saline spray UNVERIFIABLE, Sorine saline drops AMBIGUOUS, Rinosoro saline spray and drops UNVERIFIABLE; none VERIFIED, none wrong. Details, statuses and the residual human checklist: docs/design/26-curated-verification.md and docs/curated-review-checklist.md. The machine check is not a pharmacist review and changes no label.

How to edit the file: add or change an entry with `id` (lower-case letters, digits, dashes; never reuse or change an id, it is the product's key: a new id creates a new product and retires the old one), `name` (distinct from any official name used with other ingredients), `form` (one of the catalog forms), `ingredients` (pt-BR spellings the curated substance map knows, at least one), `reviewed` (`false` until a pharmacist or pediatrician checked it) and `basis` (the primary source, or the owner's statement). Never add a dose or an indication (a printed concentration goes in `strength`); never guess an ingredient from a name. Run the tests, then the importer (dry run first): the curated products are planned and printed with the official ones, and a name used by an official product is reported and skipped.

## 8. Running the importer

The tool is `code/api/tools/Lotties.CatalogImporter` (in `Lotties.sln`, references Domain and Infrastructure, no new packages). Run it from a machine that can reach the database, never from the API pod (docs/DEPLOY.md "Medicine catalog (ANVISA official list)").

```bash
# Dry run: downloads (or reuses) both files in the cache dir, plans the official and curated products, prints counts,
# samples and spot checks; no database.
dotnet run --project code/api/tools/Lotties.CatalogImporter -- --dry-run \
  --lookup "Luftal,Flygas,Colidis,Simeticona,Sorine,Rinosoro,Novalgina,Tylenol,Alivium,Depura"

# Real run: the same variables as the API (set them in the shell, never on the command line or in a file in the repo).
#   DB_HOST, DB_PORT, DB_NAME, DB_APP_USER, DB_APP_PASSWORD   (the app role can write the catalog tables)
#   or add --use-migrator to use DB_MIGRATOR_USER / DB_MIGRATOR_PASSWORD
dotnet run --project code/api/tools/Lotties.CatalogImporter

# Monthly refresh: download again, then import (idempotent; products that left their source are retired).
dotnet run --project code/api/tools/Lotties.CatalogImporter -- --refresh
```

Options: `--source <url|path>` (registered medicines, default the ANVISA URL), `--forms-source <url|path|none>` (CMED price list; `none` = every product "other"), `--curated <path|none>` (curated list, default `Data/curated-products.json` next to the tool; `none` skips it and does not retire curated products), `--cache-dir <dir>` (default `<temp>/lotties-anvisa-cache`; downloads never go into the repository), `--refresh`, `--dry-run`, `--limit <n>` (first n rows, no retiring), `--lookup <a,b,...>`, `--use-migrator`, `--help`. The tool prints the database host and name, never the user or password. Exit codes: 0 done, 1 failed (nothing written: one transaction), 2 bad arguments.

Refresh cadence: monthly, after ANVISA's monthly update (the registrations file covers up to the last day of the previous month).

After a refresh, also run `dotnet run --project code/api/tools/Lotties.CatalogImporter -- verify-curated --fix-proposals` (reads the cache, no download, no database; writes reports to `<cache-dir>/verify-curated`, never committed). It exits non-zero on a mismatch or an inconsistency in the curated list.

## 9. Verification (2026-10-22, real files, no real database)

Dry run against the downloaded files (`--dry-run`, files kept outside the repository): 228,869 rows; 21,495 without registration, 12,323 of them active (imported by name); 32,800 registrations: 10,326 active (imported), 22,474 without an active row (left out; 707 of them still priced by CMED); 0 with an inherited ingredient, 13 active without any ingredient, 1,953 without CMED presentation (form "other"). **8,880 official products**: drops 393, syrup 173, tablet 2,540, powder 143, spray 94, ointment 390, suppository 5, inhaler 49, other 5,093 (capsules, injectables and notified products dominate "other"). **1,377 products without ingredient** (shown as "Ingredient not listed in the official data"), **127 ambiguous names split into 313 variants**, 202 "other" fallbacks dropped, 187 names with dosage moved to `presentation`. 2,314 substances, 50 of them curated in this data. Plus 7 curated products, no name collision with the official list. Planning takes about 5 s.

Spot checks (variants and ingredients found):

| Query | Found |
|---|---|
| Luftal | curated Luftal drops: simethicone; official "Luftal Gel Caps" (notified): ingredient not listed. The registered Luftal (simethicone) is inactive in the registry |
| Flygas | curated Flygas drops: simethicone (not in the official data) |
| Colidis | curated Colidis drops: Limosilactobacillus reuteri (food supplement, not in the official data) |
| Simeticona | official notified products named "Simeticona", "Simeticona Gotas", "Simeticona Caps Gel"...: ingredient not listed; Simeticona + Metilbrometo de Homatropina drops, Espasmo Flatol, Espasmo Dimetiliv; combinations (Gelmax Dim, Mylanta Plus, Riopan Plus, Simeco Plus); curated Flygas and Luftal |
| Sorine | **ambiguous**: "Sorine (cloridrato de nafazolina)" drops: naphazoline, and "Sorine (princípio ativo não informado)": not listed, both with the warning; "Sorine Jet Baby", "Sorine Ssc": not listed; curated "Sorine Solução Nasal Salina" spray and drops: sodium chloride |
| Rinosoro | official notified Rinosoro, Gotas, Jet, Sic, Sic Adulto, XT, XT Jet: ingredient not listed; curated "Rinosoro Solução Nasal Salina" spray and drops: sodium chloride |
| Novalgina | drops, tablet, suppository, other: metamizole; Novalgina Flash tablet: metamizole + caffeine |
| Tylenol | tablet: paracetamol; Tylenol Sinus tablet: paracetamol + pseudoephedrine (the drops registration is inactive) |
| Alivium | drops, tablet, other (capsules): ibuprofen |
| Depura | nothing (its registrations are inactive; not curated) |

Throwaway PostgreSQL 16 (podman, `br-pg-anvisa`, port 55435, removed afterwards): all migrations applied with `dotnet ef database update`; first import 12.0 s (2,309 substances and 8,887 products added: 8,880 official + 7 curated; 17 s with startup), second import 9.3 s with 8,887 unchanged and nothing added, updated or retired (idempotent). Checks: 313 products with `ambiguous_name`, 1,377 official products without ingredient, no duplicate (normalized name, form, country). The catalog service against that database: "sorine" -> both naphazoline and not-listed variants together, then the curated saline spray and drops; "luftal" -> curated Luftal (sibling Flygas) and Luftal Gel Caps; "colidis" -> Colidis (L. reuteri); searches 50-90 ms after warm-up.

## 10. Caveats

- Not reviewed by a pharmacist; not a substitution table; information only (section 0). The curated list is not reviewed either (section 7).
- The official list misses products parents know when their registry rows are inactive (Luftal, Depura, the Tylenol drops) or when they are notified without ingredient (most saline sprays). The curated list covers a few; the rest show as "Ingredient not listed in the official data" or not at all.
- Ambiguity is decided per name on the ingredient sets as the file spells them: generics spelled several ways (hydrates, salts) become variants unless the curated substance map groups the spellings.
- English names exist only for the curated substances; other substances show their Brazilian name in both languages.
- "Same active ingredient" is exact set equality of substances; salts are grouped only where the curated map says so.

## 11. Open questions for the owner

1. Licence: the registered-medicines dataset page is gone from dados.gov.br; the decree and the sibling datasets (CC BY, public domain) support reuse with attribution. Confirm, or ask ANVISA (Ouvidoria) for the dataset's licence label if a formal statement is wanted.
2. Review of the curated list by a pharmacist or pediatrician (and who may set `reviewed: true`; the UI label would then need a "reviewed" wording). The mechanical part is automated by `verify-curated`; the rest is the checklist in docs/curated-review-checklist.md.
3. Products still priced by CMED but inactive in the registry (707): keep them out, or curate the common ones (as done for Luftal)?
4. Capsules and oral solutions are "other". Add catalog forms (capsule, oral solution) later? That is a UI/UX change (labels, dose units).
5. Strengths are not imported (one product groups several strengths). Parse CMED strengths for single-strength products?
6. Grow the curated substance map (English names, spelling variants) beyond the 51 common pediatric/OTC substances; that also reduces ambiguous generic names.
