# Medications: prescriptions, safe intervals, shared catalog (design, 2026-10-21)

Owner request: record what the doctor prescribed (e.g. "2 drops of X every morning", "1 drop per kg of Y when the baby has belly pain", "X and Y no closer than 8 hours apart: given at 10:00, next allowed 18:00"), compute the next allowed time, suggest information from other parents using the same medication, let parents share one catalog entry instead of creating duplicates, and know that different brands can be the same active ingredient (Flygas = Luftal = simethicone).

## 0. Guardrails (apply to every feature below)
- The app is a log and reminder tool, not a medical device and never gives dosing advice. The doctor's prescription, entered by the parent, is the only source for a dose or interval used in calculations. UI copy says so where doses or intervals appear.
- "Same active ingredient" is shown as information only ("Contains the same active ingredient as Luftal: simethicone. Ask your doctor or pharmacist before substituting.") and never auto-substitutes.
- Dose-per-kg is a calculator over the doctor's rule and the baby's latest weight: it shows its inputs (rule, weight, date of the weight, rounding) and always requires the parent to confirm; a stale weight (> 30 days) shows a warning.
- Logging earlier than the allowed time is never blocked: the app asks "Too early: next allowed at 18:00. Log anyway?" and records that it was overridden.
- Community statistics (M3) are opt-in, k-anonymous, aggregated, never per-baby, never phrased as a recommendation, and need an explicit review by the owner before shipping; default OFF.

## 1. Data model
Instance-wide (shared by all families on the same deployment):
- `substances`: id, key (e.g. `simethicone`), names (en, pt-BR), created_at. Seeded with a small curated list; generic names only, no dosing information.
- `products` (the shared catalog: brand/presentation): id, name, normalized_name, form (drops, syrup, tablet, powder, other), country (ISO), status (`seed` | `community` | `verified`), created_by (nullable user id, never shown), merged_into (nullable), created_at; table `product_substances` (product_id, substance_id, strength_amount, strength_unit, per_amount, per_unit) for e.g. 75 mg per 1 mL. Unique (normalized_name, form, country) for non-merged rows.
- Normalisation for dedupe: lowercase, strip diacritics, drop spaces/punctuation, collapse repeated letters ('flygass' ~ 'flygas'), trigram/edit-distance suggestions (reuse the importer's name matching in Domain).
Per baby:
- `medications` (existing baby catalog): add nullable `product_id` and keep baby-specific name/default dosage/isUsual (the baby's own nickname stays valid).
- `prescriptions`: id (client GUID), baby_id, medication_id, status (`active` | `stopped`), kind (`scheduled` | `as_needed`), dose_amount, dose_unit, dose_per_kg (bool; when true dose_amount is per kg), rounding (`none` | `0.5` | `1` | `0.1`...), schedule for scheduled: `times_of_day` (list of HH:MM) or `every_minutes`; for as_needed: `min_interval_minutes`, `max_doses_per_24h` (nullable), `indication` (free text, e.g. "belly pain"); `interval_group` (nullable string: all prescriptions with the same group share the interval clock: a dose of any member starts the interval for all, e.g. "colic"); `start_date`, `end_date` (nullable), `prescriber` (text), `instructions` (text), created_by, created_at, updated_at, deleted_at (soft delete for sync).
- Dose events stay generic `medication` events: payload `medications: [{ medicationId, name, dose?: {amount, unit}, prescriptionId?, kgUsed?, override?: true }]`.

## 2. Rules (pure Domain, offline-capable on the web too)
`MedicationStatusCalculator(prescriptions, doseEvents, now, weight)` returns per prescription: `availableNow`, `availableAt`, `nextScheduledAt`, `overdueBy`, `dosesLast24h`, `limitReached`, `courseEnded`, `suggestedDose` (when dose_per_kg and weight known: amount x kg rounded, with the inputs). Interval = min over prescription interval and group interval from the latest dose of any member; scheduled prescriptions: next time-of-day not yet logged today (a logged dose within +-90 minutes of a scheduled time counts as that slot). Property tests on timezone handling (local times of day) and midnight.

## 3. Features and flows
1. Prescription editor (Settings > Medications, and from the Meds tray): pick/create the medication (shared catalog search first), dose (+ per kg toggle), kind scheduled/as needed, interval, max per day, indication, dates, prescriber, notes; plain-language summary preview ("Give 1 drop per kg, no more often than every 8 hours, when she has belly pain").
2. Now screen: a "Meds" card/tile showing for each active prescription its state (e.g. "Available at 18:00", "Due now", "2 of 3 doses today"), the Meds tray lists them with availability, logs with the prescribed dose prefilled and the suggested per-kg dose, asks confirmation when early (override recorded). Day rows show the dose and prescription name.
3. Shared catalog search when adding a medication: type a name, matches from the shared catalog appear (fuzzy, substance names and aliases included); choosing one links the baby's medication to the product (no duplicate rows); "Not listed? Add it" creates a `community` product after the dedupe check; the same-active-ingredient note shows the sibling products.
4. Napper import: map medicine comment tokens to shared products/substances (reuses the importer's token matching; suggestions prefer catalog matches).
5. Reminders are out of scope for M1 (no push); the Now card and Day are the surface.

## 4. Community suggestions (M3, design only now)
Aggregates per product and age band computed server-side from babies who opted in: number of babies (show only when >= 20 and from >= 5 families), IQR of logged dose, IQR of intervals, common indications; displayed as "Parents using this report ..." with the disclaimer and a "Not medical advice" label, never prefilling a dose. Contribution toggle per user/baby (default OFF). Cross-instance sharing needs a separate community catalog service with moderation: out of scope until the owner decides.

## 5. Data sources and licensing for seeds
Do not invent medical facts. Seed substances (generic names, en and pt-BR) and brand to substance mappings only when verifiable from an authoritative public source (ANVISA bulario/consulta de medicamentos, CMED list, national formularies) and cite the source URL in the seed file; skip anything unverifiable (the owner's examples: Flygas and Luftal are simethicone products; Colicaliv, Puravit, Colidis: verify before seeding). Avoid WHO ATC (licence). No dosing data in seeds.

## 6. Waves
M1 (API): entities + migrations + endpoints + status calculator + tests; seed substances/products with citations. M2 (web): prescription editor, shared search/dedupe, Now/Meds tray/Day integration, offline status calculation mirroring the API, i18n. M3: Napper import mapping to catalog; community aggregates (needs owner review); medication-related prediction (PRN timing vs belly pain episodes) as an ML benchmark target.
