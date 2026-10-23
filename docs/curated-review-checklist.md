# Curated list: what still needs a pharmacist (checklist)

The script `verify-curated` (docs/design/26-curated-verification.md) already did the mechanical part against ANVISA's open data: names, active ingredients, form and route, registration status, internal consistency, and the "same active ingredient" suggestions. This page is only what a script cannot judge. Bring it, plus the latest `curated-verification.md` (in the importer's cache dir, not in the repo), to a pharmacist or pediatrician. Only a person may set `"reviewed": true` in `code/api/tools/Lotties.CatalogImporter/Data/curated-products.json`.

Scope: composition, suitability and equivalence information shown next to product names. **Doses are out of scope**: the app never suggests one; the only source is the doctor's prescription.

## For every entry (7 entries today)

- [ ] The ingredient is the one the product contains (the script could confirm none of the seven against ANVISA data: see the table in the design doc).
- [ ] Age suitability: the product is appropriate for the ages a parent would use it for, and any minimum age or "ask a doctor first" for babies is known. The app currently says nothing about age.
- [ ] Warnings parents must know (for example: not a substitute for medical advice, when to see a doctor, products that should not be mixed). Decide whether any warning text belongs in the app, and who owns its wording.
- [ ] The name and brand are not confusable with another product that has other ingredients (Sorine naphazoline vs saline; check the spray and drops names for the others).

## Equivalence for therapeutic purposes (the "same active ingredient" suggestions)

The app treats two products as alternatives when their ingredient sets are equal, ignoring strength, form, excipients and indication. Please judge:

- [ ] Simethicone: Flygas and Luftal drops are suggested for each other. Do the usual drop concentrations differ in a way that matters for the parent comparing them? (The scripted CMED data shows Luftal drops at 75 mg/mL; Flygas is not in the official data.)
- [ ] Sodium chloride: saline nasal sprays and drops are suggested together with every other sodium chloride product, including products of another form. Should a nasal saline be suggested next to an irrigation or infusion solution, or next to a hypertonic product? Should the suggestion be limited to the same form or to nasal products?
- [ ] Colidis (L. reuteri, a food supplement) has no official counterpart, so it only has curated suggestions. Is "same ingredient" meaningful for probiotic strains (the entry names the species; the product uses a specific strain, DSM 17938 per the manufacturer)?
- [ ] Combination products: confirm none of the entries should be matched with combination products (the rule is exact set equality).

## Per-entry facts only a person can establish

- [ ] Flygas: composition (no official record; the basis is an owner statement). Needs the package leaflet or the manufacturer's page.
- [ ] Luftal: the registration is inactive; is the product still sold, and in which formulation? (CMED still lists presentations.)
- [ ] Colidis: confirm it is a supplement and which presentation (drops only?) is sold.
- [ ] Sorine and Rinosoro saline: the notified products list no ingredient. Confirm the sodium chloride claim from the label, and the concentration (0.9 % vs hypertonic), because the entries deliberately state no concentration.

## Questions to ask the pharmacist

1. Is it acceptable to show "contains the same active ingredient" for these pairs, with the line "Ask your doctor or pharmacist before substituting"? Which pairs would you remove?
2. For babies, are there products in this list you would not want to appear in a search at all?
3. For simethicone and saline: what one-line information would you want next to the suggestion (form, concentration, age)? The app can only show facts that come from a source, never advice.
4. Who may mark an entry reviewed, and how should the label read afterwards? (Today the label is "Curated list (not reviewed by a pharmacist)"; a reviewed state needs new wording and the reviewer's name and date recorded in the entry.)
5. Is a yearly re-review enough, or should changes in the official data (a product cancelled or its ingredient changed) trigger one? The script reports such changes at each monthly refresh.

When the review is done: set `reviewed` to `true` only for the entries the reviewer accepted, record who and when in the entry's `basis`, change the UI label for reviewed curated products, and keep the machine `anvisaCheck` separate (it never replaces the review).
