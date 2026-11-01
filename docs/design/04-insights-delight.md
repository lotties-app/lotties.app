# 04 · Insights, guidance and delight

What turns a log into help. Reviewed 2026-10-21. This builds on DESIGN.md §10 and agrees with `01-ux-strategy.md` on three things: Growth moves inside Insights, the doctor view becomes a "Visit summary", and a time window replaces the confidence chips.

Mockups (390 px, light and dark, synthetic data):
- `mockups/04-insights.html`: ranges, a low-data toggle, tooltips, tables.
- `mockups/04-predictions-v2.html`: prediction states, the Why sheet, guidance, a routine idea, quiet hours.
- `mockups/04-digest-growth-report.html`: weekly digest, growth, printable visit report.

## 0. Stance

1. **Lia against Lia.** Population norms appear only as optional text with a source, never as colours on her charts. Growth curves are the one exception.
2. **Traceable.** Each insight names its time window and sample size.
3. **On the device.** Insights are computed from Dexie, so they work offline and send nothing new to the server.
4. **No alarms, no grades.** No red or green, no "overdue", no streaks, no comparing babies or co-parents.
5. **Honest gaps.** Partly logged days are striped and left out of typical values.

## 1. What parents want to know

| Age | Questions | Insight | Optional context (sourced) |
|---|---|---|---|
| 0-3 m | Eating enough? How many diapers? When can I sleep? | Last-24 h clock, feeds and gaps, wet and poop counts, longest stretch | 8-12 feeds a day is common. AASM sets no sleep target under 4 months |
| 3-6 m | Are nights getting longer? Next nap? | Longest-stretch trend, nap window, naps per day, bedtime consistency | AASM: 12-16 h per 24 h. Quoted awake times run about 1h15-2h30, on thin evidence |
| 6-12 m | Dropping to 2 naps, wakings, solids | Nap-count trend, wakings, first foods (`food`) | WHO and the Brazilian Ministry of Health (MS): solids from 6 months |
| 12 m+ | Dropping to 1 nap, bedtime, sick weeks | Nap switch, night total, medication and symptom timeline | AASM: 11-14 h |

In order, the layer answers: what happened, what's typical now, what changed (only when it matters), what's next, and optionally what might help.

## 2. Insights screen

**Layout.** A sticky 7/14/30-day filter sits at the top. Below it come a summary sentence, a last-24 h clock (midnight on top, rolling), four tiles, the sleep charts, Feeding, Diapers, and "How these numbers are calculated".

**Charts that beat Napper's area chart:**
- **Sleep rhythm (actogram), the hero.**
  - One row per day, newest on top, axis 06:00→06:00 (the floor of the median wake hour), so a night is never split.
  - Night uses the strong sleep step, naps the light step, and wakings show as gaps.
  - Feeds (ticks), diapers (dots) and meds (diamonds) are toggleable layers.
  - It shows consolidation, drift and nap transitions at a glance. 01 has it at P2; I'd make it P0.
- **Sleep per day:** columns with night and naps stacked, plus a solid "typical" hairline.
- **Longest night stretch:** a dot per night, a 7-night median line, and a ring on the best night. This is the "getting better" chart.
- **Bedtime and wake-up:** strips with a band for the middle half, so consistency shows without a target.

**Metrics**

| Metric | Definition |
|---|---|
| Sleep session | Same as `Domain/Predictions/SleepSessions`: `bed_time`→`woke_up` ≤ 16 h is a night, `fell_asleep` absorbs a timer, `night_waking` is never sleep |
| Asleep pieces | Session minus overlapping wakings; a bed-time night starts at `fell_asleep` if logged |
| Baby day d | [06:00 d, 06:00 d+1): naps starting in it plus that evening's night |
| Night sleep · longest stretch | Sum and maximum of the night's asleep pieces; "in bed" = bedtime to wake-up |
| Awake window | Session end → next start (first and last of the day kept apart) |
| Bedtime consistency | IQR in minutes, measured from noon |
| Feeds | Count, night feeds, ml (Σ the drunk amount, `amount_drunk_ml` else `amount_ml`, by `bottle_feeding_type`), nursing minutes, median daytime gap, longest night gap |
| Diapers | Wet = WET+MIXED, poop = DIRTY+MIXED; last poop |
| Medication | Doses per day; days given; last given |
| Fully logged day | Finished night, ≥ 1 nap, no daytime gap > 5 h; otherwise "partly logged" |
| Typical | Median of ≥ 4 fully logged days |
| Change | Vs the previous equal period, only with ≥ 4 full days in each; under max(15 min, 5 %) it says "about the same" |

**Home.** Replace the calendar-day "Sleep total", which mixes two nights, with "Last night 10h 23m · Naps today 2h 05m".

**Chart rules**
- **Palette.** These are chart tokens, separate from the UI tints, checked with the dataviz colour-blindness validator:

  | Token | Light | Dark |
  |---|---|---|
  | Night | `#4c3fb0` | `#b4a9ff` |
  | Nap | `#9a8ef0` | `#7c6cf0` |
  | Feed | `#0f8a6e` | `#1fa889` |
  | Diaper | `#b0700f` | `#c98322` |
  | Medication | `#c0449e` | `#d65fb8` |

  Sleep, feed and diaper pass every pair (worst ΔE 9.6). Medication vs feed is about 6.2, so medication is always drawn as a diamond.
- **Never colour alone.** Every series also gets a shape, a legend and a few direct labels. Text uses ink tokens at 12 px or larger. No dual axes.
- **Neutral deltas.** Show "+20m vs the 14 days before" in muted ink, because more sleep isn't automatically "better".
- **Accessible.** Each chart has a takeaway caption, a `role="img"` summary, focusable marks with the tooltip, and "Show as table".
- **Low data.**
  - Under 4 full days: a "Learning Lia's rhythm · n of 4" card and no typical values.
  - Under 7: trend charts become one-line empty states.
  - Partly logged days are striped, the rest of today is shaded, and charts don't animate in.

## 3. Predictions v2

- **Window first.** "14:40–15:10" large, then "likely in about 45m · awake since 12:48". Edges round outward to 5 min. The window is at least 20 min wide, or 60 min while learning.
- **Confidence in words and width.** "Based on 30 naps · last 14 days" or "Early estimate · 3 naps so far" with a progress bar replaces the Low/Medium/High chips.
- **A strip instead of the 0-100 % ring.** One strip shows awake time so far, the likely window and now. The ring read as a deadline; if it stays, draw the window on it as a band.
  - Built (2026-10-23, docs/DESIGN.md "Now: rhythm details"): both the ruler and the ring answer on demand. Hover or tap any mark for its exact times ("Nap window opens 15:50, closes 16:39 · Opens in 1h 20m · Based on the usual awake time of about 2h 15m"), "now" is a small baby face (awake, drowsy in the window, asleep, tired in the overtired heads-up), and the rest of the day's likely naps, the likely wake-up of a running nap and the bedtime window are drawn as dashed estimates that fade further out. Facts and the server's numbers only; "(estimate)" in every name.
- **Why sheet.** Built from `basis`: last wake-up, the awake-time IQR of n naps, daytime only, the age band, and recent days weighing more. A collapsed, hideable "What's often quoted at 4 months" shows ranges with sources.
- **States:**
  - Awake.
  - Napping: "usually wakes 14:35–15:10".
  - Past the window: facts only. The card steps aside after 2 h and never says "overdue".
  - Log gap of 6 daytime hours: the card shows "paused" with Asleep / Awake buttons.
  - Offline: "as of 13:05".
- **Guidance.** Today's awake windows are drawn against Lia's own band, which adapts with age.
- **Engine v1.1** (pure Domain):
  - Split awake windows by position (first, middle, last) once each has 5 or more samples. The last window is longer at 4-9 months.
  - Predict a bedtime window from the end of the last nap.
  - Expose `distinctDays`.
- **Routine ideas** (P2, opt-in, at most one a week). Each is an observation plus an option: "…last nap ended after 17:15 on 4 of 7 days; some families try ending it by 17:00". "Not for us" mutes that rule. Ideas never touch feed amounts, medication or sleep training.

## 4. Getting better every day

- **Small wins**, judged against Lia's own history (at least 7 full days):
  - a 30-day longest-stretch best;
  - steady bedtimes;
  - a change in nap count;
  - longer nights.

  One sentence and a star icon each. No confetti, badges, points or streaks, and the amount of logging is never a win.
- **Hard weeks.** Said once, without advice: "Nights were more broken this week. Many families see ups and downs around this age."
- **Daily and weekly.** Home gets a "Last night" line. A Sunday digest card shows the wins, this week vs last, "Logged together by you and Ana" (no per-parent counts) and Share as text.
- **Notifications** (P2, Web Push; iOS needs the installed app):
  - All are opt-in.
  - Quiet 20:00-07:00 and whenever a sleep timer runs.
  - Never about "late".
  - The lock screen shows generic text.
  - The payload is a type code only, so no child data reaches push services.
- **Visit report**
  - **Options:** 7/14/30 days or since the last visit; which sections; notes off by default (they may name other people); name or "Baby" plus age.
  - **Contents:** typical day, a mini actogram, a day table with partial days marked, medication, growth with percentile and z-score, and Questions for the doctor.
  - **Output:** printed or saved as PDF on the device, or sent with Web Share. No server PDF, no share link, and a note that a shared file can't be recalled.

## 5. Growth

- **Curves.** WHO standards for 0-24 months, which CDC/AAP and Brazil's Caderneta da Criança also use. CDC charts for 2-20 years at P2.
- **New optional fields.** `sexAtBirth` ("used only to choose growth curves"; without it, show points without curves) and `gestationalAgeWeeks` (corrected age until 24 months).
- **Chart.** Weight, length and head.
  - P3-P97 and P15-P85 as one-hue washes, P50 as a hairline, Lia's line in the accent colour.
  - No red zones and no "crossed percentiles" flags, which are a clinical call. Copy describes the line over time.
  - Z-scores are computed locally from the LMS values and appear only in the visit report.
- **Reminders.** Off by default. After a checkup, prompt to add its measurements.
- **Checkup packs** by country (optional):
  - Brazil (MS): week 1, then 1, 2, 4, 6, 9, 12, 18 and 24 months.
  - US (AAP Bright Futures): 3-5 days, then 1, 2, 4, 6, 9, 12, 15, 18, 24 and 30 months.
- **Licensing**
  - WHO's own `anthro` R package (© WHO) is GPL-3, which is AGPL-compatible, and includes the standards (`data-raw/growthstandards`).
  - Vendor the LMS values as JSON with a `DATA-LICENSES` attribution, after checking the per-file terms.
  - Don't redistribute WHO, CDC or RCPCH chart images; RCPCH requires acknowledgement and forbids promotional use. Never imply endorsement.

## 6. Milestones and vaccines (optional modules)

- **Vaccine record (P1).** An instant type with name, dose, and optional lot, place and reaction. It is a record, not advice.
- **Schedule packs (P2)**
  - Versioned data with a source URL and valid-from/valid-until dates, e.g. `BR-PNI-2025`. Recent changes: MenACWY replaced the MenC booster at 12 months (July 2025), and inactivated polio (VIP) replaced the oral boosters (2024-25).
  - Copy: "Usual at 4 months in Brazil's national calendar · check with your health unit". No overdue, no red, no catch-up logic. An expired pack says it may be out of date.
  - Risk: schedules change and are contested (US, 2025). Mirror only official national sources, never a private society's such as SBIm.
- **Milestones (P2, off by default).** Built as memories ("first smile", with a date and a note), not a checklist.
  - Every source needs a licence check and a pediatric review.
  - CDC "Learn the Signs. Act Early." (2022, at least 75 % of children) is a US government work; check the image rights.
  - The Caderneta is CC BY-NC-SA 4.0. Its NC clause clashes with AGPL, so it ships as a separately licensed pack.
  - Never mix countries, score, or say "late".

## 7. Tone of voice

- Factual, warm and short: one idea per sentence.
- Use the baby's name, not pronouns. There is no sex field, and pt-BR adjectives would need gender agreement.
- No exclamation marks and no "should".
- Relative times for what's ahead, clock times for the past.
- pt-BR: informal *você*, `12h 50min`, decimal comma, 24 h clock.

| # | English | pt-BR |
|---|---|---|
| 1 | Lia slept about 12h 50m a day this week, about the same as the week before. | Lia dormiu cerca de 12h 50min por dia nesta semana, parecido com a semana anterior. |
| 2 | Longest night stretch: 6h 18m on Saturday, the longest this month. | Maior sono seguido da noite: 6h 18min no sábado, o maior do mês. |
| 3 | Next nap likely 14:40–15:10. | Próxima soneca provavelmente entre 14:40 e 15:10. |
| 4 | Early estimate · 3 naps so far. The window narrows as you log. | Estimativa inicial · 3 sonecas até agora. A janela fica mais precisa conforme você registra. |
| 5 | Nothing logged since 21:40, so the nap window is paused. | Nada registrado desde 21:40, então a janela da soneca está pausada. |
| 6 | Some days run later; log the nap whenever it happens. | Alguns dias são mais tarde; registre a soneca quando ela acontecer. |
| 7 | Nights were more broken this week. Many families see ups and downs around this age. | As noites foram mais interrompidas nesta semana. Muitas famílias passam por altos e baixos nessa idade. |
| 8 | Partly logged days are striped and left out of averages. | Dias com registro incompleto aparecem listrados e ficam fora das médias. |
| 9 | Quiet from 20:00 to 07:00, and whenever Lia is asleep. | Silêncio das 20:00 às 07:00 e sempre que Lia estiver dormindo. |
| 10 | An estimate from your logs, not medical advice. | Estimativa feita com os seus registros, não é orientação médica. |

**Never say**
- Judgements: "should", "overdue", "late", "behind", "only slept…", "good sleeper", "bad night".
- Labels: normal, abnormal or healthy about the baby; diagnoses (regression, colic, reflux); comments on the baby's body.
- Guilt and pressure: "you forgot", "you missed"; streaks, goals, scores; comparisons with other babies or the other parent.
- Advice on doses, formula amounts or sleep training.
- Urgency: "alert", "immediately".

The only health line, always static: "If something worries you, your pediatrician is the right person to ask."

## 8. Roadmap

| P | Item | Effort | Data / privacy |
|---|---|---|---|
| P0 | TS metrics module mirroring `SleepSessions` (baby days, completeness), with JSON fixtures shared by xUnit and Vitest | M | Local; no new data |
| P0 | Insights v1: summary, clock, tiles, actogram, sleep per day, longest stretch, feeds and diapers, tables, low-data states | L | Dexie; offline |
| P0 | Prediction card v2: window, words, strip, states, Why from `basis` | M | API unchanged |
| P0 | Chart tokens; tone and never-say checklist added to i18n review | S | None |
| P1 | Weekly digest, "Last night" line, small wins | M | Local |
| P1 | Visit report print view, Questions for the doctor | M | Built on the device; notes off |
| P1 | Growth percentiles: `sexAtBirth`, `gestationalAgeWeeks`, LMS file, local z-scores | M-L | Sensitive optional fields; state the purpose; erasable |
| P1 | Engine v1.1: awake windows by position, bedtime window, `distinctDays` | M | Pure Domain |
| P1 | Vaccine record type | S | Health data in the payload |
| P2 | Web Push: quiet hours, mute while asleep, private lock screen | L | Subscriptions on the server; payloads hold no child data |
| P2 | Offline predictions (port the engine to TS) | L | Fewer server calls |
| P2 | Routine ideas · imperial units and CDC 2-20 y | M · S | Local |
| P2 | Vaccine and checkup packs (Brazil's PNI first) | M + yearly | Needs a country owner; packs expire |
| P2 | Milestone memories and packs | L | NC licences; pediatric review |

## Synthetic sample data

The mockups use no real data, and no database or `.env` was read.
- **Generator:** mulberry32 with seed 20261021, producing 30 days for "Lia" (born 2026-06-12, "now" is 2026-10-21 14:10).
- **Sleep:** wake-up around 06:30; naps going from 4 to 3, with awake windows of 92 + 28p + 12n ± 16 min (p = progress through the 30 days, n = nap index); bedtime around 19:25.
- **Nights:** wakings go from 2.7 to 1.2, and the first stretch grows from 3.9 to 6.1 h.
- **Other events:** bottles every 2h40-3h25, diapers after most feeds, vitamin D every day, gas drops tapering off.
- **Gaps on purpose:** day 9 is missing its afternoon and night 20 has no bedtime.
- **Metrics** follow the definitions in §2. The growth curves are illustrative, not WHO data.

Sources: [AASM 2016](https://aasm.org/resources/pdf/pediatricsleepdurationmethods.pdf) · [CDC on WHO charts](https://www.cdc.gov/growth-chart-training/hcp/using-growth-charts/who-using.html) · [WHO anthro](https://github.com/WorldHealthOrganization/anthro) · [RCPCH terms](https://www.rcpch.ac.uk/resources/how-get-growth-charts-data-terms-conditions-use) · [Caderneta licence](https://www.arca.fiocruz.br/bitstream/handle/icict/43614/caderneta_crianca_menina_2ed.pdf?sequence=2) · [MenACWY 2025](https://sbim.org.br/images/nt-substituicao-meningoc-meningoacwy.pdf_2025-06-28.pdf).

## Summary

1. Insights compare Lia with herself. They are computed on the phone, and every number can be traced.
2. The hero chart is a 06:00→06:00 actogram, with a 24 h clock, daily sleep, longest stretch and bedtimes.
3. The palette is checked for colour blindness and backed by shapes; each chart has a table; changes are shown neutrally.
4. Predictions show a window whose width carries the confidence, with learning, napping, past and paused states and no "overdue".
5. Awake-time guidance adapts with age from Lia's own data. Population ranges are opt-in and sourced.
6. Progress means personal bests and steady rhythms, plus a Sunday digest. No streaks or comparisons.
7. Notifications are opt-in, silent at night and during sleep, and private on the lock screen.
8. The visit report is built on the device, with notes off and the name optional.
9. Growth uses WHO curves from the GPL-3 `anthro` package and needs an optional sex-at-birth field.
10. Vaccines start as a record. Schedules and milestones are versioned, licensed country packs.
