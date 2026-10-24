# Published age norms as prediction priors (data and sources, 2026-10-23)

This note documents `code/api/data/age-norms.json`: published norms by age for sleep, feeding, diapers, crying and meals, collected to replace guessed age defaults with cited numbers. They are meant as **priors** for a baby's first weeks of tracking and as a **fallback** while a baby has too few logged events. The research (sections 1 to 14) changed no code; section 7 lists the material differences from today's defaults that drove the wiring. The wiring task (section 15) embeds the file in the API, validates it at startup, serves it to the web and replaces a few guessed defaults with norms, conservatively: only norms that are not low confidence and not `needsReview`, each change listed with its old value, new value and source in section 15.2. The file is validated by `AgeNormsValidator` (section 11).

## 0. Guardrails: priors, not advice

- The norms only seed or bound predictions (a cold-start chip, an expected next feed, a nap window) until the baby's own log has enough data. Once the log has enough samples (today 3 to 8 events per kind, docs/design/11-patterns.md and `PredictionOptions`), the log wins.
- The app never tells a family that a baby sleeps, eats, cries or poops too much or too little, never calls a value normal or abnormal, never shows a norm as a target and never colours a chart by a norm (docs/design/04-insights-delight.md section 0 "Lia against Lia" and the never-say list of section 7). Whether any norm is ever shown as context (always with its source and "not medical advice") is an owner and UX decision, not this file's.
- Ranges are wide on purpose: the wider of the published ranges is the prior. A baby outside it is not a finding; it only means the prior gives way to the log sooner.
- The diaper minimums of the first 4 weeks come from breastfeeding-support checklists that tell parents when to call the midwife. The app must not turn them into alerts; any wording based on them needs its own reviewed feature (owner decision).
- No child data was used. Every number comes from a published study or guidance document named in `sources[]`.

## 1. Inventory: age-dependent defaults in the code today

Almost every prediction is learned from the baby's own log; age enters in a few places only.

| # | Where | What | Current value | Published counterpart |
|---|---|---|---|---|
| I1 | `code/web/src/events/bottleAgeDefaults.ts:15-23` `BOTTLE_AGE_RANGES` | cold-start bottle chips by whole months (docs/design/10-bottle-suggestions.md) | 0 m 30-90 ml; 1 m 90-120; 2 m 120-150; 3 m 120-180; 4 m 160-200; 5-6 m 180-240; 7 m+ 180-240 (per feed) | `feed_volume_ml_per_feed` formula, section 7.1 |
| I2 | `code/web/src/events/bottleAgeDefaults.ts:26` `NEUTRAL_BOTTLE_AMOUNTS` | chips without a birth date | 60, 90, 120, 150, 180 ml | none (no age) |
| I3 | `code/api/src/Lotties.Domain/Predictions/AgeBand.cs:28-34` `AgeBands.At` (used by `SampleSelector.cs:13,25` once a band has `MinimumBucketSamples` = 5, `PredictionOptions.cs:20`) | splits the baby's own samples by age | bands 0-3, 3-6, 6-12, 12+ completed months; boundaries only, no values | published age groups differ (section 4.1); nothing to replace |
| I4 | `ml/benchmark/priors.py:18-23` `PRIORS` (benchmark only, not shipped) | weak population priors per band (<3 m, 3-6, 6-12, 12+): median minutes and log-SD | feed gap 150/180/210/240 min; diaper gap 180/210/240/270; awake 75/105/165/240; nap 60/60/75/105; night 600/660/690/690 min (10/11/11.5/11.5 h); bedtime 540/480/465/465 min after noon (21:00/20:00/19:45/19:45) | section 7.2 |
| I5 | `docs/design/04-insights-delight.md:22-25` | quoted context by age | 8-12 feeds a day (0-3 m); "AASM: 12-16 h per 24 h" in the 3-6 m row; awake times 1h15-2h30 at 3-6 m "on thin evidence"; AASM 11-14 h (12 m+); solids from 6 months | section 7.3 |
| I6 | `code/api/src/Lotties.Domain/Predictions/PredictionOptions.cs:41,44` `NightStartsAt`, `NightEndsAt` | day/night split of feed and sleep samples | 19:00 to 07:00, all ages | bed and wake times, section 7.4 |
| I7 | `code/api/src/Lotties.Domain/Predictions/WakeWindowOptions.cs:15,18` `DayStartsAt`, `DayEndsAt` | daytime awake stretches for the overtired heads-up | 05:00 to 18:00, all ages | bed and wake times, section 7.4 |
| I8 | `code/api/src/Lotties.Domain/Predictions/PredictionOptions.cs:72` `EveningDayStartsAt` | a bed time before this belongs to the previous evening | 04:00 | Brazilian 97.5th percentile bedtime 01:00: fits |
| I9 | `code/api/src/Lotties.Domain/Predictions/PredictionOptions.cs:60` `MaxNightSessionLength`; `code/web/src/now/nowState.ts:106` `LONE_MARKER_MAX_AGE_MS` | longest night from `bed_time` to `woke_up`; age of a lone marker | 16 h | longest published night: 98th percentile 13.6 h (Swiss), 97.5th 12.78 h (Brazil): fits |
| I10 | `code/web/src/insights/feedingModel.ts:14` `MAX_FEED_GAP_MS`; `code/api/src/Lotties.Domain/Clinical/FeedingSummary.cs:56` `MaxFeedGap` | a longer gap is treated as an unlogged feed | 8 h, all ages | longest sleep period, section 7.5 |
| I11 | `code/api/src/Lotties.Domain/Predictions/DiaperPredictionOptions.cs:82,85` `SharpDropRatio`, `MinimumUsualForDrop` | gentle "wet diapers dropped" line | today at most half of a usual count of at least 4 | wet diaper minimums, section 7.6 |
| I12 | `DiaperPredictionOptions.cs:21,27` `MinimumWetEvents`, `MinimumDirtyEvents`; `WakeWindowOptions.cs:21,24` `Percentile`, `MinimumStretches`; `PredictionOptions.cs:17` `MinimumSamples` | gates before any estimate (nothing is guessed below them) | 8 wet in 7 days; 5 dirty in 14 days; 75th percentile of at least 5 stretches; 3 samples | the gates are where priors would apply (wiring task) |
| I13 | `Domain/Patterns/FussyPatterns` (docs/design/11 section 7) | evening fussiness pattern from the log | learned only, no age curve | `crying_minutes_per_24h` |
| I14 | `code/web/src/measurements/GrowthChart.tsx` | growth chart | the baby's own points only; no percentile curves (docs/design/04 section 5 plans WHO curves) | out of scope, section 14 |

## 2. Sources (all accessed 2026-10-23)

| Id | Source | Kind, population | Used for | Licence |
|---|---|---|---|---|
| `nsf-2015` | Hirshkowitz M et al. National Sleep Foundation's sleep time duration recommendations. Sleep Health 2015;1(1):40-43. doi:10.1016/j.sleh.2014.12.010 | expert consensus (RAND/UCLA), healthy children | total sleep: recommended and "may be appropriate" ranges, 0-3 m, 4-11 m, 1-2 y | publisher copyright |
| `aasm-2016` | Paruthi S et al. Recommended amount of sleep for pediatric populations: AASM consensus. J Clin Sleep Med 2016;12(6):785-786. doi:10.5664/jcsm.5866 | expert consensus | total sleep 4-12 m, 1-2 y; none under 4 months | © AASM |
| `sbp-sono-2025` | SBP, Departamento Científico de Sono (Lumertz M). Privação de sono na população pediátrica (Pediatria para Famílias, Sept 2025) | Brazilian society guidance (repeats AASM) | total sleep 4-12 m, 1-2 y | © SBP, all rights reserved |
| `galland-2012` | Galland BC et al. Normal sleep patterns in infants and children: a systematic review. Sleep Med Rev 2012;16(3):213-222. doi:10.1016/j.smrv.2011.06.001 | systematic review and meta-analysis, 34 studies, 18 countries, parent report | total sleep (Table 2); night wakings, longest sleep, naps (Table 3) | © Elsevier |
| `iglowstein-2003` | Iglowstein I et al. Sleep duration from infancy to adolescence: reference values and generational trends. Pediatrics 2003;111(2):302-307. doi:10.1542/peds.111.2.302 | cohort, Zurich, n about 490, born 1974-1993, time in bed | total, night and day sleep percentiles (Table 1); bed and wake times (Table 2) | © AAP |
| `pelotas-2017` | Netsi E et al. A different rhythm of life: sleep patterns in the first 4 years of life in a large Brazilian birth cohort. Sleep Med 2017;37:77-87. doi:10.1016/j.sleep.2017.06.001 | cohort, Pelotas (Brazil) 2004, n up to 3,810, maternal report at 3, 12, 24 months | total, night, day sleep, night wakings, bed and wake times (Table 1) | **CC BY 4.0** |
| `sbp-alimentacao-2024` | SBP. Manual de Alimentação, 5ª ed. rev. ampl., 2024. ISBN 978-85-88520-54-7 | Brazilian society guidance | formula volume per feed and feeds per day, first year (chapter 1, Tabela 5) | © SBP, all rights reserved |
| `ms-guia-2019` | Ministério da Saúde. Guia alimentar para crianças brasileiras menores de 2 anos, 2019 | Brazilian government guidance | meals and snacks by age (breastfed child, pp. 117-127); milk feeds of the child on formula or cow's milk (pp. 148-151) | not verified (section 3, L2) |
| `aap-formula-2022` | AAP, HealthyChildren.org. Amount and Schedule of Baby Formula Feedings (last updated 2022-05-16) | US society guidance | formula per feed by age, feeds at 6 m, intervals, 960 ml/day maximum, 75 ml per pound | © AAP |
| `aap-feeding-2024` | AAP, HealthyChildren.org. How Often and How Much Should Your Baby Eat? (last updated 2024-04-02) | US society guidance | newborn feed counts and intervals | © AAP |
| `kent-2006` | Kent JC et al. Volume and frequency of breastfeedings and fat content of breast milk throughout the day. Pediatrics 2006;117(3):e387-e395. doi:10.1542/peds.2005-1417 | cohort, 71 exclusively breastfed infants 1-6 m (Australia), test weighing | breastfeeds per 24 h and grams per breastfeed (abstract) | © AAP |
| `abm-protocol-3-2017` | Kellams A et al.; ABM. Clinical Protocol #3: Supplementary Feedings in the Healthy Term Breastfed Neonate, Revised 2017. Breastfeed Med 2017;12:188-198. doi:10.1089/bfm.2017.29038.ajk | professional protocol | colostrum intake per feed, first 4 days (Table 2) | © ABM / publisher |
| `milq-2025` | Moore SE et al.; MILQ Consortium. Breast Milk Intake from 1 to 8.5 Months of Lactation in the MILQ Study. Adv Nutr 2025;16(Suppl 1):100456. doi:10.1016/j.advnut.2025.100456 | multi-site cohort (Bangladesh, Brazil, Denmark, The Gambia), n = 558 | breast milk g/day by visit, Brazil site and pooled | **CC BY 4.0** |
| `unicef-uk-nappies` | Cambridge University Hospitals NHS FT. Signs your baby is getting enough milk (nappy guide adapted from the UNICEF UK breastfeeding checklist) | UK public-health guidance, breastfed | minimum wet and dirty diapers days 1-28; at least 8 feeds a day | © CUH / UNICEF UK |
| `helmi-2024` | Solasaari T et al. Bowel function in a prospective cohort of 1052 healthy term infants up to 4 months of age. Eur J Pediatr 2024;183(8):3557-3565. doi:10.1007/s00431-024-05625-0 | cohort, Finland, weekly parent reports | stools per day at 3 and 17 weeks (text values only) | **CC BY 4.0** |
| `denhertog-2012` | den Hertog J et al. The defecation pattern of healthy term infants up to the age of 3 months. Arch Dis Child Fetal Neonatal Ed 2012;97(6):F465-F470. doi:10.1136/archdischild-2011-300539 | cohort, 600 Dutch infants | breastfed stools per day at 1 and 3 months (abstract) | © BMJ |
| `wolke-2017` | Wolke D, Bilgin A, Samara M. Fussing and crying durations and prevalence of colic in infants: meta-analysis. J Pediatr 2017;185:55-61.e4. doi:10.1016/j.jpeds.2017.02.020 | meta-analysis, 28 diary studies, 8690 infants | fuss/cry minutes per 24 h at 1-2, 3-4, 5-6, 10-12 weeks (results text of the accepted manuscript) | © Elsevier |
| `who-cf-2011` | WHO. Child health and development, questions and answers (complementary feeding), 2011-07-01 | international guidance | meals and snacks per day, 6-23 months | WHO website terms |

Read but not recorded as norms: the PURPLE crying program (National Center on Shaken Baby Syndrome: crying rises to a peak in the second month, can last 5 hours a day or more, clusters in the late afternoon and evening; qualitative, section 8 D11); Kent JC, Gardner H, Geddes DT. Breastmilk production in the first 4 weeks after birth of term infants. Nutrients 2016;8:756 (CC BY; 699 ± 168 mL/day for 13 mothers without problems, 440 mL/day as the lower limit of established lactation; sample too small); the SBP "Higiene do Sono" scientific document nº 5 (2021-11-05; its PDF text was not machine-readable, the 2025 family page repeats the same AASM table); the SBP Manual de Alimentação note that a breastfed baby may stool at every feed or go days without stooling (qualitative).

## 3. Licence and terms of reuse

Approach as in docs/design/17-vaccine-schedule-data.md section 2: only facts and ranges are reused (numbers, ages, units), restructured into our own schema and words, with attribution (`sources[].citation`, `url`, `doi`) and no endorsement implied. No sentence, table layout, chart or figure is copied, and no table is reproduced in bulk; each value carries its table or page reference so a reviewer can check it.

- **Open licence (CC BY 4.0):** `pelotas-2017`, `milq-2025`, `helmi-2024`. Reuse with attribution; no restriction.
- **Publisher copyright, facts only with attribution:** `nsf-2015`, `aasm-2016`, `galland-2012`, `iglowstein-2003`, `kent-2006`, `denhertog-2012`, `wolke-2017`, `abm-protocol-3-2017`, `aap-formula-2022`, `aap-feeding-2024`, `unicef-uk-nappies`, `who-cf-2011`.

Flags for the owner:
- **L1 SBP** (`sbp-sono-2025`, `sbp-alimentacao-2024`): "Todos os direitos reservados", no reuse licence. Same open decision as the vaccine data (docs/design/17 R-DOC-1): rely on facts-only reuse with attribution, or ask SBP.
- **L2 Ministry of Health guide** (`ms-guia-2019`): the licence line of the copyright page could not be read from the PDF text. Ministry publications often carry a Creative Commons licence; if it is a non-commercial or share-alike one, it governs the document, and Lotties reuses facts only (meal counts). Owner to confirm, as with CC BY-ND for gov.br.
- **L3 NSF "may be appropriate" ranges** were read from a reprint of the NSF chart (the journal table answered HTTP 403); the recommended ranges were confirmed on thensf.org. Re-check against the article when it is reachable.
- **L4 UNICEF UK**: the nappy chart is UNICEF UK Baby Friendly material reproduced by NHS trusts; only minimum counts are used, no chart, logo or wording.
- **L5 WHO**: website terms; the 2023 WHO complementary feeding guideline (usually CC BY-NC-SA 3.0 IGO for WHO publications) was not read and would be the better citation.

## 4. Method and conventions

### 4.1 Ages and bands
- Age is completed days since birth (birth day = day 0). A band is `[fromDays, toDays)`. Months convert as in docs/design/17 section 3 rule 2 (30.4375 days a month, halves rounded up): 1 m = 30, 2 m = 61, 3 m = 91, 3.5 m = 107, 4 m = 122, 6 m = 183, 7 m = 213, 8 m = 244, 8.5 m = 259, 9 m = 274, 12 m = 365, 18 m = 548, 24 m = 731, 36 m = 1096. `fromWeeks`/`toWeeks` are days / 7 (two decimals), kept for readability. "Day N of life" is age N-1 days, so "days 1-2" is `[0, 2)`.
- Bands follow the sources' own age groups where possible, so the grid differs per metric. A point measurement ("at 3 months", "at 17 weeks") goes into the band that contains that age. Bands of one metric and population never overlap; gaps are deliberate (no source, no norm).

### 4.2 Populations
`all`, `breastfed`, `formula` (not breastfed: infant formula, or whole cow's milk from 9 months in the Ministry of Health guide). The wiring task picks `breastfed` or `formula` from the baby's logged feeds and falls back to `all`.

### 4.3 Evidence
Every norm keeps its evidence: one item per source value with `location` (table or page), `sourceAge` (the source's own age label), `low`/`typical`/`high` as published, `rangeKind`, `typicalKind`, `sd`, `note`.
- `rangeKind`: `recommended` (guideline range), `may_be_appropriate` (NSF outer band), `mean_pm_1.96sd` (published by Galland), `p2_p98`, `p2.5_p97.5`, `iqr`, `min_max`, `minimum` (a "6 or more" count, low only), `maximum` (high only), `reported_range` (ABM), `statement` (a range in prose).
- `typicalKind`: `mean`, `pooled_mean`, `median`, `recommended` (a single scheduled number), `statement`.
- Where a source gives a mean and SD but no range, low/high stay null and the SD is recorded. We never compute mean ± 1.96 SD ourselves; Galland 2012 did and published it, so its ranges are used as printed.

### 4.4 Merge rule (enforced by the test)
- `low` = the smallest evidence low or evidence typical; `high` = the largest evidence high or evidence typical. The wider range wins and always contains every published central value. `low` is null when no evidence gives a low, `high` when none gives a high.
- `typical` = the typical of the evidence item from `typicalSourceId`, chosen in this order: (1) Brazilian data (Pelotas, MILQ Brazil site) or Brazilian official guidance with a single value (Ministry of Health); (2) systematic review or meta-analysis (Galland, Wolke); (3) other studies (Iglowstein, Kent, den Hertog, HELMi); (4) guidance statements with a single value (AAP). Null when no source gives a central value (only ranges); the wiring task then uses the range or the log.

### 4.5 Confidence
- **high**: two or more independent sources agree (each central value inside the other's range) and at least one is a systematic review, a cohort of 500 or more or an official guideline; or one large multi-site or meta-analytic source whose population includes the app's users.
- **medium**: one good source (guideline, meta-analysis, cohort of 500 or more, professional protocol), or several that agree only partly.
- **low**: a unit conversion of a single statement, a subgroup under 100 infants, or a non-Brazilian population for a culture-dependent measure (bed and wake times, night length) when no Brazilian data covers the band.

### 4.6 needsReview
True (with `needsReviewReason`) when confidence is low, when sources disagree materially (a central value outside another source's range, ranges that do not overlap, or different definitions), when a unit was converted, or when a source is inconsistent with itself. Section 10 lists them.

### 4.7 Units and conversions
Units: `hours`, `minutes`, `count`, `ml`, `g`, `ml_per_kg`, `minutes_after_noon` (bedtime: 20:00 = 480, 01:00 = 780), `minutes_after_midnight` (wake time: 07:30 = 450). Breast milk measured by weight stays in grams. Ounces were used only where the source printed millilitres. One conversion: the AAP's "75 ml per pound" became 165 ml/kg (75 / 0.45359), flagged.

## 5. The file

`code/api/data/age-norms.json`, schema 1, UTF-8, 2-space indent, LF, trailing newline (canonical `json.dumps(indent=2, ensure_ascii=False)` output).

- Top level: `schemaVersion` (1), `generatedAt`, `purpose`, `ageConvention`, `mergeRule`, `units`, `populations`, `rangeKinds`, `typicalKinds`, `metrics[]`, `sources[]`, `norms[]`.
- `metrics[]`: `key` (stable snake_case id), `unit`, `description`, `missingReason` (set when no norm could be sourced; such a metric has no norms).
- `sources[]`: `id`, `kind`, `country`, `citation`, `doi`, `url`, `accessedOn`, `licence`, `licenceNote`.
- `norms[]`: `id` (`metric.population.fromDays-toDays`), `metric`, `population`, `populationNote`, `ageBand` {`fromDays`, `toDays`, `fromWeeks`, `toWeeks`, `label`}, `low`, `typical`, `high`, `unit`, `typicalSourceId`, `sourceIds`, `confidence` (high|medium|low), `needsReview`, `needsReviewReason`, `notes`, `evidence[]` (section 4.3).

Counts: 18 sources, 22 metrics (20 with norms, 2 missing), 91 norms (27 high, 57 medium, 7 low confidence), 17 with `needsReview`.

Embedded in `Lotties.Application` (logical name `Lotties.Application.AgeNorms.age-norms.json`), like `vaccine-schedule.br.json` (docs/design/18 section 1); `Lotties.Domain.Tests` also links it into its output. The web has no copy in its bundle: it downloads the file from `GET /api/v1/age-norms` and keeps it in Dexie (section 15.1).

## 6. The norms

R = `needsReview`. Values are the merged prior; each source's own value is in the file's `evidence`.

**`total_sleep_hours_24h`** (hours)

| Population | Age (days) | Band | Low | Typical | High | Sources (typical from) | Conf. | R |
|---|---|---|---|---|---|---|---|---|
| all | 0-91 | 0 to under 3 months | 9.3 | 14.6 | 20 | galland-2012, nsf-2015 (galland-2012) | high |  |
| all | 91-122 | 3 to under 4 months | 8.35 | 13 | 19.5 | galland-2012, pelotas-2017, nsf-2015 (pelotas-2017) | high |  |
| all | 122-244 | 4 to under 8 months | 8.8 | 12.9 | 18.1 | galland-2012, iglowstein-2003, nsf-2015, aasm-2016, sbp-sono-2025 (galland-2012) | high |  |
| all | 244-365 | 8 to under 12 months | 9.4 | 12.6 | 18 | galland-2012, iglowstein-2003, nsf-2015, aasm-2016, sbp-sono-2025 (galland-2012) | high |  |
| all | 365-548 | 12 to under 18 months | 8.97 | 12.25 | 16.5 | galland-2012, iglowstein-2003, pelotas-2017, nsf-2015, aasm-2016, sbp-sono-2025 (pelotas-2017) | high |  |
| all | 548-731 | 18 to under 24 months | 9 | 12.6 | 16 | galland-2012, iglowstein-2003, nsf-2015, aasm-2016, sbp-sono-2025 (galland-2012) | high |  |
| all | 731-1096 | 24 to under 36 months | 9 | 12 | 16 | galland-2012, iglowstein-2003, pelotas-2017, nsf-2015, aasm-2016, sbp-sono-2025 (pelotas-2017) | high |  |

**`night_sleep_hours`** (hours)

| Population | Age (days) | Band | Low | Typical | High | Sources (typical from) | Conf. | R |
|---|---|---|---|---|---|---|---|---|
| all | 91-122 | 3 to under 4 months | 6 | 9.5 | 12.78 | pelotas-2017, iglowstein-2003 (pelotas-2017) | medium |  |
| all | 122-244 | 4 to under 8 months | 8.8 | 11 | 13.2 | iglowstein-2003 (iglowstein-2003) | low | R |
| all | 244-365 | 8 to under 12 months | 9.2 | 11.2 | 13.3 | iglowstein-2003 (iglowstein-2003) | low | R |
| all | 365-548 | 12 to under 18 months | 7.48 | 10 | 13.6 | pelotas-2017, iglowstein-2003 (pelotas-2017) | medium |  |
| all | 548-731 | 18 to under 24 months | 9.7 | 11.6 | 13.5 | iglowstein-2003 (iglowstein-2003) | low | R |
| all | 731-1096 | 24 to under 36 months | 8 | 10.5 | 13.4 | pelotas-2017, iglowstein-2003 (pelotas-2017) | medium |  |

**`day_sleep_hours_24h`** (hours)

| Population | Age (days) | Band | Low | Typical | High | Sources (typical from) | Conf. | R |
|---|---|---|---|---|---|---|---|---|
| all | 91-122 | 3 to under 4 months | 0.5 | 3 | 9 | pelotas-2017 (pelotas-2017) | medium |  |
| all | 122-244 | 4 to under 8 months | 0.4 | 3.4 | 6.4 | iglowstein-2003 (iglowstein-2003) | medium |  |
| all | 244-365 | 8 to under 12 months | 0.2 | 2.8 | 5.3 | iglowstein-2003 (iglowstein-2003) | medium |  |
| all | 365-548 | 12 to under 18 months | 0.2 | 2 | 6 | pelotas-2017, iglowstein-2003 (pelotas-2017) | high |  |
| all | 548-731 | 18 to under 24 months | 0.5 | 2 | 3.6 | iglowstein-2003 (iglowstein-2003) | medium |  |
| all | 731-1096 | 24 to under 36 months | 0 | 1.5 | 3 | pelotas-2017, iglowstein-2003 (pelotas-2017) | high |  |

**`naps_per_day`** (count)

| Population | Age (days) | Band | Low | Typical | High | Sources (typical from) | Conf. | R |
|---|---|---|---|---|---|---|---|---|
| all | 0-183 | 0 to under 6 months | 1.2 | 3.1 | 5 | galland-2012 (galland-2012) | medium |  |
| all | 183-365 | 6 to under 12 months | 0.9 | 2.2 | 3.5 | galland-2012 (galland-2012) | medium |  |
| all | 365-731 | 12 to under 24 months | 0.4 | 1.2 | 2.1 | galland-2012 (galland-2012) | medium |  |

**`longest_sleep_hours`** (hours)

| Population | Age (days) | Band | Low | Typical | High | Sources (typical from) | Conf. | R |
|---|---|---|---|---|---|---|---|---|
| all | 0-183 | 0 to under 6 months | 1.8 | 5.7 | 9.6 | galland-2012 (galland-2012) | medium | R |
| all | 183-731 | 6 to under 24 months | 3 | 8.3 | 13.7 | galland-2012 (galland-2012) | medium | R |

**`night_wakings_per_night`** (count)

| Population | Age (days) | Band | Low | Typical | High | Sources (typical from) | Conf. | R |
|---|---|---|---|---|---|---|---|---|
| all | 0-91 | 0 to under 3 months | 0 | 1.7 | 3.4 | galland-2012 (galland-2012) | medium |  |
| all | 91-213 | 3 to under 7 months | 0 | 1 | 4 | galland-2012, pelotas-2017 (pelotas-2017) | high |  |
| all | 213-365 | 7 to under 12 months | 0 | 1.1 | 3.1 | galland-2012 (galland-2012) | medium |  |
| all | 365-731 | 12 to under 24 months | 0 | 1 | 4 | galland-2012, pelotas-2017 (pelotas-2017) | high |  |
| all | 731-1096 | 24 to under 36 months | 0 | 0 | 3 | pelotas-2017 (pelotas-2017) | medium |  |

**`bedtime_minutes_after_noon`** (shown as clock times)

| Population | Age (days) | Band | Low | Typical | High | Sources (typical from) | Conf. | R |
|---|---|---|---|---|---|---|---|---|
| all | 91-122 | 3 to under 4 months | 20:00 | 22:00 | 01:00 | pelotas-2017 (pelotas-2017) | medium |  |
| all | 122-365 | 4 to under 12 months | - | 20:16 | - | iglowstein-2003 (iglowstein-2003) | low | R |
| all | 365-731 | 12 to under 24 months | 19:46 | 22:00 | 01:00 | pelotas-2017, iglowstein-2003 (pelotas-2017) | medium | R |
| all | 731-1096 | 24 to under 36 months | 20:00 | 22:00 | 00:00 | pelotas-2017 (pelotas-2017) | medium |  |

**`wake_time_minutes_after_midnight`** (shown as clock times)

| Population | Age (days) | Band | Low | Typical | High | Sources (typical from) | Conf. | R |
|---|---|---|---|---|---|---|---|---|
| all | 91-122 | 3 to under 4 months | 06:00 | 07:30 | 10:30 | pelotas-2017 (pelotas-2017) | medium |  |
| all | 122-365 | 4 to under 12 months | - | 07:13 | - | iglowstein-2003 (iglowstein-2003) | low | R |
| all | 365-731 | 12 to under 24 months | 06:00 | 08:00 | 11:00 | pelotas-2017, iglowstein-2003 (pelotas-2017) | medium |  |
| all | 731-1096 | 24 to under 36 months | 06:00 | 08:30 | 11:00 | pelotas-2017 (pelotas-2017) | medium |  |

**`feeds_per_24h`** (count)

| Population | Age (days) | Band | Low | Typical | High | Sources (typical from) | Conf. | R |
|---|---|---|---|---|---|---|---|---|
| breastfed | 0-28 | first 4 weeks (days 0 to 27) | 8 | - | 12 | unicef-uk-nappies, aap-feeding-2024 | high |  |
| breastfed | 28-183 | 1 to under 6 months | 6 | 11 | 18 | kent-2006 (kent-2006) | medium |  |
| formula | 0-30 | birth to 30 days | 6 | - | 8 | sbp-alimentacao-2024, aap-feeding-2024 | medium | R |
| formula | 30-61 | 30 days to under 2 months | 6 | - | 8 | sbp-alimentacao-2024 | medium |  |
| formula | 61-91 | 2 to under 3 months | 5 | - | 6 | sbp-alimentacao-2024 | medium |  |
| formula | 91-122 | 3 to under 4 months | 5 | - | 6 | sbp-alimentacao-2024 | medium |  |
| formula | 122-183 | 4 to under 6 months | 2 | - | 3 | sbp-alimentacao-2024 | medium | R |
| formula | 183-213 | 6 to under 7 months | 2 | 4 | 5 | sbp-alimentacao-2024, ms-guia-2019, aap-formula-2022 (ms-guia-2019) | medium | R |
| formula | 213-274 | 7 to under 9 months | 2 | 3 | 3 | sbp-alimentacao-2024, ms-guia-2019 (ms-guia-2019) | medium |  |
| formula | 274-365 | 9 to under 12 months | 2 | 3 | 3 | sbp-alimentacao-2024, ms-guia-2019 (ms-guia-2019) | medium |  |
| formula | 365-731 | 12 to under 24 months | - | 3 | - | ms-guia-2019 (ms-guia-2019) | medium |  |

**`feed_gap_minutes`** (start to start)

| Population | Age (days) | Band | Low | Typical | High | Sources (typical from) | Conf. | R |
|---|---|---|---|---|---|---|---|---|
| breastfed | 0-28 | first 4 weeks (days 0 to 27) | 120 | 120 | 180 | aap-feeding-2024 (aap-feeding-2024) | medium |  |
| formula | 0-28 | first 4 weeks (days 0 to 27) | 120 | - | 240 | aap-feeding-2024, aap-formula-2022 | medium | R |
| formula | 28-61 | 4 weeks to under 2 months | 180 | - | 240 | aap-formula-2022, aap-feeding-2024 | medium |  |

**`feed_volume_ml_per_feed`** (ml)

| Population | Age (days) | Band | Low | Typical | High | Sources (typical from) | Conf. | R |
|---|---|---|---|---|---|---|---|---|
| breastfed | 0-1 | first 24 hours | 2 | - | 10 | abm-protocol-3-2017 | medium |  |
| breastfed | 1-2 | 24 to 48 hours | 5 | - | 15 | abm-protocol-3-2017 | medium |  |
| breastfed | 2-3 | 48 to 72 hours | 15 | - | 30 | abm-protocol-3-2017 | medium |  |
| breastfed | 3-4 | 72 to 96 hours | 30 | - | 60 | abm-protocol-3-2017 | medium |  |
| formula | 0-7 | first week (days 0 to 6) | 30 | - | 120 | sbp-alimentacao-2024, aap-formula-2022 | medium | R |
| formula | 7-30 | days 7 to 29 | 60 | - | 120 | sbp-alimentacao-2024, aap-formula-2022 | high |  |
| formula | 30-61 | 30 days to under 2 months | 90 | - | 150 | sbp-alimentacao-2024, aap-formula-2022 | medium |  |
| formula | 61-91 | 2 to under 3 months | 150 | - | 180 | sbp-alimentacao-2024 | medium |  |
| formula | 91-122 | 3 to under 4 months | 180 | - | 200 | sbp-alimentacao-2024 | medium |  |
| formula | 122-183 | 4 to under 6 months | 180 | - | 200 | sbp-alimentacao-2024 | medium |  |
| formula | 183-365 | 6 to under 12 months | 180 | - | 240 | sbp-alimentacao-2024, aap-formula-2022 | high |  |

**`breast_milk_g_per_feed`** (g)

| Population | Age (days) | Band | Low | Typical | High | Sources (typical from) | Conf. | R |
|---|---|---|---|---|---|---|---|---|
| breastfed | 28-183 | 1 to under 6 months | 0 | 76 | 240 | kent-2006 (kent-2006) | medium |  |

**`breast_milk_g_per_24h`** (g; SD 155-203 in the evidence)

| Population | Age (days) | Band | Low | Typical | High | Sources (typical from) | Conf. | R |
|---|---|---|---|---|---|---|---|---|
| breastfed | 30-107 | 1 to under 3.5 months | - | 843 | - | milq-2025 (milq-2025) | high |  |
| breastfed | 107-183 | 3.5 to under 6 months | - | 856 | - | milq-2025 (milq-2025) | high |  |
| breastfed | 183-259 | 6 to under 8.5 months | - | 740 | - | milq-2025 (milq-2025) | high |  |

**`milk_ml_per_24h`** (ml)

| Population | Age (days) | Band | Low | Typical | High | Sources (typical from) | Conf. | R |
|---|---|---|---|---|---|---|---|---|
| formula | 0-365 | birth to under 12 months | - | - | 960 | aap-formula-2022 | medium |  |

**`milk_ml_per_kg_per_24h`** (ml per kg)

| Population | Age (days) | Band | Low | Typical | High | Sources (typical from) | Conf. | R |
|---|---|---|---|---|---|---|---|---|
| formula | 0-183 | birth to under 6 months | - | 165 | - | aap-formula-2022 (aap-formula-2022) | low | R |

**`wet_diapers_per_24h`** (count; minimums)

| Population | Age (days) | Band | Low | Typical | High | Sources (typical from) | Conf. | R |
|---|---|---|---|---|---|---|---|---|
| breastfed | 0-2 | days 1 and 2 of life | 1 | - | - | unicef-uk-nappies | medium |  |
| breastfed | 2-4 | days 3 and 4 of life | 3 | - | - | unicef-uk-nappies | medium |  |
| breastfed | 4-6 | days 5 and 6 of life | 5 | - | - | unicef-uk-nappies | medium |  |
| breastfed | 6-28 | days 7 to 28 of life | 6 | - | - | unicef-uk-nappies | medium |  |

**`dirty_diapers_per_24h`** (count)

| Population | Age (days) | Band | Low | Typical | High | Sources (typical from) | Conf. | R |
|---|---|---|---|---|---|---|---|---|
| breastfed | 0-2 | days 1 and 2 of life | 1 | - | - | unicef-uk-nappies | medium |  |
| breastfed | 2-4 | days 3 and 4 of life | 2 | - | - | unicef-uk-nappies | medium |  |
| breastfed | 4-6 | days 5 and 6 of life | 2 | - | - | unicef-uk-nappies | medium |  |
| breastfed | 6-28 | days 7 to 28 of life | 2 | - | - | unicef-uk-nappies | medium |  |
| breastfed | 28-56 | 4 to under 8 weeks | - | 3.65 | - | denhertog-2012 (denhertog-2012) | medium |  |
| breastfed | 84-112 | 12 to under 16 weeks | - | 1.88 | - | denhertog-2012 (denhertog-2012) | medium |  |
| breastfed | 112-140 | 16 to under 20 weeks | 0.9 | 2 | 3.6 | helmi-2024 (helmi-2024) | high |  |
| formula | 112-140 | 16 to under 20 weeks | 0.6 | 1.1 | 1.4 | helmi-2024 (helmi-2024) | low | R |
| all | 14-28 | 2 to under 4 weeks | 2.9 | 4 | 5 | helmi-2024 (helmi-2024) | high |  |
| all | 112-140 | 16 to under 20 weeks | 0.7 | 2 | 3.3 | helmi-2024 (helmi-2024) | high |  |

**`crying_minutes_per_24h`** (minutes of fussing and crying; SD 46-70 in the evidence)

| Population | Age (days) | Band | Low | Typical | High | Sources (typical from) | Conf. | R |
|---|---|---|---|---|---|---|---|---|
| all | 7-21 | 1 to 2 weeks | - | 117.3 | - | wolke-2017 (wolke-2017) | high |  |
| all | 21-35 | 3 to 4 weeks | - | 118.2 | - | wolke-2017 (wolke-2017) | high |  |
| all | 35-49 | 5 to 6 weeks | - | 133.3 | - | wolke-2017 (wolke-2017) | high |  |
| all | 70-91 | 10 to 12 weeks | - | 68 | - | wolke-2017 (wolke-2017) | high |  |

**`solid_meals_per_day`** (count)

| Population | Age (days) | Band | Low | Typical | High | Sources (typical from) | Conf. | R |
|---|---|---|---|---|---|---|---|---|
| all | 183-213 | 6 to under 7 months | 1 | 1 | 3 | ms-guia-2019, who-cf-2011 (ms-guia-2019) | medium | R |
| all | 213-274 | 7 to under 9 months | 2 | 2 | 3 | ms-guia-2019, who-cf-2011 (ms-guia-2019) | high |  |
| all | 274-365 | 9 to under 12 months | 2 | 2 | 4 | ms-guia-2019, who-cf-2011 (ms-guia-2019) | medium | R |
| all | 365-731 | 12 to under 24 months | 3 | 3 | 4 | ms-guia-2019, who-cf-2011 (ms-guia-2019) | high |  |

**`solid_snacks_per_day`** (count)

| Population | Age (days) | Band | Low | Typical | High | Sources (typical from) | Conf. | R |
|---|---|---|---|---|---|---|---|---|
| all | 183-731 | 6 to under 24 months | 1 | 2 | 2 | ms-guia-2019, who-cf-2011 (ms-guia-2019) | high |  |

## 7. Published norms vs current defaults (input for the wiring task)

### 7.1 Bottle cold-start chips (I1): material
| App row (whole months) | App range (ml) | Published prior (formula, ml per feed) | Difference |
|---|---|---|---|
| 0 | 30-90 | days 0-6: 30-120 (AAP 30-60, SBP 60-120); days 7-29: 60-120 (SBP 60-120, AAP 90-120) | the app's top (90) is below SBP and AAP from the second week |
| 1 | 90-120 | 90-150 (SBP 120-150, AAP 90-120) | no 150 chip |
| 2 | 120-150 | 150-180 (SBP) | the app is about 30 ml lower |
| 3 | 120-180 | 180-200 (SBP) | the app is lower (this row followed the owner's own baby, docs/design/10) |
| 4 | 160-200 | 180-200 (SBP) | close |
| 5-6 | 180-240 | 180-200 (SBP, 4-6 m); 180-240 (6-12 m, SBP and AAP) | fits |
| 7+ | 180-240 | 180-240 | fits |

The published Brazilian table (SBP) is consistently above the app's rows 0-3. The chips are shortcuts, never targets; the owner decides whether to move the cold-start ranges to the published union. Whole calendar months (app) and day bands (norms) differ by a few days at the edges.

### 7.2 Benchmark priors (I4): material for night length and bedtime
- **Night** 10/11/11.5/11.5 h: Brazilian medians are 9.5 h (3 m), 10 h (12 m), 10.5 h (24 m); the Swiss cohort says 11.0-11.7 h. For Brazilian families the prior is 1 to 1.5 h too long from 3 months on.
- **Bedtime** 21:00/20:00/19:45/19:45: the Brazilian median is 22:00 at 3, 12 and 24 months (2.5th-97.5th percentile 20:00 to 01:00); the priors match Swiss 1990s children (19:46-20:16), 2 hours earlier than Brazil.
- **Feed gap** 150/180/210/240 min: published gaps exist only up to 2 months (120-180 min breastfed, 120-240 min formula); 150 min under 3 months is inside them. Later, only feeds per day are published (breastfed 6-18, mean 11, at 1-6 m; formula 5-6 at 2-4 m).
- **Awake** 75/105/165/240 min: no published norm (section 9).
- **Nap** 60/60/75/105 min: no per-nap norm; published daytime sleep per day is 3 h (3 m), 3.4 h (6 m), 2.8 h (9 m), 2 h (12 m) with 3.1, 2.2 and 1.2 naps a day at 0-5 m, 6-11 m and 1-2 y.
- **Diaper gap** 180-270 min: no published gap norm, only counts.

### 7.3 Quoted context in docs/design/04 (I5)
- "8-12 feeds a day is common" (0-3 m): supported for breastfed newborns (UNICEF UK minimum 8, AAP 10-12); 1-6 months 6-18 (mean 11, Kent); formula 6-8 then 5-6 a day (SBP).
- "AASM sets no target under 4 months": correct; the NSF does (14-17 h, 11-19 may be appropriate).
- "AASM: 12-16 h" shown in the 3-6 m row: the AASM band starts at 4 months.
- "Awake times about 1h15-2h30": no published source found.
- "AASM: 11-14 h" (12 m+): correct for 1-2 years.

### 7.4 Night and day clock windows (I6, I7): material for a Brazil-first app
`NightStartsAt` 19:00 / `NightEndsAt` 07:00 and the wake window's 05:00-18:00 day assume a night of about 19:00 to 07:00. Brazilian infants go to bed at a median 22:00 (20:00 to 01:00) and wake at 07:30-08:30 (06:00 to 11:00). For a typical Brazilian baby, evening awake time, the last nap and feeds between 19:00 and 22:00 count as night, sleep after 07:00 counts as day, and the overtired heads-up ignores awake stretches that start after 18:00, which is exactly the evening stretch before a 22:00 bedtime. Options for the wiring task: learn the night window from the baby's own bed and wake times (the bed-time predictor exists), or seed it from these norms. Nothing was changed here.

### 7.5 The 8-hour feed-gap cut-off (I10)
From 6 months the longest sleep period averages 8.3 h (3.0-13.7 h), and the AAP says most formula-fed babies need no night feed between 2 and 4 months. A night of more than 8 hours without a feed is real for many older babies, so the cut-off removes real gaps from the averages after about 6 months. An age-dependent cut-off is a candidate for the insights or wiring task.

### 7.6 Wet-diaper drop line (I11): not a conflict
The rule compares the baby with its own usual count. The published minimums (breastfed, first 4 weeks: at least 1, 3, 5 and 6 wet diapers a day on days 1-2, 3-4, 5-6 and 7-28) are a support checklist; seeding the "usual" count with them would turn a checklist into an alert, which the guardrails exclude without an owner and UX decision.

### 7.7 Not material
Age band boundaries (I3) carry no values; the 16-hour night cap (I9) and the 04:00 evening boundary (I8) fit the published ranges; the learned gates (I12) stay as they are, priors would only apply below them.

## 8. Disagreements between sources

| # | Topic | What the sources say | In the data |
|---|---|---|---|
| D1 | Total sleep under 4 months | NSF 14-17 h (11-19 may be appropriate); AASM and SBP give none (wide normal variation); Galland 9.3-20.0 h (0-2 m); Pelotas 8.35-19.5 h (3 m) | union of the ranges |
| D2 | Night length | Brazil (Pelotas) 9.5 / 10 / 10.5 h at 3 / 12 / 24 m; Switzerland (Iglowstein, time in bed, born 1974-1993) 10.0 / 11.7 / 11.5 h | Brazilian typical; Swiss-only bands flagged |
| D3 | Bed and wake times | Brazil median 22:00 and 07:30-08:30; Swiss means 19:46-20:16 and 07:13-07:19; Netsi 2017: Brazilian rhythms about 2 h later than in high-income countries | Brazilian typical; Swiss-only bands flagged |
| D4 | Total sleep 6-12 months | Iglowstein 13.9-14.2 h (time in bed) vs Galland 12.6-12.9 h (includes Asian studies, about 1 h less sleep) | Galland typical, union range |
| D5 | Longest sleep period | Galland Table 3: 5.7 / 8.3 h; Galland text: 5.8 / 8.4 h | table values, flagged |
| D6 | Formula feeds 0-30 days | SBP 6-8; AAP at least 8 (stated for newborns in general) | 6-8, flagged |
| D7 | Formula volume, first week | SBP 60-120 ml (whole first month); AAP 30-60 ml (first week) | 30-120, flagged |
| D8 | Formula volume 30-60 days | SBP 120-150 ml; AAP at least 90-120 ml by the end of the first month | 90-150 |
| D9 | Milk feeds from 4-6 months | SBP 2-3 after 4 months (complementary food from 4 m for non-breastfed infants); Ministry of Health 4 at 6 m; AAP 4-5 at 6 m | union; 4-6 m and 6 m flagged |
| D10 | Feed gap, first weeks | AAP 2024: newborns every 2-3 h; AAP 2022: formula-fed every 3-4 h | 120-240, flagged |
| D11 | Crying peak | PURPLE: crying increases to a peak in the second month, clusters in the late afternoon and evening; Wolke 2017: no significant peak at 6 weeks (117-133 min a day throughout the first 6 weeks), 68 min at 10-12 weeks; country and feeding type matter | Wolke values; PURPLE only in this doc |
| D12 | Meals 6-11 months | Ministry of Health: 1 main meal at 6 m, 2 from 7 m, plus 2 fruit snacks; WHO: complementary food 2-3 times a day at 6-8 m, 3-4 at 9-11 m, plus 1-2 snacks | union; 6 m and 9-11 m flagged |
| D13 | Breast milk intake | MILQ Brazil site above the pooled mean (843 vs 818 g at 1-3.5 m, 740 vs 691 g at 6-8.5 m); Kent 2016 699 ± 168 mL/day in the first 4 weeks (13 mothers) | MILQ Brazil site |

## 9. Missing norms (they stay missing)

- **`wake_window_minutes`**: no peer-reviewed or official norm was found. The charts in circulation are rules of thumb from blogs and sleep consultants and disagree with each other (for example 1.5-2.5 h vs 2-3 h at 4-6 months). The benchmark's awake priors and docs/design/04's "1h15-2h30" have no published basis. Recommendation: keep wake windows learned only (today: no guess under 5 stretches).
- **`nap_minutes`** (one nap): none; only daytime sleep per day and naps per day are published.
- Night sleep, daytime sleep, bed and wake times under 3 months: no source with values (Pelotas starts at 3 months; Iglowstein's tables start at 6 months).
- Wet diapers after 4 weeks, breastfed stools at 8-12 weeks, formula-fed stools before 16 weeks: only secondary web pages were found.
- Crying in the first week and at 7-10 weeks (Wolke's 8-9 week value is only in a figure); the evening share of crying (qualitative only).
- Feed gaps after 2 months; breastfed volume per feed between day 4 and 1 month (the AAP's "about 1 oz" is in ounces only).
- A lower bound for formula per day; a Brazilian ml/kg/day figure.
- Growth percentiles and premature babies (section 14).

## 10. Needs review

### 10.1 Norms with `needsReview: true` (17)

| Norm | Why |
|---|---|
| `night_sleep_hours.all.122-244` | Only the Swiss cohort (children born 1974-1993, time in bed) covers this band; the Brazilian cohort reports shorter nights where both measured (median 9.5 h at 3 months and 10 h at 12 months, against Swiss means of 10.0 and 11.7 h). |
| `night_sleep_hours.all.244-365` | Same as above. |
| `night_sleep_hours.all.548-731` | Same as above. |
| `longest_sleep_hours.all.0-183` | Galland 2012 prints 5.7 and 8.3 h in Table 3 but 5.8 and 8.4 h in the text; the table values are used. Only 4 studies (10 datasets) contributed. |
| `longest_sleep_hours.all.183-731` | Same as above. |
| `bedtime_minutes_after_noon.all.122-365` | Only the Swiss cohort (children born 1986-1993) covers this band; the Brazilian cohort puts bed and wake times about 2 hours later than in high-income countries (Netsi 2017). |
| `bedtime_minutes_after_noon.all.365-731` | The Swiss mean (19:46) lies outside the Brazilian 2.5th-97.5th percentile range (20:00-01:00): the sources disagree by culture; the Brazilian value is the prior. |
| `wake_time_minutes_after_midnight.all.122-365` | Only the Swiss cohort covers this band (see the bedtime row). |
| `feeds_per_24h.formula.0-30` | SBP gives 6-8 formula feeds; the AAP's minimum of 8 is stated for newborns in general. |
| `feeds_per_24h.formula.122-183` | SBP's 2-3 milk feeds after 4 months assume complementary food started at 4 months for non-breastfed infants; a baby not yet on solids drinks more often (the AAP gives 4-5 feeds at 6 months). |
| `feeds_per_24h.formula.183-213` | Sources disagree: SBP 2-3, Ministry of Health 4, AAP 4-5 milk feeds at 6 months. |
| `feed_gap_minutes.formula.0-28` | The two AAP pages differ for the first weeks (every 2-3 h for newborns in general, every 3-4 h for formula-fed babies). |
| `feed_volume_ml_per_feed.formula.0-7` | SBP gives 60-120 ml for the whole first month; the AAP says 30-60 ml in the first week. |
| `milk_ml_per_kg_per_24h.formula.0-183` | Unit converted from a per-pound statement; a single society statement without a range. |
| `dirty_diapers_per_24h.formula.112-140` | Only 31 infants were mainly formula-fed in this cohort. |
| `solid_meals_per_day.all.183-213` | The WHO counts any complementary feed (2-3 a day at 6-8 months); the Ministry of Health counts one main meal plus two fruit snacks at 6 months. |
| `solid_meals_per_day.all.274-365` | The Ministry of Health's 2 main meals (plus 2 snacks) are below the WHO's 3-4 meals at 9-11 months. |

### 10.2 Document-level items
- **R-AN-1 Licences** L1 to L5 (section 3).
- **R-AN-2 Ministry of Health page numbers** (pp. 117-127 and 148-151) were read from the PDF's extracted text; confirm against the printed guide.
- **R-AN-3 SBP sources**: Tabela 5 is in chapter 1 (around p. 30 of the PDF); the SBP 2021 sleep document (nº 5) could not be read as text, so the 2025 family page that repeats the AASM table was cited.
- **R-AN-4 WHO 2023 guideline** on complementary feeding was not read; the 2011 Q&A page was used.
- **R-AN-5 Ministry of Health Caderno de Atenção Básica nº 23** (2015, breastfeeding and complementary feeding) answered HTTP 503; it may give Brazilian feed counts and diaper signs. Re-check.
- **R-AN-6 Parent report**: most sleep, crying and stool data are parent diaries or questionnaires; parents report more sleep than actigraphy measures (Galland: 14 to 50 minutes).
- **R-AN-7 Band placement** of point measurements (section 4.1) and the 3-to-4-month sleep band, which holds the 3-month measurements only.
- **R-AN-8 Kent 2006**: the 24-hour intake is not in the abstract; MILQ is used for intake per day instead.

## 11. Validation

`code/api/src/Lotties.Domain/AgeNorms/AgeNormsValidator.cs` holds the rules (rules 1 and 3 to 8 below); the API runs it at startup (`EmbeddedAgeNormsProvider`: an invalid file stops the API) and `code/api/tests/Lotties.Domain.Tests/AgeNorms/AgeNormsDataTests.cs` runs it on the file linked into the test output (`Lotties.Domain.Tests.csproj`, `AgeNorms\age-norms.json`), plus the trailing newline, the pinned counts (rule 2) and the lookup (rule 9). `AgeNormsValidatorTests` breaks each rule once. The checks:
1. a trailing newline, schema version 1, `generatedAt` date, the allowed units, populations, range and typical kinds;
2. pinned counts (18 sources, 22 metrics, 91 norms, 17 to review, missing metrics `nap_minutes` and `wake_window_minutes`);
3. metrics: unique snake_case keys, allowed units, norms present unless `missingReason`;
4. sources: unique slugs, citation, kind, country, licence and note, https url, access date, each used by a norm;
5. norms: id = `metric.population.fromDays-toDays`, unique; known metric with the same unit; known population; non-empty band with weeks matching days; at least one value; low ≤ typical ≤ high; confidence high|medium|low; a review reason exactly when `needsReview`; `sourceIds` exist and equal the evidence's sources in order;
6. evidence: location and source age, value order, a known `rangeKind` exactly when a low or high is given, a known `typicalKind` exactly when a typical is given, positive SD;
7. the merge rule (section 4.4) for every norm;
8. no overlapping bands per metric and population;
9. a lookup by age in days finds one band (3-month-old total sleep; day-6 wet diapers).

## 12. Yearly review (operator, at least once a year, with the vaccine schedule review of docs/design/18 section 8)

1. Look for new editions: the NSF and AASM statements; SBP (Departamento de Sono documents, Manual de Alimentação); the Ministry of Health's Guia alimentar and Caderneta da Criança; the AAP HealthyChildren pages ("Last updated"); ABM Protocol #3; the WHO complementary feeding guideline; new systematic reviews and cohorts (infant sleep norms, fuss/cry durations, stool frequency, breast milk intake), Brazilian data first.
2. Re-read sections 9 (missing) and 10 (needs review). A missing norm is filled only with a published value.
3. Edit the JSON by hand or with a throw-away script that keeps the canonical format (`json.dumps(indent=2, ensure_ascii=False)` plus a trailing newline): add evidence items with their location and the source's own age label, recompute low/high/typical by the merge rule, update `sources[].accessedOn`, bump `generatedAt`. Keep ids stable; a band that changes is a new id.
4. Run `dotnet test code/api/Lotties.sln` (update the pinned counts in `File_KeepsTheResearchCounts` with the data).
5. Update this doc (sections 2, 6, 8, 9, 10) and the credits (section 13).

## 13. Credits

Done by the wiring task: three `kind: "data"` entries in `code/web/src/credits/curated.json` (`agenormsSleep`, `agenormsFeeding`, `agenormsDiapersCrying`), each linking to this document (it lists every citation, DOI and licence), with their `credits.curated.<id>` sentences in en and pt-BR `credits.json`; `CREDITS.md` regenerated (`node code/web/scripts/generate-credits.mjs`). The sentences are a first draft for the owner to review. The grouping follows the research suggestion:
- `agenorms-sleep`: "Infant sleep norms: National Sleep Foundation (2015), American Academy of Sleep Medicine (2016), SBP (2025), Galland et al. (2012), Iglowstein et al. (2003), Pelotas 2004 Birth Cohort (Netsi et al. 2017, CC BY 4.0)";
- `agenorms-feeding`: "Infant feeding norms: SBP Manual de Alimentação (2024), Ministério da Saúde Guia alimentar (2019), AAP HealthyChildren, Academy of Breastfeeding Medicine, Kent et al. (2006), MILQ Study (2025, CC BY 4.0), WHO";
- `agenorms-diapers-crying`: "Diaper and crying norms: UNICEF UK Baby Friendly checklist (via NHS), den Hertog et al. (2012), HELMi cohort (2024, CC BY 4.0), Wolke et al. (2017)".
The existing `sbp` credit (vaccine schedule) could also mention the sleep and feeding facts.

## 14. Not covered

- **Growth percentiles**: the app draws the baby's own measurements only. WHO Child Growth Standards (and the Caderneta da Criança curves) are a separate data task with its own licence check (docs/design/04 section 5).
- **Premature babies** (corrected age), twins, babies with medical conditions, special formulas, solid food amounts and water.
- **Colic**: Wolke 2017 reports 17-25 % in the first 6 weeks, 11 % at 8-9 weeks and 0.6 % at 10-12 weeks (modified Wessel criteria). Recorded here as context only; the app never diagnoses colic (docs/design/04 never-say list). The cry-reason ranking is designed separately (docs/design/27-cry-reasons.md).

## 15. Wiring (2026-10-23)

### 15.1 Plumbing
- **API**: `Lotties.Domain/AgeNorms/` (`AgeNormSet` with `For(metric, population, ageDays)` and `PriorFor(...)`, `AgeNormsJson` strict parser, `AgeNormsValidator`), `Lotties.Application/AgeNorms/AgeNormsProvider.cs` (embedded resource, parsed and validated once, strong ETag `"agenorms-{generatedAt}-{hash8}"`), `GET /api/v1/age-norms` (any signed-in user, `Cache-Control: private, max-age=86400`, 304 on `If-None-Match`; docs/SPEC.md).
- **Web**: `code/web/src/ageNorms/` (`normFor`, `priorFor`, `ageInDaysAt`; `ageNormsCache.ts` and `useAgeNorms()`: Dexie table `ageNorms` (schema v10), one row, asked again at most daily with `If-None-Match`). Without a copy (a first run offline, or before the first download) every caller keeps its built-in default, so behaviour without the norms is exactly the old one.
- **Lookup**: the band of the metric whose `[fromDays, toDays)` holds the age in completed days since birth (local calendar dates), for the requested population, else for `all`. Days rather than weeks: the bands are defined in days, weeks are rounded. `For`/`normFor` return any norm with its flags; `PriorFor`/`priorFor` return it only when it may replace a default: **never a norm with `confidence: low` or `needsReview: true`**. Every wiring below goes through `PriorFor`/`priorFor`, so clearing a review flag in the data (after the owner's review) is enough to activate a norm, and flagging one switches it off.
- **Shared vectors**: `code/web/src/ageNorms/ageNormsVectors.json`, run by `ageNorms.test.ts` and by `Lotties.Domain.Tests/AgeNorms/AgeNormsVectorTests.cs` (linked file), against the shipped file.

### 15.2 Wired

Every default that now comes from a norm. Values that come from norms in the table below change only when a norm that is usable as a prior covers the age; elsewhere the old value stays.

| Default | Where | Old value | New value | Norm (source ids) |
|---|---|---|---|---|
| Bottle cold-start chips, days 7-29 | `code/web/src/events/bottleAgeDefaults.ts` `normBottleRange`, used by `bottleSuggestions.ts` | 0 m row: 30-90 ml (chips 30, 60, 90) | 60-120 ml (60, 90, 120) | `feed_volume_ml_per_feed.formula.7-30`, high (sbp-alimentacao-2024, aap-formula-2022) |
| Bottle cold-start chips, days 30-60 | same | 0 m row 30-90 until the first monthly birthday, then 1 m row 90-120 (90, 120) | 90-150 ml (90, 120, 150) | `feed_volume_ml_per_feed.formula.30-61`, medium (sbp-alimentacao-2024, aap-formula-2022) |
| Bottle cold-start chips, days 61-90 | same | 1 m row 90-120, then 2 m row 120-150 (120, 150) | 150-180 ml (150, 180) | `feed_volume_ml_per_feed.formula.61-91`, medium (sbp-alimentacao-2024) |
| Bottle cold-start chips, days 91-121 | same | 2 m row 120-150, then 3 m row 120-180 (120, 150, 180) | 180-200 ml (180, 200) | `feed_volume_ml_per_feed.formula.91-122`, medium (sbp-alimentacao-2024) |
| Bottle cold-start chips, days 122-182 | same | 3 m row 120-180, 4 m row 160-200 (160, 190), 5 m row 180-240 (180, 210, 240) | 180-200 ml (180, 200) | `feed_volume_ml_per_feed.formula.122-183`, medium (sbp-alimentacao-2024) |
| Bottle cold-start chips, days 183-364 | same | 5 m / 7 m rows 180-240 | 180-240 ml (same chips) | `feed_volume_ml_per_feed.formula.183-365`, high (sbp-alimentacao-2024, aap-formula-2022) |
| Feed-gap cut-off of the feeding average, 12 to under 18 months (days 365-547) | web `code/web/src/insights/feedGapLimit.ts` (used by `feedingModel.ts` `feedGaps`/`feedingSummary`, Insights feeding card); API `Lotties.Domain/Clinical/FeedGapLimit.cs` (used by `FeedingSummaries.Summarize`, clinical summary feeding section) | 8 h | 13.6 h (the band's high end, 97.5th-98th percentile night) | `night_sleep_hours.all.365-548`, medium (pelotas-2017, iglowstein-2003) |
| Feed-gap cut-off, 24 to under 36 months (days 731-1095) | same | 8 h | 13.4 h | `night_sleep_hours.all.731-1096`, medium (pelotas-2017, iglowstein-2003) |
| Cry ranker hunger default gap, breastfed, days 0-27 | `code/web/src/now/cryReasons.ts` `normFeedGapMinutes` (used only without her own usual gap) | `newborn` band 150 min | 120 min (the published typical gap) | `feed_gap_minutes.breastfed.0-28`, medium (aap-feeding-2024) |
| Cry ranker hunger default gap, breastfed, days 28-182 | same | `newborn` 150 min (to 41 days), `weeks6to3m` 180 min, `months3to6` 210 min | **not changed** (131 min from 24 h / 11 feeds was wired first and reverted 2026-10-24: too short for 3 to 6 months; waits for an age-banded, reviewed norm) | `feeds_per_24h.breastfed.28-183`, medium (kent-2006) |
| Benchmark bed-time prior, 3 months and over (`ml/benchmark/priors.py`, benchmark only) | `PUBLISHED_BEDTIME` | 20:00 sd 60 (3-6 m), 19:45 sd 45 (6 m+) | 22:00, sd 77 min | `bedtime_minutes_after_noon.all.91-122` and `.365-731`, Pelotas values (pelotas-2017; the 365-731 norm is flagged for the Swiss disagreement, the Pelotas value is the unflagged part) |
| Benchmark night-length prior, 3 months and over | `PUBLISHED_NIGHT` | 11 h (3-6 m), 11.5 h (6 m+) | 9.5 h (3-6 m), 9.75 h (6-12 m), 10 h (12 m+); log sd 0.15-0.19 | `night_sleep_hours.all.91-122`, `.365-548` (pelotas-2017) |

Cry-ranker golden cases (cryReasons.test.ts): a breastfed 3-week-old 120 minutes after the start of her feed, hunger 0.633 before, 0.9 after; a breastfed 2-month-old, 0.286 before, 0.639 after (both without a usual gap of their own). The 55 earlier tests are unchanged (they pass no norms, which keeps every band value).

Feed-gap rule (both engines, shared vectors `feedGapLimits`): under 183 days always 8 h (identical results for babies under 6 months, by design); from 183 days the high end of `longest_sleep_hours` if usable, else of `night_sleep_hours`, clamped to 8-14 h (14 h: above every published night, 13.7 h, and below the 16 h night-session cap `MaxNightSessionLength`); 8 h when neither is usable. The age is the baby's on the local date the gap starts (API: the family's clock of the clinical window). The doctor's patient list (`DoctorPatientsService`) reports no gap and is untouched.

### 15.3 Deliberately not changed

- **Bottle chips, first week** (days 0-6): `feed_volume_ml_per_feed.formula.0-7` needs review (SBP 60-120 vs AAP 30-60 ml, D7): the month table's 30-90 ml stays. **From 12 months**: no published band, the 7 m+ row stays. **No birth date**: the neutral set (I2) stays.
- **Feed-gap cut-off, 6 to under 12 months and 18 to under 24 months**: the only norms there are flagged (`longest_sleep_hours.all.183-731` needs review because Galland's table and text differ by 0.1 h, D5; `night_sleep_hours.all.244-365`, `.122-244` and `.548-731` are low confidence, Swiss only): 8 h stays. Clearing the review flag of `longest_sleep_hours.all.183-731` after the owner's check would raise the cut-off to 13.7 h from 6 months with no code change. **Under 6 months** 8 h by design (results identical). **From 36 months** no band.
- **Night window and wake window** (I6, I7): measured in section 15.4, unchanged.
- **Cry ranker**: the wake-window defaults (no published norm: `wake_window_minutes` is missing, section 9), the diaper-gap defaults (only counts and minimums are published; a minimum is a checklist, section 0), the formula-fed defaults (ranges without a central value, or needing review), everything from 6 months (milk-only norms do not describe a day with meals), and the ranker's own 8-hour history filter (`feedGapMaxMinutes`).
- **Wet-diaper drop line** (I11) and **the gates** (I12): section 7.6 and 7.7; **age band boundaries, the 16-hour night cap, the 04:00 evening boundary** (I3, I8, I9): they fit.
- **Quoted context in docs/design/04** (I5): parent-facing wording is an owner and UX decision; not touched.
- **The doctor's patient list**: shows no feed gap, nothing to change.

### 15.4 Night window: measured, not changed

**Question.** `PredictionOptions.NightStartsAt`/`NightEndsAt` (19:00-07:00, I6) split feed and sleep samples into day and night; `WakeWindowOptions.DayStartsAt`/`DayEndsAt` (05:00-18:00, I7) bound the overtired heads-up. Brazilian babies go to bed at a median 22:00 (section 7.4), so their evening is classed as night. Would a later or per-baby window predict better?

**Method.** `python -m benchmark.night_window --out out` (ml/, synthetic only; `--data <csv>` runs it on an export the owner provides, aggregates only). Two synthetic cohorts of 30 babies, 35 days each, 4 to 20 months old (`benchmark/synthetic.py` `cohort_baby`): **brazil** (each baby's usual bed time drawn around the Pelotas median 22:00, sd 70 min, 20:00-01:00; night length around the Pelotas medians 9.5 / 10 / 10.5 h at 3 / 12 / 24 months, sd 1 h; about one night waking) and a **swiss_control** (bed time around 20:00, sd 30 min; nights 11-11.7 h, Iglowstein). Unsourced generator parts (no published norm): awake windows, nap lengths, a 3-hour day feed gap, a last feed before bed, feeds only at night wakings, all jitter. The faithful heuristic port (`benchmark/heuristic.py`) predicts the next feed (asked after each feed) and the next sleep (asked at each wake-up) after a 14-day warm-up; MAE in minutes on points where every variant predicts, Δ = variant minus current, 95 % bootstrap CI over babies. Variants: `current` 19:00-07:00; `norm_prior` 22:00-08:00 (Pelotas median bed and wake times); `norm_prior_m60` 21:00-08:00; `learned` the baby's own median `bed_time` and `woke_up` clocks over the 14-day look-back (at least 5 nights, else the norm prior); `learned_m60` the same starting one hour before her median bed time; `learned_m60_or_current` falling back to 19:00-07:00.

**Results** (Δ MAE in minutes, 95 % CI; the generator's last feed 15 minutes before bed):

| Cohort | Target | current MAE | norm_prior | learned | learned_m60 |
|---|---|---:|---|---|---|
| brazil | next feed, all | 37.1 | -1.4 (-2.7..+0.1) | -0.1 (-0.8..+0.7) | -1.7 (-2.9..-0.8) |
| brazil | next feed, asked 18:00-24:00 | 76.3 | -9.7 (-13.7..-6.1) | -8.3 (-11.4..-5.2) | -16.5 (-22.2..-11.4) |
| brazil | next sleep, all | 50.9 | -2.2 (-7.1..+0.7) | -7.5 (-14.9..-1.6) | -7.5 (-15.0..-1.7) |
| brazil | next sleep, asked 18:00-24:00 | 47.6 | +3.9 (+0.0..+9.0) | +5.1 (+1.5..+10.8) | +5.1 (+1.5..+11.2) |
| swiss_control | next feed, all | 41.0 | +2.8 (+1.2..+4.6) | +3.0 (+1.2..+5.1) | +1.0 (-0.4..+2.5) |
| swiss_control | next sleep, all | 51.0 | -11.2 (-19.5..-5.0) | -6.9 (-13.8..-1.4) | -6.9 (-13.8..-0.7) |

Sensitivity to one unsourced generator choice, the time from the last feed to bed (Δ of `learned_m60`, next feed, all): 15 min -1.7 (brazil) / +1.0 (swiss); 45 min -0.4 (-1.3..+0.5) / +1.3 (-0.4..+3.0); 90 min **+3.4 (+0.9..+6.2)** / **+3.2 (+1.1..+5.7)**. The next-sleep gain of the learned window holds in all three settings (-4.2 to -7.5 min for brazil, -6.0 to -6.9 for swiss, the CI touching 0 in some), while next-sleep asked in the evening gets worse in all of them (+4 to +11 min).

**Conclusion: no clear improvement, code unchanged.** The feed result changes sign with an unsourced detail of the synthetic day, the evening sleep prediction gets worse with every later window, and a fixed 22:00 window hurts babies who go to bed early (+2.8 min on feeds for the swiss control). The only consistent signal is a smaller next-sleep error with a per-baby window, and that is exactly what a synthetic generator built from per-baby bed times favours. **Synthetic data cannot prove a real-world gain**, so `NightStartsAt`/`NightEndsAt` and the wake window's `DayStartsAt`/`DayEndsAt` keep their values and no past sample is classified differently. (The overtired heads-up has no Python port, so I7 was not measured; the same per-baby derivation would apply.)

**Recommendation.** Before any change: run `python -m benchmark.night_window --data <the owner's export>` (and the full `benchmark.run`) on real logs. If the owner pursues it, the candidate is a clearly named, default-off option such as `PredictionOptions.NightWindowFromBedtimes` (the night starts at the baby's median `bed_time` clock over the look-back minus a margin and ends at her median `woke_up` clock, from at least 5 logged nights; below that the fixed 19:00-07:00 window, not the norm prior, since `norm_prior` alone was worse for early sleepers), applied first to the sleep (awake-window) prediction only, and with the evening sleep error watched.

### 15.5 Benchmark priors (`ml/benchmark/priors.py`, benchmark only, not shipped)

- **Changed** (rows in 15.2): bed time 22:00 (sd 77 min = the Pelotas 20:00-01:00 range / 3.92) from 3 months; night 9.5 h (3-6 m), 9.75 h (6-12 m, midpoint of the Pelotas 3 and 12 month medians), 10 h (12 m+), log sd from the Pelotas 97.5th percentile. The 6-12 month bed time and night have no Brazilian measurement of their own (only the low-confidence Swiss norm): the benchmark uses the Pelotas values on both sides, said so in the code. The 12-24 month bed-time norm is flagged (Swiss and Brazilian means disagree, D3); its Pelotas value is what the benchmark uses, openly, because the benchmark is the place to measure such a choice and nothing here ships.
- **Explicitly unsourced** (`UNSOURCED_*` constants, values unchanged): awake windows 75/105/165/240 min, nap lengths 60/60/75/105 min, feed gaps 150/180/210/240 min, diaper gaps 180/210/240/270 min, and the under-3-month bed time (21:00) and night (10 h), for which nothing is published.
- `LEGACY_PRIORS` keeps the old table; `use_legacy_priors()` / `run --legacy-priors` switch to it.
- **Before/after on synthetic data** (`python -m benchmark.prior_check`, prior median against every valid outcome, 30 babies per cohort, MAE in minutes):

| Cohort | Target | n | Before | After |
|---|---|---:|---:|---:|
| brazil | bed time | 2990 | 127.9 | 47.8 |
| brazil | night length | 1020 | 84.3 | 50.0 |
| swiss_control | bed time | 2920 | 30.4 | 126.3 |
| swiss_control | night length | 1020 | 32.7 | 84.8 |

  This is circular by construction: the Brazilian cohort is drawn from the same Pelotas medians as the new priors, the Swiss control from the values the old priors resembled. It only confirms that the priors now describe Brazilian families as the published cohort does, and shows the cost for a family that keeps a Swiss-like rhythm (the priors matter only until the baby's own log takes over). Synthetic data cannot prove a real-world gain.
- **The full harness still runs** (`python -m benchmark.run --synthetic brazil [--legacy-priors] --resamples 500`, one synthetic Brazilian baby, seed 0, 70 days; about 30 minutes for both runs in parallel on a laptop). Test window, MAE in minutes, before → after: `age_band_prior` bed time 104.7 → 28.4 (n 67), night length 32.5 → 57.5 (n 20: this baby's nights are longer than the cohort median); `shrinkage` bed time 17.6 → 17.5, night 12.5 → 12.1; `ensemble` bed time 18.3 → 19.5, night 12.6 → 11.9. Cold start (rolling, week 3): shrinkage bed time 17.3 → 10.5, night 18.0 → 18.6. Every other target and method is identical before and after (feed, sleep start, nap length, diapers), as expected: only the bed-time and night priors changed. One baby; read it as a smoke test, not evidence. (To run on synthetic data the cohort babies log a weekly medication: an all-missing feature column makes scikit-learn 1.9's HistGradientBoosting binning fail, so the harness also fails on any export without medication events; not fixed here.)
