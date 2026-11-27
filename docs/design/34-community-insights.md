# 34. Community insights: opt-in pooled statistics (design, 2026-10-23)

Status: **partly built, off by default.** Task T2 (per-baby consent record, `GET/PUT /babies/{id}/community-consent`, Settings > Community insights) is merged (PR #88) and the T4 statistics catalog (`code/api/data/community-statistics.json`, schema 2 with the noise tiers of section 5.1, validated at startup, nothing served) is built, behind `CommunityInsights:Enabled` (default `false`). The pure aggregation core of T5 and the served release format are built (section 5.2) but not wired: the job (quarterly since the owner decisions of 2026-11-27, section 5.1.1) reads no events and writes a placeholder release with no cells, so nothing is collected, aggregated or published. The privacy policy describes it as "not active yet" (section
`community-insights` of `code/web/src/legal/privacy.<lang>.ts`, flow `communityInsights` in
`code/web/src/legal/dataFlows.ts` `PLANNED_FLOWS`, with status `planned`); tests fail if that wording is removed
while the flow is planned. **Not legal advice**: the LGPD points below are a starting point for the owner and a
Brazilian lawyer; the owner decisions are in section 13 and in docs/PRIVACY-OWNER-CHECKLIST.md section 8.

Owner request: with the parents' opt-in, a baby's data may be used together with other babies' data to give better
estimates (how much milk to offer, growth compared with babies of the same age, tummy time, behaviours and unusual
patterns, why the baby is crying, and similar). Earlier notes this generalises: docs/design/10-bottle-suggestions.md
"Phase 2" (opt-in anonymous aggregate, k = 20), docs/design/27-cry-reasons.md section 6 (per-baby learning, which
stays per baby and is not this feature), docs/design/28-age-norms.md (published norms as priors: the fallback this
feature must beat).

## 1. Goals and non-goals

Goals:
- Better **cold-start and context numbers** than the published norms where those are thin, wide or not Brazilian
  (bottle amounts per feed, tummy time per day, naps and night sleep at a given age, what helped a crying spell).
- A **calibrated "how much does a routine usually vary at this age"**, so the unusual-pattern note (a shift from the
  baby's own baseline) fires on a size of change that is actually uncommon, not on a guessed threshold.
- Privacy by design: opt-in per baby, aggregates only, a minimum group size, per-family caps, static published
  statistics, our own servers, open code, a published list of statistics, honest withdrawal.

Non-goals:
- No individual record, profile or model of a baby or family leaves the account; no research data set, no export of
  pooled data, no sharing or sale, no advertising, no profiling, no automated decision about a child or family.
- No per-baby learning (docs/design/27 section 6 stays separate and on-device/per baby; it needs no pooling).
- No diagnosis, no "normal/abnormal", no percentiles coloured red, no targets (docs/design/04 "Lia against Lia",
  docs/design/28 section 0). A pooled number is context or a prior, never advice.
- No queryable API over the pool, no comparisons between named babies, no leaderboard.
- Not for doctors: the Doctor role neither consents nor gets new data (section 3.4).
- Not on self-hosted instances by default (small populations never reach k; section 6.7).

## 2. The policy text (already published as "not active yet")

The section's structure (both languages, same blocks): a status note ("Not active yet ... off for everyone"), what it
would be, purposes, consent, a `planned` table (what each estimate would use, caption "Planned, not collected today"),
what it would never use, safeguards (aggregates only; minimum group size 20 from different families; per-family
caps; static statistics, optional noise; our own servers; no sale, ads, profiling or decisions; open code and a
published list), the honest limit of anonymisation and the RIPD before activation, who sees results, withdrawal and
rights, and the activation promise (update the section, raise version and date, notify in the app; a policy change
alone never turns it on). Activation checklist for the text: section 12, task T9.

## 3. Consent model

### 3.1 Recommendation: per baby, given by an Owner or Parent

| Option | For | Against |
| --- | --- | --- |
| Per account | one switch | a parent with two babies cannot choose per child; a co-parent's account would carry a baby she does not "own"; withdrawal semantics per baby get muddy |
| **Per baby (recommended)** | the data subject is the child; LGPD art. 14, §1 asks a parent's or guardian's consent **for the child**; matches the role model (permissions are per baby); withdrawal and deletion are per baby | each baby needs its own yes (that is the point) |

- Who may consent: a member with role **Owner or Parent** of that baby who ticks "I am this baby's parent or legal
  guardian" on the screen (the app cannot verify it; the Parent role may be a grandparent). **Caregiver, Viewer and
  Doctor cannot** consent or withdraw; they do not see the screen.
- One yes is enough (art. 14, §1: "pelo menos um dos pais ou pelo responsável legal"). Every Owner and Parent sees the
  state ("On since 3 Nov, turned on by Ana") and any of them can withdraw. Open decision O4: require that no other
  Owner/Parent objects, or a notice to the others when it is turned on (recommended: a notice, no veto).
- Never bundled: not in sign-up, not in the first run, not in a policy-accept step, not pre-ticked, no nagging. The
  screen is reached from Settings > Baby > Community insights (and at most one dismissible card once the feature is
  active, never repeated after "No, thanks").
- Consent is versioned: a material change of the consent text (new purpose, new field, lower k, new recipient) asks
  again; until the new yes, the baby is excluded.

### 3.2 Consent record (later: table `community_consents`)

Columns: `id`, `baby_id`, `user_id` (who said yes or withdrew), `action` (`granted` | `withdrawn`), `text_version`
(the consent screen version, e.g. `ci-1`), `policy_version` (`PRIVACY_POLICY_VERSION` at the time), `scopes` (the
purposes accepted: v1 is all-or-nothing, a JSON array kept for later per-purpose choice, open decision O5),
`guardian_confirmed` (bool), `at` (server time). Append-only (a new row per change; the current state is the latest
row). Retention: kept while the baby exists and, after withdrawal or erasure, as long as needed to prove the consent
(the lawyer sets the period, O8; proposal: 5 years, the general civil limitation period, with the baby id replaced
by a hash once the baby is erased). The baby's export includes its consent history.

### 3.3 Withdrawal

- Effective at once for future use: the next run excludes the baby (since 2026-11-27 runs publish quarterly, so the
  next release can be up to three months away) (the job reads only babies whose latest row is
  `granted` with the current `text_version`).
- Already published statistics: they are aggregates; the baby's share cannot be separated out of a number. The
  published file is replaced by the next published run, which excludes the baby; old versions of the file are not kept
  (except the previous one, for rollback, deleted on the following run). This is what the policy says; it does not
  promise "erasure of the contribution" from numbers already on other people's devices.
- Raw records are untouched and were never shared; they stay with the family (see, export, delete as before).
- Deleting a record, the baby or the account removes it from the next run (no copy exists).

### 3.4 Doctors

Unchanged access (docs/design/16, 19): a Doctor never consents, never sees the consent state, gets no pooled view
beyond what her sections already show. Open decision O9: whether a doctor may later see the same "babies this age"
context lines on her patient's shared sections (proposal: no, until a separate review).

### 3.5 The opt-in screen text

Title, body, two checkboxes (both required to enable the button), one primary and one secondary button. Copy must
go through `t()` (`locales/<lang>/communityInsights.json`); final wording is a UX and lawyer review (O3).

**pt-BR**

> **Comparações com outros bebês**
>
> Você pode deixar que alguns registros da {name} sejam usados, junto com os de muitos outros bebês, para calcular
> estatísticas por idade: quanto leite bebês dessa idade costumam tomar, como o crescimento se compara, tempo de
> bruços, rotinas de sono e alimentação, o que mais ajuda no choro.
>
> - Só usamos idade em semanas, quantidades, durações, contagens e medidas. Nunca nomes, data de nascimento,
>   anotações, fotos, localização nem horários exatos.
> - Só publicamos números de grupos com pelo menos 20 bebês de famílias diferentes. Nenhum registro da {name} sai da
>   conta de vocês, e nada é vendido nem usado para publicidade.
> - É opcional. Sem isso, o app funciona igual. Você pode desativar quando quiser: os registros da {name} deixam de
>   ser usados no próximo cálculo. Números de grupo já calculados não têm como ser separados, e são substituídos.
>
> [ ] Sou o pai, a mãe ou o responsável legal da {name}.
> [ ] Concordo que os registros da {name} sejam usados para essas estatísticas, como descrito na
>     [política de privacidade](/privacy#privacy-community-insights).
>
> **Ativar para a {name}** · Agora não

**en**

> **Community insights**
>
> You can let some of {name}'s records be used, together with those of many other babies, to calculate statistics by
> age: how much milk babies this age usually drink, how growth compares, tummy time, sleep and feeding routines, what
> helps most with crying.
>
> - We only use age in weeks, amounts, lengths, counts and measurements. Never names, date of birth, notes, photos,
>   location or exact times.
> - We only publish numbers for groups of at least 20 babies from different families. None of {name}'s records leave
>   your account, and nothing is sold or used for advertising.
> - It is optional. Without it, the app works the same. You can turn it off at any time: {name}'s records stop being
>   used from the next calculation. Group numbers already calculated cannot be separated out, and are replaced.
>
> [ ] I am {name}'s parent or legal guardian.
> [ ] I agree that {name}'s records are used for these statistics, as described in the
>     [privacy policy](/privacy#privacy-community-insights).
>
> **Turn on for {name}** · Not now

The off screen: "Community insights are on for {name} since {date} (turned on by {who})." + "Turn off" (no
confirmation dialog beyond one tap and an Undo snackbar; withdrawal must be as easy as consent).

## 4. Data minimisation, per use case

Every statistic is defined in a published catalog (`code/api/data/community-statistics.json`, schema 2: `key`,
`description`, `inputs` (for a statistic in v1, exactly what the core reads), `band`, `outputs` (each `{name, tier}` with
tier `A`, `B` or `notInV1`), `k`, `kTails`, `epsilon` (per statistic per release, `null` when no output is in v1), `capPerBaby`, `clip`, `notInV1`,
`notInV1Reason`; the band grids, with the cry age bands on fixed week edges 0-6, 6-13, 13-26 and 26-104), the "published
list" the policy promises. Inputs are derived per baby per day in memory; nothing else is read.

| Use case | Exact inputs (per opted-in baby) | Output per age band | Value over published norms |
| --- | --- | --- | --- |
| Milk per feed (`bottle_ml_per_feed`) | age in completed weeks at the feed; `drunk` ml of each live bottle (docs/SPEC "Feeding amounts"), split by `bottle_feeding_type` (formula / breast milk; never the formula's name or brand); bottles per local day | p10, p25, median, p75, p90 of ml per feed; median bottles per day | **high**: norms are formula-only, 4-8 week bands, no breast-milk-bottle norm, first week flagged (28 section 15.3); pooled gives weekly Brazilian bands for both kinds |
| Growth (`growth_vs_age`) | age in completed weeks at the measurement; weight (kg), length (cm), head (cm) | median and p3/p15/p85/p97 per week | **low for healthy term babies**: the WHO Child Growth Standards (also the Caderneta da Criança curves) are a prescriptive standard from a large, controlled sample, sex-specific; a pooled app sample is self-selected, self-measured (home scales), unsexed (Lotties has no sex field) and can only describe "babies in this app", not how a baby should grow. **Do not replace WHO curves.** Pooled growth adds value only for (a) preterm babies by corrected age beyond what Intergrowth/Fenton cover, (b) measurement cadence context ("most families weigh every 2 weeks at this age"), (c) self-reported home measurement error. Recommendation: ship WHO curves first (docs/design/04 section 5); do not build pooled growth in v1 (O6) |
| Tummy time (`tummy_minutes_per_day`) | age in weeks; effective minutes of `tummy_time` per local day with at least one entry, and the share of days with any | median, p25, p75 minutes; share of days with tummy time | **high**: no published per-age norm in `age-norms.json` (guidance is "work up to ~1 h/day", not a distribution) |
| Routines (`naps_per_day`, `day_sleep_minutes`, `night_sleep_minutes`, `feeds_per_day`, `diapers_per_day`) | age in weeks; per complete local day (a day that is over and has at least one sleep and one feed logged; days split as in the clinical summary): counts and effective durations | median, p10..p90 | **medium**: published sleep norms exist (Pelotas at 3/12/24 months, Galland) but are coarse; feeds/diapers per day by week are thin |
| Unusual patterns (`routine_shift_scale`) | the same per-day values; per baby, the change of the 7-day median versus her own previous 21-day median, as a ratio | per band and metric, the p90 and p97 of that ratio across babies | **high**: today any "changed a lot" line needs a guessed threshold; the pooled distribution of *self-relative* shifts calibrates it. Output is a scale, never a label: the app only says "a bigger change than most weeks" ("uma mudança maior do que na maioria das semanas") |
| Crying (`cry_outcome_by_cause`) | age band of docs/design/27 (`cryAgeBand`); per answered `fussy` spell: `what_helped` mapped to a cause (27 section 5), `suggested_cause`, part of day (morning 06-12, afternoon 12-18, evening 18-24, night 00-06 local), duration bucket (<10, 10-30, 30-60, >60 min) | per band and part of day: share of spells where each cause helped; share where the suggested cause equals the helping cause | **medium-high**: `CRY_WEIGHTS` are generic heuristics (27 section 4); pooled outcome shares are the first evidence to tune them. Gate: section 9. **Since 2026-11-27** (section 5.1.1): only the share each cause helped, per cry age band (no part of day, no suggested cause, no duration bucket read) |

Which of these outputs v1 may publish, and at which epsilon, is the O2 decision of section 5.1: percentile outputs
are not in v1; crying shares are in the strict tier; the tummy-time share of days is in the relaxed tier.

Never read by the job: names, birth date (the job computes age in weeks and drops the date), event timestamps beyond
the local day and part of day, notes, custom field text, custom event types, medications, prescriptions, vaccines,
symptoms, temperatures, appointments, care providers, members, doctor data, push and assistant data, the account.

Open data questions: gestational age (`gestationalAgeWeeks` exists in the baby profile for vaccines) would allow
corrected age for preterm babies; using it is a new input and needs the policy row and the consent text to say so
(O7; proposal: exclude babies born before 37 weeks from v1 bands rather than read the field).

## 5. Aggregation pipeline

- **Where**: a background job in the API process (`Lotties.Application/CommunityInsights/AggregationJob`, a hosted
  service like `NotificationHousekeeping`), quarterly since the owner decision of 2026-11-27 (section 5.1.1; first
  proposed weekly, Sunday 03:30 server time), behind `CommunityInsights:Enabled`
  (default `false`; also off in the home lab kit until activation). Read-only connection; it reads opted-in babies'
  events through the same repositories, computes in memory, and writes only the published file and one run row.
  **No staging table of per-baby values** (no copy; withdrawal and deletion are effective by construction).
- **Population**: babies whose latest consent row is `granted` with the current text version, not soft-deleted, with
  at least one Owner/Parent still a member; events live (not soft-deleted), complete days only. Babies whose records are
  on the family's own database are excluded (docs/design/47-bring-your-own-database.md), fail closed: a baby counts only
  when she points at the built-in store and no move between stores is copying, verifying or in its undo window
  (`CommunityPopulation.SnapshotAsync`, shared by every community run).
- **Bands**: age in completed weeks; weekly bands for weeks 0-12, then 2-week bands to week 26, then 4-week bands to
  week 104. The catalog fixes, per statistic, this fine grid and one coarser fallback grid (4-week bands, then
  12-week bands): a fine cell below k is published only as part of its fixed coarse cell when that one reaches k.
  Band edges never move with the data (data-driven edges leak who is in a band).
- **Per-family contribution cap** (bounds a heavy-logging family and sets the sensitivity for noise): a "family" is
  the set of babies sharing an Owner (twins count as one family for k, two babies for values). Per statistic and band,
  each baby contributes at most `capPerBaby` values (e.g. 14 days, sampled deterministically by a keyed hash of baby id
  and day, so reruns are stable), and values are **clipped** to a published range (e.g. bottles 0-400 ml, night sleep
  0-16 h) before aggregation. Each baby contributes one summary (its own median for the band) to percentiles,
  so a family logging 30 bottles a day weighs the same as one logging 5.
- **k (minimum group size)**: a cell is published only when it has at least **k = 20 distinct babies from at least
  20 distinct families** (proposal; O1). Below k the cell is **suppressed** (absent from the file; the app falls back
  to the published norm or its built-in default). Also suppressed: a cell where one family contributes more than
  25 % of the values after capping (dominance rule), and complementary suppression so that a suppressed cell cannot be
  recovered from a published total minus the other cells (no totals across bands are published). Since 2026-11-27 the
  minimum is the same in every release, with no hysteresis (section 5.1.1).
- **Noise (differential privacy, O2 decided by the owner on 2026-11-11, see 5.1)**: with the per-baby cap the
  sensitivity of a clipped median is bounded; the mechanisms are the Laplace mechanism on counts and shares, and a DP
  median over a fixed grid (the exponential mechanism, e.g. 10 ml steps). Every release spends budget and overlapping
  releases compose, which is why publication is **not nightly** (weekly in the first proposal, quarterly since
  2026-11-27, section 5.1.1). DP here is defence in depth against
  differencing between releases, not the main protection (that is k, caps, clipping, dominance and suppression). The
  owner chose two epsilon tiers and kept percentile statistics out of v1 (section 5.1); the final values go into the
  policy at activation (section 12). The earlier proposal (epsilon 0.2 for every statistic weekly, or 0.5 monthly) is
  replaced by that decision.
- **No repeated queries**: there is **no query endpoint**. The output is a static file with fixed cells; nobody can ask
  for "babies of week 14 born in Recife who drink formula X". No filters by place, formula brand, time zone or any
  attribute beyond the catalog dimensions (age band, feeding kind for bottles; crying has no part-of-day dimension since
  2026-11-27).
- **Outliers**: clipping (published ranges) plus per-baby summaries before percentiles; percentiles outside p10-p90
  are only published when the cell has at least 50 babies (p3/p97 need more data to be stable and safe).
- **Run log**: one row per run (`community_runs`: started, finished, catalog version, cells published, cells
  suppressed, babies included count rounded to 10, epsilon spent per statistic); no baby ids.

### 5.1 Noise tiers per statistic (O2, decided 2026-11-11)

Owner decision of 2026-11-11 ("A plus B"), taken on the synthetic study (docs/ml/COMMUNITY-SYNTHETIC.md, code
`ml/benchmark/community.py`, seed 1). It is **not yet reviewed by the privacy lawyer**: the relaxed tier needs that
review before activation (section 12).

- **Tier A, strict: epsilon 0.2 per statistic per weekly release.** Only for statistics shown to survive that noise.
  Evidence: the crying cause shares (Laplace on one vector) had a share error of 4.8 points at epsilon 0.2 against 1.7
  exact and 8.0 for the uniform baseline (10 000 babies, 20 % opt-in); in the sweep on that instance the error was 2.9
  points at 0.2, 1.8 at 0.5 and 1.7 from 1.0 up. By basic composition a baby spends about 10 per statistic per year
  (52 weekly releases x 0.2).
- **Tier B, relaxed: epsilon about 5 per statistic per weekly release**, for the remaining statistics that are not
  percentiles. **The formal guarantee is weak and is stated as such**: by basic composition a baby spends about 260 per
  statistic per year (52 x 5), and the study's bound on the withdrawal advantage, tanh(epsilon / 2), is about 0.99 at
  epsilon 5 (computed from the study's formula; the study itself measured only epsilon 0.2), which is close to no
  formal bound against differencing. At this level the protection is k, caps, clipping, dominance, suppression and
  hysteresis; the noise only blurs small differences. The privacy lawyer must review this tier before activation.
- **Not in v1: percentile statistics** (medians, p10-p90 bands, p3/p97 and ratio percentiles), deferred. Evidence: at
  epsilon 0.2, split over 5 or 7 percentiles, the exponential mechanism over a 10 ml or 10 minute grid is close to
  uniform in cells of 20-99 babies; the pooled median was off by 54-76 ml for bottles, 50-60 minutes of tummy time and
  70-180 minutes of night sleep, and the cold-start MAE was worse than the published-norms prior everywhere (bottles
  +14 to +55 ml, night sleep +23 to +173 min, naps +0.2 to +1.8, all CIs above zero). The sweep (10 000 babies, 20 %
  opt-in) reached the exact error only around epsilon 5-10 (bottles 6.0 ml at 5 and 5.1 at 10 against 5.1 exact;
  night sleep 9.0 and 8.3 min against 7.5; tummy time 1.2 and 1.1 min against 1.0). Publishing them would need a new
  owner decision and a new study run.

| Statistic (section 4 key) | Outputs | Tier | Basis |
| --- | --- | --- | --- |
| `bottle_ml_per_feed` | p10, p25, p50, p75, p90 of ml per feed; median bottles per day | **not in v1** (all outputs are percentiles) | study: 54-76 ml median error at 0.2 |
| `growth_vs_age` | p3, p15, p50, p85, p97 | **not in v1** (O6, unchanged; also percentiles) | O6 |
| `tummy_minutes_per_day` | p25, p50, p75 minutes | **not in v1** (percentiles) | study: 50-60 min median error at 0.2 |
| `tummy_minutes_per_day` | share of days with tummy time | **B, relaxed (about 5)** | a share, not a percentile; not simulated by the study, so not shown to survive 0.2 |
| `naps_per_day`, `day_sleep_minutes`, `night_sleep_minutes`, `feeds_per_day`, `diapers_per_day` | p10..p90 | **not in v1** (percentiles) | study (naps, night sleep): cold-start MAE worse than the prior at 0.2; day sleep, feeds and diapers were not simulated, same mechanism |
| `routine_shift_scale` | p90, p97 of the shift ratio | **not in v1** (percentiles) | not simulated; same mechanism |
| `cry_outcome_by_cause` | share of spells each cause helped; share where the suggested cause helped | **A, strict (0.2)** | study: 4.8 points at 0.2 against 8.0 uniform; the second share was not simulated and is checked in the next study run before it is served |

Consequences, stated as facts of the decision: in v1 only crying shares (tier A) and the tummy-time share of days
(tier B) remain as candidates, each still subject to the promotion rule and the pilot (section 9). The catalog
`code/api/data/community-statistics.json` (schema 2) carries the decision as amended on 2026-11-27 (section 5.1.1): every
output has a tier (`A`, `B` or `notInV1`), `cry_outcome_by_cause` has epsilon 0.2 with its one v1 output (the share each
cause helped) in tier A, `tummy_minutes_per_day` has epsilon 5 with its share of days in tier B and p25/p50/p75
`notInV1`, and every other statistic is `notInV1` with epsilon `null`. The validator (`CommunityStatisticsValidator`)
pins it: every percentile output `notInV1` (O2; no quantile mechanism is built), growth `notInV1` (O6), each other output
exactly in its decided tier (`DecidedTiers`) and only when the core has a mechanism for it, one tier per statistic, tier A
epsilon in (0, 1], tier B in (1, 5], the release `quarterly`, and for a statistic in v1 inputs that are exactly what the
core reads.

### 5.1.1 Owner decisions of 2026-11-27

Decided by the owner on 2026-11-27, after a review of the aggregation core and a quick simulation of the crying output
as it was then (epsilon 0.1 per output after the split over two outputs, four parts of day: about 19 points of error per
cause at 100 babies per band, against 8 for a uniform guess). **No lawyer has reviewed these decisions, nor the tiers of
5.1, nor the study they rest on.**

1. **Minimum group size: always 20 babies from 20 families, in every release.** No hysteresis (the earlier proposal kept
   a published cell down to 18, O1; the consent screen promises at least 20). Built: neither the catalog nor the release
   format has a `kHysteresis`, and the remainder of a coarse cell after its published fine cells (complementary
   suppression) is held to the same 20, so dropping hysteresis only made that rule stricter.
2. **Crying: one output.** The share of spells each cause helped, per cry age band, with no part-of-day dimension;
   `share_suggested_equals_helped` is out of v1; tier A, epsilon 0.2 per release on that one output. The catalog lists
   only what is read for it: age in completed weeks, the local day (the per-baby cap picks days) and the cause that
   helped; part of day, the suggested cause and the duration bucket are no longer inputs. Built. A quick simulation of
   the built mechanism in this change (per-baby share vectors, seed 1) gives about 17 points of error per cause at 20
   babies per band, 9 at 50, 5 at 100 and 2 at 300, against about 7 for a uniform guess: below about 70 babies per band
   the published shares are worse than a uniform guess. Section 9's gate still decides whether they are served.
3. **Bottle and sleep percentiles in v1: option A of the percentiles study, bounded** (docs/ml/COMMUNITY-SYNTHETIC.md,
   follow-ups of 2026-11-26 and 2026-11-27; code `ml/benchmark/community_percentiles.py` and
   `community_percentiles_built.py`) for `bottle_ml_per_feed` (formula bottles only: breast milk was not studied and is not
   read), `night_sleep_minutes`, `naps_per_day` and `day_sleep_minutes`. `feeds_per_day`, `diapers_per_day`,
   `bottles_per_day_p50`, growth and `routine_shift_scale` stay not in v1 (not studied or not decided). The study spent
   epsilon 2 per cell with no bound on the cells one baby is in; the owner then chose the bound (2026-11-27): **each release
   of a percentile statistic reads only the last 3 months, and one baby is in at most 4 cells of a statistic; epsilon 2 per
   cell, so at most 8 per baby per statistic per release** (a real ceiling, still a weak formal guarantee, and cells take
   longer to reach 20). The coordinator's defaults: formula bottles only, 4-week age bands, p25, p50 and p75 only, the
   study's clipping ranges and bins (naps 0-8), a cell whose noisy total is 0 or less publishes nothing, the snapping
   sampler. Built (tier C of the catalog), by construction:
   - **Window**: a release generated in calendar quarter Q (UTC) reads only the local days of quarter Q - 1, compared as
     dates (`CommunityDataWindow.PreviousQuarterOf`). A local date belongs to exactly one quarter, so two releases never
     read the same day; a late release still reads only Q - 1, and a skipped quarter's days are never read later. A release
     is not due in the first day of its quarter (`CommunityReleaseCadence.ReleaseGrace`), so the last local day of Q - 1
     has ended in every time zone. Only the percentile statistics are windowed.
   - **4 cells per baby**: after the 14-day cap per band, a baby with data in more than 4 cells of the statistic keeps the
     4 with the most capped days, ties by HMAC(key, baby id, cell) (`CommunityCellBound`), decided from her own data only
     and before any k or dominance decision. With a 92-day window and 4-week bands she touches at most 5 bands, and there is
     no dimension (formula only) and no coarse fallback (one 4-week grid, `age_weeks_4`), so every cell the mechanism spends
     budget on is one of her at most 4.
   - **Mechanism** (`CommunityHistogramMechanism`): per cell one summary per baby (her median), a uniform half-step jitter,
     clipping, the study's fixed bins (20 ml, 30 min, 0.5 nap, offset by half a step), snapped Laplace of scale 1/2 on every
     bin (L1 sensitivity 1 per cell), the isotonic read-out of p25, p50 and p75, rounded to 10 ml, 10 min or half a nap.
     The C# tests reproduce the study's bins, binning and read-out exactly on vectors it wrote
     (`ml/tests/community_histogram_vectors.json`) and its noisy-median error on a synthetic cell.
   - **What it gives** (built configuration measured in docs/ml/COMMUNITY-SYNTHETIC.md, seed 1): median error at 20 babies
     9.2 ml (1 cell in 10 over 19 ml), 19.0 min of night sleep (39), 13.5 min of day sleep, 0.1 nap; at 50 babies 5.3 ml,
     10.2 min, 7.6 min; the p25-p75 holds 49-51 % of babies (naps 75 %: whole numbers). This is what the owner was shown
     (about 9 ml and 19 min at 20 babies), not materially worse. A 4-week band reaches 20 babies from 20 families for most
     sleep bands at about 300 babies logging in a quarter (71 % of first-year bands), and for formula bottles at about 600
     (83 %), on the generator's ages (uniform over two years; real users are younger).
   - **The formal guarantee of epsilon 2 is weak**: per cell and release no attacker can tell whether a baby is in with an
     advantage above tanh(1), about 0.76 (from even odds, a posterior of at most 88 %); per baby and release (at most 4
     cells, epsilon 8) the bound is about 0.9993, i.e. none. It must be described as blurring the effect of any one family,
     never as a strong mathematical protection. Measured on a synthetic 20-baby cell, the strongest attacker's advantage on
     one published quartile is 0.10-0.20.
   - **Per-year budget figures must count that a baby is in several cells.** The study found that a baby is in several
     published cells of a statistic in every release, so basic composition gives epsilon x cells x releases. For the
     percentile statistics as built that is at most 2 x 4 x 4 = 32 per baby per statistic per year (128 over the four),
     and because the windows do not overlap, each day of a baby is read by one release only; a baby who logs for one quarter
     spends at most 8 per statistic in total. The yearly figures of 5.1 ("about 10", "about 260") counted releases only;
     for a mechanism that spends epsilon per cell they undercount (with 3 fine cells per baby they would be about 31 and
     780 at a weekly pace). The share statistics as built spend the statistic's epsilon once per release whatever cells a
     baby is in (her weights add up to 1, section 5.2), but they are not windowed: every quarterly release re-reads her
     whole history, so her days compose across releases, epsilon x releases: 0.8 for crying and 20 for tummy time per baby
     per year, the latter with no meaningful formal bound.4. **Quarterly releases** of the whole file, never weekly, because every release spends budget. Built: the job checks
   every hour but publishes at most one release with statistics per calendar quarter (UTC), decided from the latest
   stored release (`CommunityReleaseCadence`): a placeholder does not count against the quarter (and is written at most
   once per quarter), a row that cannot be read counts, a latest release from a later quarter blocks (a clock behind),
   and the job lease `community-aggregation` keeps a second instance out; the check is repeated under the lease and the
   lease is renewed before the write. No setting changes the cadence: `CommunityAggregation:RunDayOfWeek` and
   `RunHourUtc` are no longer read (`IntervalHours` never was); `Enabled` stays.
5. Event loading is still not part of this work: the job reads no events and writes a placeholder.

| Statistic | v1 outputs (2026-11-27) | Epsilon | State |
| --- | --- | --- | --- |
| `cry_outcome_by_cause` | share of spells each cause helped, per cry age band | A: 0.2 per release, one output | built (core), not wired |
| `tummy_minutes_per_day` | share of days with tummy time | B: 5 per release | built (core), not wired |
| `bottle_ml_per_feed` (formula), `night_sleep_minutes`, `naps_per_day`, `day_sleep_minutes` | p25, p50, p75 per 4-week band, previous quarter only | C: 2 per cell, at most 4 cells, 8 per release | built (core), not wired |
| `feeds_per_day`, `diapers_per_day`, `bottles_per_day_p50`, `growth_vs_age`, `routine_shift_scale` | none | none | not in v1 |

### 5.2 The aggregation core as built (pure Domain, not wired)

`Lotties.Domain/CommunityInsights/CommunityStatisticsAggregator.Aggregate(input, noise)` computes a release from in-memory
observations; it does no I/O and the job does not call it yet (it reads no events). What it does, per statistic
with an output in v1:

- **Inputs** (`CommunityAggregationInput`): the validated catalog, the generation time, a secret cap key
  (`CommunityCapKey`, HMAC-SHA256, at least 32 bytes, stable between runs), and per opted-in, eligible baby: one
  `CommunityTummyTimeDay` per complete local day (age in completed weeks, the day, tummy minutes, 0 when none) and one
  `CommunityCrySpell` per answered fussy spell (age in completed weeks, the day, the cause that helped as mapped by design
  27 section 5; nothing else of the spell), one `CommunityBottleFeed` per live bottle (age, day, bottle kind, millilitres
  drunk; only formula is read) and one `CommunityRoutineDay` per complete local day (age, day, night sleep minutes, naps,
  day sleep minutes, each null when not logged). Ids serve only to count distinct babies and families and to pick capped
  days and cells.
  An age outside the grid or an unknown cause is not read; tummy minutes are clipped to the catalog range. The cry age
  bands are on the catalog's fixed week edges, so every cell is a band in weeks. Each sampler declares the catalog inputs
  it reads, and the validator requires a statistic in v1 to list exactly those.
- **Cap**: per baby and fine band, the observations of at most `capPerBaby` days, the days with the lowest
  HMAC(key, baby id, day) (`CommunityDailyCap`): deterministic, independent of input order.
- **One summary per baby**: each baby's capped observations of one output weigh 1 / their number, so they add up to 1
  over all her cells (a baby across two bands weighs 1 in total; a heavy-logging family weighs as much as a light one).
- **Noise** (`CommunityShareMechanism`): for every cell of the fixed grid (fine bands x dimension values) and every
  component, the sum of the weights. Adding or removing one baby moves the vector of all sums of one output by at most 1
  (L1), so Laplace noise of scale 1 / epsilon on every sum makes the output epsilon-DP. The statistic's epsilon is split
  evenly over its v1 outputs, so one baby spends at most the statistic's epsilon per release whatever cells she is in
  (crying: 0.2 on its one output; tummy time: 5 on its one output). The sampler is Mironov's snapping mechanism
  (`CommunityLaplace`, `SnappedLaplaceNoise`): a uniform draw on (0, 1) with the full double distribution (never 0), the
  input clamped to [-2^20, 2^20], the noisy sum rounded to the smallest power of two at least the scale and clamped again
  (the floating-point attack on naive Laplace; cost a negligible addition to epsilon); randomness from the operating
  system's cryptographic generator, a seeded source only in tests. A coarse cell's sums are the sum of its fine cells'
  noisy sums (post-processing, no extra budget). Shares are clamped at 0, renormalised and rounded to 0.001; a cell whose
  noisy sums are all 0 or less has no value. The noise draws follow the fixed grid, never the data.
- **Publication** (`CommunityPublication`): a fine cell is published when it has at least k (20) distinct babies from at
  least k distinct families, in every release (no hysteresis, section 5.1.1), and no family holds more than 25 % of its
  weight (dominance, measured on the weight each family has in the output). A coarse cell is a
  fallback only when one of its fine cells is not published: it must meet the same rule, and so must the coarse cell
  minus its published fine cells (complementary suppression); when that remainder is too small, the published fine cells
  with the fewest babies are withdrawn into it one by one; when even the whole coarse cell fails, there is no coarse
  cell and the fine cells stay. An empty remainder is not exempt (so the pattern does not tell 0 from a few babies). The
  cry grid has no coarse grid. Each output of a cell has its own population.
- **Percentile statistics** (tier C, section 5.1.1 item 3): their samples are first limited to the previous calendar
  quarter, and after the cap each baby keeps at most 4 cells; their one release unit (the three quartiles) runs
  `CommunityHistogramMechanism` with epsilon 2 per cell. **Not computed**: any other percentile. The publication decisions
  use exact counts and are not themselves differentially private (as in the synthetic study); a family of several babies
  spends the budget once per baby.
- **Output**: a `CommunityRelease` (section 6) and a run summary (cells published, coarse cells published, fine cells with
  data not published, babies included rounded to 10).

The two mechanisms share one contract (`ICommunityOutputMechanism`): epsilon-DP for one baby over all cells of one release
unit, cells and draws on the fixed grid. The histogram meets it with epsilon per cell = the unit's epsilon / 4 because the
core has already kept every baby in at most 4 cells.

## 6. What is published back

- **Release format as built** (`CommunityReleaseJson`, the one writer and reader; schema 1; stored in
  `community_statistics_releases.statistics_json`):
  `{schemaVersion: 1, generatedAt, catalogVersion, placeholder, statistics: [{key, k, epsilon}],
  cells: [{statistic, band {fromWeeks, toWeeks}, dimension?, outputs {name: value}, babies: "20-49" | "50-99" | "100+"}]}`.
  `outputs` is a set of named values: a share vector is one value per component (`share_helped_by_cause.hunger`, ...,
  `share_helped_by_cause.none`), a scalar share is named after its output (`share_of_days_with_any`), and a percentile cell
  has `p25`, `p50`, `p75`. `dimension` is absent when the
  statistic has none. Cells below the thresholds are absent (never present with a reason); no exact count, id or day is in
  the file; every published cell has at least 20 babies. Reading is strict (an unknown or
  missing property, a duplicate cell, a share outside [0, 1], an unknown bucket, a placeholder with cells is a format
  error). **No cells and placeholders**: a release with no cells means nothing passed the thresholds, and every caller falls
  back to the published norms or its built-in default, as for any absent cell. Until event loading is built the job writes
  a placeholder (`placeholder: true`, no statistics, no cells), read the same way, which does not count against the
  quarter (section 5.1.1). A release that cannot be read (the phase-1 placeholder rows written before this format, a damaged row) is
  treated as a release with no cells. Today `GET /community/statistics/{statisticKey}` reads this format and answers the
  single value of the caller's baby's fine cell, or else its coarse fallback, only for a statistic without a dimension;
  serving the whole file as below is task T6.
- `GET /api/v1/community/statistics` (any signed-in user, like `GET /age-norms`): the current file (the release format
  above; exact counts are not published), strong ETag
  `"community-{generatedAt}-{hash8}"`, `Cache-Control: private, max-age=86400`, 304 on `If-None-Match`; served even to
  babies that did not opt in (O10: give-to-get or open to all; recommendation: open to all signed-in users, since the
  output is aggregate and the benefit should not pressure consent).
- Web: Dexie table `communityStatistics` (one row, like `ageNorms`), `useCommunityStatistics()`; each caller uses a
  pooled cell when it exists and passes its gate (section 9), else `priorFor` of the age norms, else its built-in
  default. Offline: the last copy.
- Wording in the app (all through `t()`, never judgement): "Babies this age in Lotties usually drink 120-170 ml per
  bottle" / "Bebês dessa idade no Lotties costumam tomar 120-170 ml por mamadeira"; tummy time "Most babies this age
  get 10-30 minutes a day" / "A maioria dos bebês dessa idade faz de 10 a 30 minutos por dia"; always with "From
  families who chose to share, not advice" / "De famílias que escolheram compartilhar, não é orientação" and a link to
  the published list. Never "too little", "too much", "behind", "normal", colours or targets; the baby's own number is
  shown next to the range, not placed on it as a score.
- Self-hosted instances: the same code; with fewer than k families every cell is suppressed and the app silently uses
  the published norms. Pooling across instances is out of scope (it would be a transfer to a third party).

## 7. Security and governance

- Access: the job runs inside the API with a read-only database role (`lotties_insights_ro`: `SELECT` on the event,
  baby, membership and consent tables only) and write access to `community_runs` and the file; no human runs ad-hoc
  pooled queries; the maintainer's admin access to the database is unchanged (audit C4) and is the residual risk.
- Code: aggregation code and catalog in the open repository; a change of the catalog or of k/epsilon is a reviewed
  commit with a policy check (CLAUDE.md privacy rule) and, for a new input, a consent text version bump.
- Audit: `community_runs` plus the git history of the catalog; the published file states its parameters.
- Retention: consent rows (section 3.2); run rows 2 years; published files: current and previous only.
- Incidents: the LGPD art. 48 process of the policy; a suspected re-identification (e.g. a cell that turns out to
  describe one family) stops publication (`CommunityInsights:Enabled=false`), replaces the file with an empty one and
  is assessed as an incident.
- Kill switch: setting the flag off deletes the published file at the next start and stops the job; consents are kept
  (so it can resume) unless the owner decides to end the feature, in which case consents are closed with a notice.

## 8. LGPD requirements

- **Legal basis**: consent, art. 11, I (health data, sensitive) and art. 14, §1 (a child's data: specific and
  highlighted consent of at least one parent or legal guardian). Not legitimate interest (never for sensitive data),
  not "research" (art. 11, II, c needs a research body). The terms or the policy are not a consent; the opt-in screen
  is. Art. 8: consent in writing or another means that shows the will; §4 consent for determined purposes (the
  catalog); §5 revocable at any time by a free and facilitated procedure; art. 9 information (purposes, form,
  duration, controller, sharing, rights) is in the screen + policy section.
- **Art. 14 best interest of the child**: the benefit is better context for the family's care decisions; the risks are
  re-identification and exposure of a child's health data. Mitigations: minimisation, k, caps, DP, no query, no
  recipients, no profiling. The child cannot consent; the parent consents for her; data of the child is never used to
  decide anything about her or her family (art. 20 does not apply because no automated decision affects the subject).
- **Art. 12 anonymised data**: anonymised data is outside the LGPD only if the anonymisation cannot be reversed "using
  reasonable technical means available at the time". Risk analysis for our output:
  - Small groups: in a band with few families, a percentile can equal one baby's value; a family that knows another
    family is in the app (a sibling group, a parents' chat) may infer something. Mitigation: k = 20 families, the
    dominance rule, no exact counts, p3/p97 only at 50+.
  - Differencing: two releases a week apart differ by the babies who entered or left a band; with weekly bands and
    many babies the difference is noise-level, but with DP off, a single withdrawal in a band near k could in theory
    be detected (the synthetic study measured a withdrawal advantage of 1.00 without noise and within about 0.07 of
    zero at epsilon 0.2). Mitigation: DP in two tiers (O2, section 5.1: strict 0.2, or relaxed about 5 with a weak
    formal guarantee), percentile statistics kept out of v1; k margin (publish at 20, suppress at 18 once published,
    hysteresis, so a band does not flip on one baby; hysteresis removed by the owner on 2026-11-27, section 5.1.1).
  - Auxiliary knowledge: an attacker who knows a baby's age and that she is in the pool learns only band statistics,
    not the baby's own values.
  - Conclusion to bring to the lawyer: **treat the published statistics as aggregated data whose anonymity is
    strong but not absolute**; do not rely on art. 12 to process the inputs (the inputs are personal and sensitive and
    are processed under consent); the policy says exactly that.
- **Data subject rights** (art. 18): confirmation and access (the consent state and history are shown in the app and
  in the export; the published file is public to users), correction (correcting a record corrects the next run),
  elimination (withdrawal, deletion), information about sharing (none), revocation (one tap). Response time art. 19.
- **International transfer**: none. Computed and stored on the home lab servers; no processor; the published file is
  served by the same API. (If a CDN or Cloudflare proxying is ever used, audit C2, the file would pass through it: it
  is aggregate, but say so.)
- **RIPD** (relatório de impacto à proteção de dados pessoais, art. 5, XVII and art. 38; ANPD may request it;
  recommended before activation because the processing is of sensitive data of children). Outline:
  1. Identification: controller, encarregado, date, version.
  2. Need and proportionality: purposes (the catalog), why pooled data instead of published norms (section 4
     "Value"), why each input is necessary, why no less invasive means suffices (evaluation results, section 9).
  3. Description: data categories, data subjects (children; parents as consenters), volume, flow diagram (section 5),
     retention, access.
  4. Legal basis and consent mechanics (section 3), best interest of the child (art. 14).
  5. Risk assessment: re-identification (small cells, differencing, auxiliary data), insider access, function creep
     (new statistics, research requests), consent quality (bundling, pressure, the guardian check), security
     incidents; likelihood and impact for each.
  6. Measures: minimisation, k, dominance, suppression, caps, clipping, DP and its budget, no query, read-only role,
     open code, published catalog, kill switch, incident process.
  7. Residual risk and decision (go / no-go), sign-off by the controller, review date (yearly, with the age norms and
     vaccine schedule reviews).

## 9. Evaluation (before any pooled number reaches the app)

1. **Synthetic cohorts** in `ml/` (no child data): extend `benchmark/synthetic.py` with a cohort generator per use case
   (bottle amounts by week with between-baby variation from MILQ/SBP ranges, tummy minutes, routines from Pelotas
   medians as in 28 section 15.4, crying outcomes from a known ground truth). `python -m benchmark.community --k 20
   --epsilon 0.2` simulates opt-in rates (5 %, 20 %, 50 %) and instance sizes (100, 1 000, 10 000 babies), runs the
   exact pipeline (caps, clipping, k, suppression, DP), and measures:
   - coverage (share of bands published) per instance size;
   - error of the pooled median versus the cohort truth, and versus the published-norms prior;
   - for priors: MAE of the cold-start prediction (first 14 days) with pooled prior vs published-norms prior, 95 %
     bootstrap CI over babies, like docs/design/28 section 15.4;
   - calibration: share of held-out babies' values inside the published p10-p90 (target 80 % ± 5);
   - privacy: membership-inference advantage of an attacker who knows one family's values (should be near 0 with DP;
     report it without DP too).
2. **Promotion rule**: a pooled statistic replaces the published-norms prior only if, on the synthetic study and then
   on the pilot's backtest, it (a) improves the cold-start MAE with a CI above zero on two consecutive windows (the
   same gate as docs/ml/BENCHMARK.md and 27 section 6), and (b) is calibrated (coverage within ± 5 points). Context
   lines (tummy time, routines) need only (b). Crying: the pooled outcome shares replace `CRY_WEIGHTS` for a band only
   if the mean reciprocal rank of the helping cause improves in the backtest.
3. **Pilot**: the owner's family and invited volunteer families on the production instance, flag on, consent screen
   live, publication to an internal-only file (not served to the app) for 8 weeks; then the gate above; then serve.
   Synthetic data cannot prove a real-world gain (28 section 15.4): no promotion on synthetic results alone.

## 10. App store implications

Apple App Privacy and Google Data safety ask what data is used for and whether it is shared. While the feature is
off, **nothing changes** (docs/design/20 section 3 stays as is). On activation: Apple "Health & Fitness" and "Other
Data" add the purpose "App Functionality" (pooled statistics are a function of the app, not analytics or
advertising; no "Product Personalization" unless the owner reads it so, O11); Google Data safety: still "not
shared" (no third party), purpose "App functionality", and the optional nature declared ("users can choose").
docs/design/20 section 3 gets the line "Community insights: optional, off by default, aggregated, own servers" only
when activated (task T9).

## 11. Task breakdown (later build phase; tiers per CLAUDE.md: Opus plans, Sonnet medium-hard, Haiku simple)

| # | Task | Tier | Depends |
| --- | --- | --- | --- |
| T0 | Owner decisions (section 13) and lawyer review of the policy section and the consent text | owner | none |
| T1 | RIPD draft from section 8 outline (docs). **RIPD draft: v0.1 written 2026-11-10, docs/design/34a-community-insights-ripd.md; awaits owner decisions and lawyer review** | Opus | T0 |
| T2 | Consent: Domain `CommunityConsent` (pure rules: who may consent, versioning), EF table `community_consents` + migration, `GET/PUT /babies/{id}/community-consent` (Owner/Parent; Caregiver/Viewer/Doctor 403), rows in `EndpointRoleMatrixTests` with a scope decision (`BabyReadFamily`, never a Doctor scope), export/import of the history, account/baby deletion handling. **Consent plumbing (T2): built 2026-11-11, off by default** (`CommunityInsights:Enabled=false`, every route a bare 404): `Domain/CommunityInsights/CommunityConsent.cs` (`CommunityConsentEntry` append-only line, `CommunityConsentHistory` state `none/on/off/renewal_needed` and `IsInForce`, `CommunityConsentRules.MayDecide` = Owner or Parent, text version `ci-1`), table `community_consents` (migration `CommunityConsents`, control plane), `GET/PUT /babies/{id}/community-consent` with `BabyWrite` (Caregiver, Viewer, Doctor 403; no Doctor scope, she is refused by role), blocked in the demo, `ICommunityConsentRepository.BabiesInForceAsync` for T5, erased with the baby and kept under the stand-in when a member deletes her account, and the web section Settings > Community insights with the section 3.5 text (shown only when the flag is on). Differences: the history is **not** in the baby's backup file (it names accounts; docs/design/24 and CLAUDE.md forbid account ids there; RIPD R11), so section 3.2's "the baby's export includes its consent history" is not done (the history is shown in the app instead); a `locale` column was added; withdrawal has no Undo snackbar (an Undo would record a yes the person did not tick the declaration for); no notice to the other Owners/Parents yet (O4). Nothing is collected, computed or published; the privacy policy, `legal/dataFlows.ts`, the consent versions and the consent screen are unchanged (activation, T9) | Sonnet | T0 |
| T3 | Web consent screen and state in Settings > Baby (`communityInsights.json` en + pt-BR, `baby/permissions.ts` gate, axe light/dark) | Sonnet | T2 |
| T4 | Catalog `community-statistics.json` + validator (like `AgeNormsValidator`), embedded, schema test. **Catalog (T4): built**, catalog only: `code/api/data/community-statistics.json` (schema 1, the 10 use cases of section 4, every entry `planned` with the proposed values of section 13 marked `proposed: true`, `growth_vs_age` `notInV1` per O6, fixed band grids), `Domain/CommunityInsights` (model, strict parser, `CommunityStatisticsValidator`: known keys, k >= 20, inputs from an allow-list and never a "Never read" category, epsilon in (0, 1], status `planned`), embedded in Lotties.Application and validated at startup; nothing served, collected or consented, no table. **O2 tiers (section 5.1): built** in catalog schema 2 (per-output tiers, epsilon per tier, percentile outputs `notInV1`) | Sonnet | T0 |
| T5 | Aggregation job: inputs per use case, caps, clipping, bands, k, dominance, suppression, DP per the tiers of section 5.1 (no percentile output in v1), run log, read-only role, flag; property tests (a cell never below k, a withdrawn baby absent from the next run, a single heavy family bounded). **Pure core built** (section 5.2: cap, clipping, one summary per baby, snapped Laplace on the share vectors, k, hysteresis, dominance, coarse fallback with complementary suppression, release format of section 6, property and sampler tests); **not wired**: event loading, the run log table and the read-only role are still to do, and the job writes a placeholder | Opus plan, Sonnet build | T2, T4 |
| T6 | `GET /community/statistics` with ETag (like `/age-norms`), matrix row | Haiku | T5 |
| T7 | Web cache + `useCommunityStatistics()`, fallback chain pooled > norms > default, the context lines (wording reviewed) | Sonnet | T6 |
| T8 | `ml/benchmark/community.py` synthetic study, then the pilot backtest (section 9). **Synthetic study done** (docs/ml/COMMUNITY-SYNTHETIC.md); **pilot backtest still to do** | Sonnet | T4 |
| T9 | Activation: policy section rewritten from "not active yet" to the final text, `PLANNED_FLOWS` entry moved to an active flow (data category row, status), version/date raised, in-app notice (gap G6), audit section 11 and docs/design/20 updated, store forms | Opus review, Sonnet edit | T1-T8 green |

## 12. Activation checklist (all before the flag goes on in production)

- [ ] Owner decisions O1-O11 taken (O2 taken on 2026-11-11); lawyer reviewed the policy section, the consent text,
      the RIPD and the relaxed epsilon tier of section 5.1.
- [ ] T2-T8 built and green; synthetic study and pilot passed the gate for each statistic that will be served.
- [ ] Policy updated (T9): the section states the final k, the epsilon tiers (and, for the relaxed tier, that its
      formal guarantee is weak), catalog link, consent placement;
      `PRIVACY_POLICY_VERSION` raised; the in-app notice of policy changes (G6) exists and announces it **before** the
      consent screen appears.
- [ ] Audit (docs/design/33 section 11) and store answers (docs/design/20) updated.

## 13. Open decisions for the owner

| # | Decision | Proposal |
| --- | --- | --- |
| O1 | k (minimum distinct babies and families per cell) | 20 babies from 20 families; p3/p97 only at 50+; hysteresis 18. **Decided 2026-11-27**: always 20 babies from 20 families in every release, no hysteresis (section 5.1.1) |
| O2 | Differential privacy on or off; epsilon per statistic and yearly budget | **Decided by the owner, 2026-11-11 ("A plus B"), pending the lawyer's review of tier B** (section 5.1): DP on, weekly release; tier A, epsilon 0.2 per statistic, only for statistics that survive that noise (crying shares; about 10 per statistic per year); tier B, epsilon about 5 for the remaining non-percentile statistics (today the tummy-time share of days), with its weak formal guarantee stated plainly (about 260 per statistic per year by basic composition); percentile statistics not in v1. Earlier proposal (0.2 weekly or 0.5 monthly for every statistic) replaced. **Amended by the owner, 2026-11-27, not reviewed by a lawyer** (section 5.1.1): crying one output (the share each cause helped, no part of day) at 0.2; bottle ml, night sleep, naps and day sleep percentiles in v1 by the study's option A (noisy histogram, epsilon 2 per cell per release, weak formal guarantee; not built, the budget accounting per baby is open); quarterly releases; per-year figures must count the cells a baby is in. **Bound chosen by the owner, 2026-11-27**: a percentile release reads only the previous calendar quarter and one baby is in at most 4 cells of a statistic, epsilon 2 per cell, at most 8 per baby per statistic per release (built as tier C; weak formal guarantee) |
| O3 | Final consent screen wording, and where it lives | section 3.5 text; Settings > Baby; one dismissible card once |
| O4 | One parent's yes, or all Owners/Parents; notice to the others | one yes plus a notice to the others, any of them may withdraw |
| O5 | All-or-nothing or per-purpose consent | all-or-nothing in v1 (simpler to understand), `scopes` kept for later |
| O6 | Pooled growth at all | not in v1; WHO curves first |
| O7 | Gestational age as an input (corrected age) | exclude preterm babies from v1 instead |
| O8 | Retention of consent records after withdrawal or erasure | lawyer; proposal 5 years, baby id hashed after erasure |
| O9 | Doctors see the context lines on shared sections | no, until a separate review |
| O10 | Statistics visible to every signed-in user or only to families that opted in | every signed-in user (no pressure to consent) |
| O11 | Store label purpose (App Functionality only, or also Product Personalization) | App Functionality |
| O12 | Whether the hosted instance's controller (individual or company, checklist section 2) changes anything for a pooled data set (e.g. a company is a better holder of consent records) | decide with the controller question |
