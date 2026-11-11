# 34a. Community insights: RIPD draft (Relatório de Impacto à Proteção de Dados Pessoais)

Working draft, version 0.1, 2026-11-10. Task T1 of docs/design/34-community-insights.md section 11.

> **Nothing described here is active.** Community insights is **planned, not built, and off for everyone**: there is no
> consent table, no aggregation job, no statistics endpoint and no flag in the code (docs/design/33-privacy-audit.md
> section 11, checked there). The privacy policy describes it only as "not active yet". Every measure below is a
> **design** (marked *planned*) unless it says otherwise.
>
> **Not legal advice.** This is a starting point for the owner and a Brazilian lawyer or privacy specialist, written
> from the design (docs/design/34), the audit (docs/design/33) and the owner checklist
> (docs/PRIVACY-OWNER-CHECKLIST.md section 8). It follows the outline of design 34 section 8 ("RIPD"). The likelihood
> and severity ratings are the authors' first estimates, to be revised after the evaluation (design 34 section 9) and
> by the lawyer. Open points are marked **needs lawyer** or **needs owner decision (O#)**, using the decision numbers
> of design 34 section 13.

Related documents: docs/design/34-community-insights.md (design), docs/design/33-privacy-audit.md (facts; section 11
for this flow), docs/PRIVACY-LAWYER-BRIEF.md (questions to the lawyer; items 9 and 20), docs/PRIVACY-OWNER-CHECKLIST.md
(section 2 controller and encarregado, section 8 community insights).

## 1. Identification (Identificação)

| Item | Value |
| --- | --- |
| Processing | "Community insights" / "Comparações com outros bebês": opt-in use of a baby's care records, together with other opted-in babies' records, to compute fixed age-band statistics shown back in the app as context |
| Controller (controlador) | the person or company that runs the hosted Lotties service at `https://lotties.app`. **Needs owner decision (checklist section 2; O12)**: natural person (CPF) or company (CNPJ). Published today as "the Lotties project maintainers" (`VITE_PRIVACY_CONTROLLER_NAME` unset) |
| Operator (operador) | **none planned.** The computation runs inside the Lotties API on the controller's own home lab servers; no processor computes, stores or receives the inputs or the statistics. Infrastructure note: Cloudflare proxies `lotties.app` (confirmed in the lawyer brief section 2; the audit still says "to confirm", C2), so the consent requests and the published statistics file would pass through it in transit like all other traffic. Whether Cloudflare is an operator is already lawyer brief question 4 |
| Encarregado (DPO) | **needs owner decision / needs lawyer** (checklist section 2: whether the small-agent rules allow skipping one given sensitive data of children; `VITE_PRIVACY_DPO` unset) |
| Date and version | draft 0.1, 2026-11-10; to be re-issued before activation and reviewed yearly (section 9) |
| Status | planned, not built, off everywhere; activation needs the checklist of design 34 section 12 |
| Self-hosted instances | out of scope of this report: each self-hoster is its own controller; the feature is off by default there and, with fewer than k families, publishes nothing (design 34 section 6) |

## 2. Description of the processing (Descrição do tratamento)

### 2.1 Purpose (Finalidade)

Give families better context numbers by age than the published norms where those are thin, wide or not Brazilian
(design 34 section 1): milk per bottle, tummy time, routine counts and durations, a calibrated "bigger change than most
weeks" scale for the unusual-pattern note, and which cause most often helped a crying spell. A pooled number is
**context or a prior, never advice**; no diagnosis, no "normal/abnormal", no target, no score (design 34 section 1
non-goals, docs/design/28 section 0).

Explicitly **not** purposes: research data sets, export or sharing of pooled data, sale, advertising, profiling, any
automated decision about a child or a family, per-baby learning (that stays per baby, docs/design/27 section 6),
queries over the pool, comparisons between named babies.

### 2.2 Data categories per use case (Categorias de dados por caso de uso)

All inputs are derived per opted-in baby per local day, **in memory**, from the records the family already keeps
(design 34 section 4). The fixed list is the published catalog `code/api/data/community-statistics.json` (*planned*,
task T4).

| Statistic (catalog key) | Inputs read | Sensitive (art. 5, II)? | In v1? |
| --- | --- | --- | --- |
| Milk per feed (`bottle_ml_per_feed`) | age in completed weeks; ml drunk per live bottle; feeding kind (formula / breast milk, never the formula's name or brand); bottles per local day | yes (health / feeding of a child) | planned |
| Growth (`growth_vs_age`) | age in weeks; weight, length, head circumference | yes | **proposed not in v1** (O6: WHO curves first) |
| Tummy time (`tummy_minutes_per_day`) | age in weeks; effective minutes per local day; share of days with any | yes | planned |
| Routines (`naps_per_day`, `day_sleep_minutes`, `night_sleep_minutes`, `feeds_per_day`, `diapers_per_day`) | age in weeks; per complete local day: counts and effective durations | yes | planned |
| Unusual patterns (`routine_shift_scale`) | the same per-day values; per baby, the ratio of the 7-day median to her own previous 21-day median | yes (derived) | planned |
| Crying (`cry_outcome_by_cause`) | cry age band; per answered fussy spell: cause that helped (mapped), suggested cause, part of day (4 blocks), duration bucket | yes | planned, gated by the evaluation |

**Never read** by the job (design 34 section 4): names or labels, birth date (age in weeks is computed and the date
dropped), timestamps finer than local day / part of day, notes, custom field text, custom event types, medications,
prescriptions, vaccines, symptoms, temperatures, appointments, care providers, members, doctor data, push and
assistant data, the account. Gestational age is **not** read in v1 (O7: proposal is to exclude babies born before 37
weeks instead; how the job would know that without reading the field is itself an open point, section 8).

Also read, for the population only: the consent record (section 3), the baby's membership (at least one Owner/Parent
still a member) and the soft-delete markers.

### 2.3 Data subjects (Titulares)

- **The babies** (children under 12, art. 14): the data is about them.
- **Their parents or legal guardians** who give or withdraw consent: their user id, the action and the time are in
  the consent record (section 3.2 of design 34).
- Not concerned: Caregivers, Viewers and Doctors (they cannot consent and see nothing new; design 34 sections 3.1,
  3.4). Demo accounts and babies stored in the family's own database are excluded (section 8, "inconsistencies").

### 2.4 Sources (Fontes)

Only records the family already entered in Lotties for its own use (feeds, sleep, diapers, tummy time, fussy spells,
measurements). The feature collects **no new data from the family** other than the consent record itself.

### 2.5 Volume (Volume)

Unknown until activation. Design 34 section 9 simulates 100, 1 000 and 10 000 babies at 5 %, 20 % and 50 % opt-in.
The run log keeps only a babies-included count rounded to 10. The hosted instance today has few real babies (the
owner's family plus testers), so at activation most or all cells would be suppressed (risk R8).

### 2.6 Flow (Fluxo) — planned

1. An Owner or Parent opens Settings > Baby > Community insights, ticks "I am this baby's parent or legal guardian"
   and "I agree", and taps the button. The API stores an append-only consent row (`community_consents`, *planned*,
   T2).
2. Weekly (Sunday 03:30 server time), a background job in the API process, behind `CommunityInsights:Enabled`
   (default `false`), reads with a read-only database role the opted-in babies' live events, computes per-baby
   summaries in memory, applies caps, clipping, bands, k, dominance and complementary suppression and, if chosen,
   noise (design 34 section 5), and writes **only** the published statistics file and one run row. **No staging table
   of per-baby values.**
3. `GET /api/v1/community-statistics` serves the static file (no query parameters, no filters) to signed-in users
   (O10); the web app caches it and shows context lines with "From families who chose to share, not advice".

### 2.7 Retention (Retenção) — planned

| Data | Retention | Source |
| --- | --- | --- |
| Inputs (per-baby, per-day values) | in memory during the run only; never stored | design 34 section 5 |
| Consent records | while the baby exists; after withdrawal or erasure, as long as needed to prove consent. **Needs lawyer (O8)**: proposal 5 years, baby id replaced by a hash after erasure | design 34 section 3.2 |
| Run log (`community_runs`) | 2 years; no baby ids | design 34 section 7 |
| Published statistics file | current and previous (for rollback) only; the previous is deleted on the following run | design 34 sections 3.3, 7 |
| Copies on users' devices | the last downloaded file, replaced on the next fetch | design 34 section 6 |
| Database backups | the source records and consent rows are in the normal backups (`pg_dump` before migration deploys, offsite backup); their retention is open (checklist C8, audit G4) | audit section 1 |

### 2.8 Who sees what (Acesso e destinatários)

- **Results**: aggregate cells only (age band, outputs, a babies range "20-49" / "50-99" / "100+", never an exact
  count), to every signed-in user (proposal, O10) or only to opted-in families. Doctors: no new view (O9 proposal: no).
- **Inputs**: nobody. The job reads them in memory; no human runs ad-hoc pooled queries.
- **The operator of the service** keeps the administrator access to the database it has today (audit section 5, C4):
  this is a residual risk, not new to this feature.
- **Third parties**: none (no sharing, no sale, no processor). Pooling across instances is out of scope.
- **International transfer**: no transfer of the inputs. In transit, the consent calls and the aggregate file pass
  through Cloudflare's proxy like all traffic (see section 1; design 34 section 8 says "none" and should be aligned,
  section 8 below).

## 3. Legal basis (Base legal)

- **Consent of a parent or legal guardian, specific and highlighted**: art. 11, I (sensitive health data) and art. 14,
  §1 (child's data; "at least one of the parents or the legal guardian"). Art. 8: in writing or another means that
  shows the will; §4 for determined purposes (the catalog); §5 revocable at any time by a free and facilitated
  procedure. Art. 9: the information (purposes, form, duration, controller, sharing, rights) is in the screen and the
  policy section `#privacy-community-insights` (design 34 sections 3, 8).
- **Not** legitimate interest (never for sensitive data), **not** research (art. 11, II, c needs a research body),
  **not** the core consent of docs/design/38 (that covers the service, not pooling), and **not** the terms or the
  policy: only the separate opt-in screen.
- **Who consents (planned)**: per baby, a member with role Owner or Parent who ticks the guardian box. The app cannot
  verify it (the Parent role may be a grandparent). One yes suffices (art. 14, §1); every Owner/Parent sees the state
  and any of them can withdraw. **Needs owner decision (O4)**: veto or notice for the other Owners/Parents (proposal:
  notice, no veto). **Needs lawyer**: whether a self-declared guardian box is enough evidence (related to lawyer brief
  item 13 for the core consent).
- **Consent quality (planned)**: never bundled (not in sign-up, first run or a policy-accept step), not pre-ticked, no
  nagging (at most one dismissible card), equal-ease withdrawal (one tap plus Undo), versioned text (a material change
  asks again; until then the baby is excluded). **Needs owner decision (O3)** and **needs lawyer**: final screen
  wording (design 34 section 3.5). **Needs owner decision (O5)**: all-or-nothing (proposal) or per purpose.
- **Best interest of the child (art. 14, caput)**: the benefit is better context for the family's own care decisions,
  replacing guessed thresholds and foreign norms; the risk is exposure or re-identification of a child's health data.
  The data is never used to decide anything about the child or the family (art. 20 not triggered: no automated
  decision affects the subject). **Needs lawyer**: whether this balance and ANPD Enunciado CD/ANPD nº 1/2023 (as the
  audit reads it, section 7) are correctly applied to an optional, non-essential feature.
- **Art. 12 (anonymised data)**: the inputs are personal and sensitive and are processed under consent; the published
  statistics are treated as **aggregated data whose anonymity is strong but not absolute**. The design does not rely on
  art. 12 to process the inputs (design 34 section 8). **Needs lawyer**: whether the published file may be treated as
  anonymised (outside the LGPD) or should be handled as personal data with low risk.

### 3.1 Necessity and proportionality (Necessidade e proporcionalidade)

- **Why pooled data, not published norms** (design 34 section 4 "Value"): bottle norms are formula-only with 4-8 week
  bands and no breast-milk bottle norm; tummy time has no per-age distribution; feeds/diapers per day by week are thin;
  the unusual-pattern threshold is a guess; `CRY_WEIGHTS` are generic heuristics. Growth is the exception: the WHO
  standards are better, so pooled growth is proposed **out of v1** (O6).
- **Why each input**: each column in section 2.2 is the minimum needed for its statistic (age in weeks for the band;
  the measured quantity; feeding kind and part of day only where the output is split by them). Nothing finer than a
  local day or a part of day.
- **Less invasive means considered**: (a) published norms only (today's fallback, stays the default where a cell is
  suppressed); (b) per-baby learning (separate, does not pool); (c) on-device aggregation or federated statistics (not
  studied; the server already holds the records, so it would not reduce exposure to the controller). The promotion
  rule (design 34 section 9) keeps a pooled number out of the app unless it beats the norms with a confidence interval
  above zero and is calibrated; a statistic that does not pass is **not served**, which this report treats as a
  necessity test per statistic. **Planned**: the evaluation and pilot results are to be attached here before
  activation.
- **Proportionality conclusion (provisional)**: proportionate for bottle amounts, tummy time, routines and the shift
  scale **if** the evaluation shows a gain; not shown for growth (excluded) and conditional for crying (gated).

## 4. Data subject rights (Direitos dos titulares) — planned

| Right (art. 18) | How |
| --- | --- |
| Confirmation and access | consent state and history shown in the app to Owners/Parents and in the baby's export; the statistics file is visible to users |
| Correction | correcting a record corrects the next run |
| Elimination | withdrawal, deleting a record, the baby or the account removes it from the next run (no copy exists) |
| Information about sharing | none (stated in the policy) |
| Revocation (art. 8 §5) | one tap, effective for the next run |
| Response time (art. 19) | as for the rest of the service (checklist C12) |

Honest limit (design 34 section 3.3, already in the policy): statistics already computed are group numbers; a baby's
share cannot be separated out, so they are **replaced** by the next run, not "erased". **Needs lawyer**: whether this
satisfies elimination for data already published (lawyer brief item 9).

## 5. Risk assessment (Avaliação de riscos)

Scale: likelihood (L) and severity (S) as low / medium / high; "residual" is after the planned measures. Ratings
assume the measures are built as designed; none of them exists today.

| # | Risk | To whom | L before | S | Planned mitigation (design 34) | Residual |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | **Re-identification in small cells**: in a band with few families a percentile can equal one baby's value; someone who knows a family is in the app (siblings, a parents' chat) infers it | babies, families | medium | high (child's health data) | k = 20 distinct babies from 20 distinct families (O1); suppression below k with a fixed coarse fallback grid; p3/p97 only at 50+; no exact counts (ranges); fixed band edges; hysteresis (publish at 20, suppress at 18 once published) | low |
| R2 | **Membership inference / differencing between releases**: comparing two weekly files reveals who entered or left a band (e.g. a withdrawal near k) | babies, families | low-medium | medium | per-baby summaries; hysteresis; weekly (not nightly) release; optional differential privacy (O2: proposal epsilon 0.2 per statistic per week, or monthly at 0.5); no totals across bands (complementary suppression); the evaluation measures the attacker's advantage with and without DP | low with DP; low-medium without (**needs owner decision O2**) |
| R3 | **Dominance by one family**: a heavy-logging family or twins drive a cell | other families (wrong numbers), that family (exposure) | medium | medium | per-baby cap (`capPerBaby`, deterministic keyed sampling); clipping to published ranges; one summary per baby in percentiles; a "family" = babies sharing an Owner; dominance rule (one family > 25 % of the values suppresses the cell) | low |
| R4 | **Withdrawal not fully honoured**: aggregates already computed and copies on devices still reflect the baby | the baby | high (by nature of aggregates) | low (aggregate, no link to the baby) | next run excludes the baby (the job reads only the latest `granted` row with the current text version); only current + previous file kept; no staging table; the screen and the policy say this plainly | low; **needs lawyer** (section 4) |
| R5 | **Breach / security incident**: the inputs are the normal records; the new assets are the consent table and the run log | babies, parents | low (no new store of inputs) | high (source records) / low (aggregates) | no copy of per-baby values; read-only role `lotties_insights_ro` (SELECT on event, baby, membership, consent tables) plus write to `community_runs` and the file; own servers; incident process of the policy (art. 48; checklist C14); a suspected re-identification stops publication (flag off, empty file) and is handled as an incident | unchanged from the service's general security risk (audit C3, C4, G4) |
| R6 | **Function creep**: new statistics, finer dimensions (place, brand), research or partner requests, export of the pool, a query API | families | medium (pressure grows with value) | high | static published catalog in the open repository; a catalog/k/epsilon change is a reviewed commit with a policy check; a new input bumps the consent text version (re-consent); no query endpoint; no export, sale or recipient (non-goals); pooling across instances out of scope | low-medium (depends on governance holding); **needs owner decision**: commit to a written rule that research or third-party requests are refused (section 7) |
| R7 | **Children's data / consent quality**: the subject cannot consent; a non-guardian ticks the box; social pressure to share; bundling | babies | medium | high | per-baby consent by Owner/Parent with a guardian declaration; never bundled or pre-ticked; one dismissible card at most; statistics open to all users so there is no give-to-get pressure (O10); the app works the same without it; no judgement wording; Doctors, Caregivers, Viewers cannot consent | medium (the guardian box is self-declared); **needs lawyer** |
| R8 | **A hosted instance with few babies**: at launch the hosted instance has few families; cells near k; a pilot with a handful of volunteer families | the few participating families | high (today) | medium | k and suppression make every cell absent until 20 families exist; the pilot publishes only to an internal file not served to the app (design 34 section 9); flag off by default and in the home lab kit; self-hosters publish nothing with few families | low for users; **open**: the internal pilot file is seen by the operator, so it should apply the same k (**needs owner decision**, section 7) |
| R9 | **Insider access**: the operator can query the source records with administrator access | babies, families | low | high | not new to this feature (audit section 5); no ad-hoc pooled queries by policy; run log without baby ids; open code | unchanged residual of the service (audit C4) |
| R10 | **Wrong or misleading numbers** read as advice (a self-selected, home-measured sample) | babies (care decisions) | medium | medium | promotion rule and calibration gate; fallback to published norms; wording "not advice", ranges not targets, no colours or "too little"; growth excluded (O6) | low-medium |
| R11 | **Consent record exposure in exports and after erasure**: the record names the user who consented; a retained hashed baby id is still pseudonymous data | parents | low | low-medium | export of the history (design 34 section 3.2) must use stand-in authors like the backup rules; retention set by the lawyer (O8); an erasure rule in `AccountErasureTests.Rules` (T2) | low once T2 handles it; **needs lawyer (O8)** |

## 6. Measures (Medidas) — all planned

Minimisation (section 2.2); per-baby opt-in consent with versioned text and one-tap withdrawal; fixed age bands; k = 20
babies from 20 families; dominance rule; complementary suppression; per-baby cap and clipping; per-baby summaries;
p3/p97 only at 50+; hysteresis; optional differential privacy with a stated budget (O2); weekly release; no query
endpoint, no filters beyond the catalog dimensions; no exact counts; static published catalog in the open repository;
read-only database role; no staging table; own servers, no processor, no recipient; run log without baby ids; published
file states its parameters; current + previous file only; kill switch `CommunityInsights:Enabled` (default `false`,
off in the home lab kit); incident process; promotion rule and pilot before any number reaches the app; exclusion of
demo accounts and of babies in the family's own database (to be written into design 34, section 8 below).

## 7. Open points (Pontos em aberto)

### 7.1 Needs owner decision

| # | Decision (design 34 section 13) | Proposal there |
| --- | --- | --- |
| O1 | k | 20 babies from 20 families; p3/p97 at 50+; hysteresis 18 |
| O2 | DP on or off; epsilon and yearly budget | on as defence in depth; weekly 0.2 or monthly 0.5; after the evaluation. If off, the policy's "random noise" sentence goes before activation |
| O3 | Final consent wording and placement | design 34 section 3.5; Settings > Baby; one dismissible card |
| O4 | One parent's yes, veto or notice | one yes plus a notice to the others |
| O5 | All-or-nothing or per purpose | all-or-nothing in v1 |
| O6 | Pooled growth | not in v1 |
| O7 | Gestational age as an input | exclude preterm babies from v1 |
| O8 | Consent record retention after withdrawal/erasure | lawyer; proposal 5 years, hashed baby id |
| O9 | Doctors see the context lines | no, until a separate review |
| O10 | Statistics for every signed-in user or only opted-in families | every signed-in user |
| O11 | Store label purpose | App Functionality |
| O12 | Controller as individual or company, and its effect on the pooled data set | decide with the controller question |
| new | Whether the internal pilot file (design 34 section 9) applies k and the other rules, given the operator sees it | proposal: yes, same pipeline, only the destination differs |
| new | A written rule that research, partner or export requests for the pool are refused (R6) | proposal: add to design 34 non-goals as a commitment |
| new | Go / no-go sign-off and the review date (section 9) | yearly, with the age norms and vaccine schedule reviews |

### 7.2 Needs lawyer

1. Whether a self-declared "parent or legal guardian" box by an Owner or Parent meets art. 14, §1 (R7).
2. Whether describing the planned feature in the policy today is acceptable (lawyer brief item 9; checklist section 8).
3. Final consent screen wording (O3) and whether art. 9 information is complete across the screen and the policy.
4. Art. 12: whether the published file can be treated as anonymised, or as personal data at low risk (section 3).
5. Whether "replaced by the next run" satisfies elimination for statistics already published (section 4, R4).
6. Retention of consent records after withdrawal or erasure and the hashed id (O8, R11; related to brief item 16).
7. Best-interest balance for an optional feature and the reading of Enunciado CD/ANPD nº 1/2023 (section 3).
8. Whether this RIPD's structure and content meet what ANPD would expect (art. 38 sole paragraph: description of data
   types, collection method, security, and the controller's analysis of measures and safeguards), and whether ANPD
   regulation on RIPD in force at activation requires more.
9. Encarregado and small-agent status for a processing of children's sensitive data (checklist section 2; brief item 2).
10. Cloudflare in transit for the consent calls and the aggregate file (brief items 3 and 4).

## 8. Inconsistencies found while drafting (Inconsistências)

To fix in the design or audit docs (not changed in this task):

- **BYO and demo exclusions missing from design 34**: design 47 section 2.2 excludes babies stored in the family's own
  database from any aggregate, and design 45 excludes demo users from statistics (`users.issuer <>
  'urn:lotties:demo'`); design 34 section 5 "Population" mentions neither.
- **International transfer**: design 34 section 8 says "none" and treats Cloudflare proxying as hypothetical; the lawyer
  brief (section 2) records the proxy as confirmed (the audit still says "to confirm").
- **Gap G6 is closed** (audit section 8, 2026-10-27) but audit section 11's last row ("no in-app notice exists yet"),
  checklist section 8's last bullet and design 34 sections 11-12 still treat the in-app notice as missing.
- **Consent history in the export**: design 34 section 3.2 puts the history (with `user_id`) in the baby's export; the
  backup rules (docs/design/24, CLAUDE.md) forbid account ids in the file. T2 must use stand-in authors.
- **Read-only role with writes**: design 34 sections 5 and 7 call the job's connection read-only but give it write
  access to `community_runs` and the file; say "read-only on the source tables".
- **Preterm exclusion (O7) needs the field it avoids**: excluding babies born before 37 weeks requires reading
  `gestationalAgeWeeks`; the policy row and consent text should then mention that it is read as an exclusion filter.
- **Audit numbering**: docs/design/33 has two sections numbered 13 (consent and terms; try-it demo).
- **Cross-reference**: audit G3 cites lawyer brief "items 9 to 14" for the consent texts; the brief has them as items
  13 to 18.

## 9. Residual risk and decision (Risco residual e decisão)

Provisional view: with the planned measures, the residual risk to the children and families is **low** for
re-identification, dominance and breach of new assets, **low-medium** for differencing without DP and for function
creep, and **medium** for consent quality (self-declared guardian). No decision is taken here: the feature stays off.

Before activation (design 34 section 12): owner decisions O1-O12 and the new ones in 7.1; lawyer review of this draft,
the policy section and the consent text; T2-T8 built and green; evaluation and pilot results attached to section 3.1;
this report re-issued with final parameters; go / no-go signed by the controller; review date set (proposal: yearly).

| Sign-off | Name | Date | Decision |
| --- | --- | --- | --- |
| Controller | (to fill) | | go / no-go |
| Encarregado (if named) | (to fill) | | |
| Legal review | (to fill) | | |
