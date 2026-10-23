# Curated list: what still needs a pharmacist (checklist)

The script `verify-curated` (docs/design/26-curated-verification.md) already did the mechanical part against ANVISA's open data: names, active ingredients, form and route, registration status, internal consistency, and the "same active ingredient" suggestions. This page is only what a script cannot judge. Bring it, plus the latest `curated-verification.md` (in the importer's cache dir, not in the repo), to a pharmacist or pediatrician. Only a person may set `"reviewed": true` in `code/api/tools/Lotties.CatalogImporter/Data/curated-products.json`.

Scope: composition, suitability and equivalence information shown next to product names. **Doses are out of scope**: the app never suggests one; the only source is the doctor's prescription.

## For every entry (12 entries today, 10 products and 2 aliases)

- [ ] The ingredient is the one the product contains (the script could confirm none against ANVISA data: see the table in the design doc; for the five newest, Fly Gotas, Colicaliv, Rinosoro Jet Infantil, Sorine Jet Baby and Colidis, the owner's packaging photos of 2026-10-23 state the composition, see below).
- [ ] Age suitability: the product is appropriate for the ages a parent would use it for, and any minimum age or "ask a doctor first" for babies is known. The app currently says nothing about age.
- [ ] Warnings parents must know (for example: not a substitute for medical advice, when to see a doctor, products that should not be mixed). Decide whether any warning text belongs in the app, and who owns its wording.
- [ ] The name and brand are not confusable with another product that has other ingredients (Sorine naphazoline vs saline; check the spray and drops names for the others).

## Equivalence for therapeutic purposes (the "same active ingredient" suggestions)

The app treats two products as alternatives when their ingredient sets are equal, ignoring strength, form, excipients and indication. Please judge:

- [ ] Simethicone: Fly Gotas (150 mg/mL on the box) and Luftal drops (75 mg/mL per CMED) are suggested for each other. The concentration is twice as high: is "same ingredient" acceptable here, or must the app say the concentration differs? (The app shows the printed 150 mg/mL on Fly Gotas' line, it cannot compare strengths.)
- [ ] Sodium chloride: saline nasal sprays and drops are suggested together with every other sodium chloride product, including products of another form. Should a nasal saline be suggested next to an irrigation or infusion solution, or next to a hypertonic product? Should the suggestion be limited to the same form or to nasal products?
- [ ] Colidis (L. reuteri DSM 17938, a food supplement) has no official counterpart, so it only has curated suggestions (none today). Is "same ingredient" meaningful for probiotic strains (the entry names the species; the box names the strain)? Colidis and Colicaliv are kept out of the medicine suggestions by construction (a test and a verifier check); confirm that is what you want.
- [ ] Combination products: confirm none of the entries should be matched with combination products (the rule is exact set equality).

## Per-entry facts only a person can establish

- [ ] Flygas / Fly Gotas: Flygas is not a product; the owner's box is Biolab's "Fly Gotas 150" (simethicone 150 mg/mL, orange, 15 mL, "uso adulto e pediátrico"). Composition and concentration now come from the packaging; the official data only has inactive notified Fly Gotas records. Open: is the product still notified/sold under that name, and is "adulto e pediátrico" at this concentration suitable for the babies it will be used for (age suitability is not decided by the app).
- [ ] Luftal: the registration is inactive; is the product still sold, and in which formulation? (CMED still lists presentations.)
- [ ] Colidis: the box says "Suplemento alimentar em suspensão gotas", L. reuteri DSM 17938, 10 mL, "Alívio da cólica em bebês de 0 a 6 meses de idade". Confirmed by the packaging: it is a supplement, 10 mL drops. Open: the age and "alívio da cólica" claims are the manufacturer's, nobody checked them; decide whether the app should show any claim.
- [ ] Sorine and Rinosoro saline (the older generic entries `sorine-saline-*`, `rinosoro-saline-*`): the notified products list no ingredient. Confirm the sodium chloride claim and the concentration (0.9 % vs hypertonic) from the box, because these entries deliberately state no concentration.
- [ ] Rinosoro Jet Infantil: confirmed by the packaging: sodium chloride 9 mg/mL (0,9 %), spray, 100 mL, "uso pediátrico". Open: the official record "Rinosoro Jet" was matched by name only (it may cover other presentations); is the isotonic spray suited for newborns as the box suggests ("bebês e crianças")?
- [ ] Sorine Jet Baby (shop name "Sorine Infantil Jet Baby"): confirmed by the packaging: sodium chloride 0,9 %, spray, 100 mL, no preservatives. Open: the box says "uso pediátrico acima de 0 (zero) dias" (partly legible, read as "acima de 0 dias"): confirm the printed minimum age with the owner or a second photo, then decide what, if anything, the app says about age. The plain "Sorine" is naphazoline (registration 1.0573.0050): the name rule keeps them apart, confirm no one will mix them up.
- [ ] Colicaliv (Herbarium, homeopathic): confirmed by the packaging: Matricaria chamomilla 4CH, Mentha piperita 6CH, Magnesia phosphorica 5CH, Colocynthis 6CH, 0,25 mL/mL of each, oral drops, 30 mL, "uso pediátrico". Open for a pharmacist: the "auxiliar no alívio do desconforto causado por cólicas" claim is the label's and homeopathic (the app never states an effect); whether the potency (CH) belongs in the ingredient name as modelled; whether the app should say "homeopathic" next to it. It is never offered as an alternative to simethicone (or the reverse), by design.

## Questions to ask the pharmacist

1. Is it acceptable to show "contains the same active ingredient" for these pairs, with the line "Ask your doctor or pharmacist before substituting"? Which pairs would you remove?
2. For babies, are there products in this list you would not want to appear in a search at all?
3. For simethicone and saline: what one-line information would you want next to the suggestion (form, concentration, age)? The app can only show facts that come from a source, never advice.
4. Who may mark an entry reviewed, and how should the label read afterwards? (Today the label is "Curated list (not reviewed by a pharmacist)"; a reviewed state needs new wording and the reviewer's name and date recorded in the entry.)
5. Is a yearly re-review enough, or should changes in the official data (a product cancelled or its ingredient changed) trigger one? The script reports such changes at each monthly refresh.

When the review is done: set `reviewed` to `true` only for the entries the reviewer accepted, record who and when in the entry's `basis`, change the UI label for reviewed curated products, and keep the machine `anvisaCheck` separate (it never replaces the review).
