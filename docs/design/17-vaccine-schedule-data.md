# Vaccine schedule data, Brazil (data and sources, 2026-10-22)

This note documents `code/api/data/vaccine-schedule.br.json`: the Brazilian vaccine schedule for children and adolescents (birth to 19 years, the first 6 years done most carefully), extracted from the official Calendário Nacional de Vacinação (PNI, Ministério da Saúde) and from the two scientific societies that publish private-network recommendations (SBP and SBIm). It is data only: no app code, migration or test was written. A later worker builds the feature on top of this file; section 5 lists what that worker needs and section 10 what schema v1 cannot express. The feature (docs/design/18-vaccines.md) moved the file to schema v2 (section 11); sections 3 to 9 describe the v1 research and stay true for every v1 field.

## 0. Guardrails

- The file is information to help a family keep track, not medical advice. The child's doctor and the vaccination room decide what is given and when; the app may remind, never prescribe or declare a child "late" in a way that sounds like a verdict.
- The `network` field keeps SUS and private recommendations apart: a dose listed only by SBP or SBIm is `private` and must never be presented as something the SUS offers for free.
- Disagreements between sources are kept, not resolved (section 6). Every uncertain value carries `needsReview: true` and a reason (section 7).
- No child's data is involved; nothing here was taken from a real vaccination card.

## 1. Sources (all retrieved 2026-10-22)

Each PDF was fetched and read in full as rendered pages; facts were extracted into our own structure.

### 1.1 PNI (Ministério da Saúde), the primary source

| Ref | Document | Edition / date | URL | Used for |
|---|---|---|---|---|
| P1 | Calendário Nacional de Vacinação 2026, Vacinas da Criança (public version; PDF title "Calendário Nacional de Vacinação revisado - Criança") | PDF saved 2026-10-13 (revised) | https://www.gov.br/saude/pt-br/vacinacao/arquivos/calendario-nacional-de-vacinacao-crianca | current list of doses and ages, footnotes (rotavirus deadlines, influenza, covid-19 catch-up, yellow fever 6-8 months, tetraviral, indigenous PCV20 at 5 years, HPV catch-up) |
| P2 | Calendário Nacional de Vacinação 2026, Vacinas do Adolescente e do Jovem (public version, "revisada") | PDF saved 2026-10-13 | https://www.gov.br/saude/pt-br/vacinacao/arquivos/calendario-nacional-de-vacinacao-adolescentes-jovens | dT at 14 years, ACWY at 11 years, dengue at 10 years, catch-up limits |
| P3 | Calendário Nacional de Vacinação 2026, Ciclo de Vida, Criança (technical table for professionals) | "Atualizado em 30 de janeiro de 2026" (CGICI/DPNI/SVSA) | https://www.gov.br/saude/pt-br/composicao/svsa/pni/calendario-tecnico/calendario-tecnico-nacional-de-vacinacao-crianca | recommended and minimum intervals, age groups (catch-up limits), minimum ages, notes |
| P4 | Calendário Nacional de Vacinação 2026, Ciclo de Vida, Adolescente e Jovem (technical table) | "Atualizado em 04 de fevereiro de 2026" (PDF saved 2026-07-02) | https://www.gov.br/saude/pt-br/composicao/svsa/pni/calendario-tecnico/calendario-tecnico-nacional-de-vacinacao-adolescentes-jovens | adolescent intervals and age groups |
| P5 | Nota Técnica nº 64/2026-CGICI/DPNI/SVSA/MS: second VIP booster from 2026-08-03 | signed 2026-06-17/18, SEI 0056071763 | read from the copy hosted by SBIm: https://sbim.org.br/images/SEI_0056071763_Nota_Tecnica_64.pdf_2026-06-23.pdf (a Ministry SEI document with its verification code; the gov.br copy was not found) | VIP schedule 2, 4, 6, 15 months and 4 years; catch-up to 4 years 11 months 29 days; 6-month minimum between boosters; registration age ranges |
| P6 | Guia Técnico para introdução da vacina pneumocócica 20-valente (conjugada) no PNI | 1st edition 2026, preliminary electronic version | https://www.gov.br/saude/pt-br/centrais-de-conteudo/publicacoes/guias-e-manuais/2026/guia-tecnico-para-introducao-da-vacina-pneumococica-20-valente-conjugada-no-programa-nacional-de-imunizacoes.pdf | PCV20/PCV10 transition scheme (Quadro 1), registration age ranges (Quadro 5) |
| X1 | Rio de Janeiro municipal child calendar (SMS-Rio), cross-check only | "Atualizado em agosto de 2026", PDF 2026-08-14 | https://saude.prefeitura.rio/wp-content/uploads/sites/47/2026/08/CalendariosDeVacinacao_PDFDigital_20260814_Crianca.pdf | confirms the maximum age to start each scheme; not used as a primary value |

Index page: https://www.gov.br/saude/pt-br/vacinacao/calendario. Precedence inside the PNI: the newer publication wins where they differ (P5 of June 2026 and P6 of 2026 override P3 on VIP and pneumococcal doses; P1/P2 of October 2026 are the current public list). P3/P4 still supply intervals and age limits that P1/P2 do not print.

Not read: the Instrução Normativa do Calendário Nacional de Vacinação 2026 (cited by P3 and P6), the CRIE manual (2023) and state copies (Espírito Santo, Rondônia) found by search.

### 1.2 SBP

| Ref | Document | Edition / date | URL |
|---|---|---|---|
| S1 | Calendário de Vacinação da SBP, Atualização 2026/2027 (Documento Científico nº 56, Departamento Científico de Imunizações, gestão 2025-2028) | 2026-07-28 (PDF last modified 2026-09-10) | news page https://www.sbp.com.br/?p=63971 ("Confira o novo Calendário de Vacinação da SBP (atualização 2026/2027)", 2026-07-28); PDF through the page's download link https://www.sbp.com.br/?acervo_download=1&post_id=63953&nonce=6783e7f895 (the link carries a nonce and may stop working) |

The edition named in the brief (2025-2026, https://www.sbp.com.br/fileadmin/user_upload/sbp/2025/outubro/21/25063c-DC_Calendario_Vacinacao_-_Atualizacao_2025-26.pdf, news page dated 2025-10-20) is superseded by S1 and was not extracted.

### 1.3 SBIm

| Ref | Document | Edition / date | URL |
|---|---|---|---|
| B1 | Calendário de vacinação SBIm Criança (0 a menos de 10 anos), Recomendações 2026/2027 | "Atualizado em 17.06.2026" (PDF 2026-06-19) | https://sbim.org.br/images/crianca-Calend-SBIm-2026-27-260619.pdf_2026-06-19.pdf |

An earlier 2026/2027 version (dated 2026-04-28) exists; a search found no later child version. The SBIm adolescent calendar was not part of the brief and was not used, so SBIm values stop below 10 years (section 7, R-DOC-7).

## 2. Licence and terms of reuse (findings)

| Source | What the publisher states | Finding |
|---|---|---|
| PNI (gov.br) | The gov.br footer of the calendar page says all site content is published under Creative Commons Atribuição-SemDerivações 3.0 Não Adaptada (CC BY-ND 3.0); the same footer also reads "©2025 - Ministério da Saúde \| Todos os direitos reservados". The PDFs carry no separate licence. | Reuse with attribution is allowed; the ND clause forbids distributing adapted versions of the *documents*. We copy no text, table layout or artwork, only facts (which vaccine, at what age, how many doses, what interval), restructured. Owner to confirm this reading of ND for factual data. Whether the calendar, set by official acts, is outside copyright altogether could not be checked here (the planalto.gov.br copy of Lei 9.610/1998 refused the connection). |
| SBP | Site footer: "Copyright © 2026 Sociedade Brasileira de Pediatria. Todos os direitos reservados." No licence or reuse terms found on the calendar pages or in the PDF. | All rights reserved. We record only scheduling facts with attribution and a link, in our own words. **Owner decision needed** before publishing: rely on facts-only reuse or ask SBP for permission. |
| SBIm | Site footer: "©2024 - Sociedade Brasileira de Imunizações \| Todos os direitos reservados". The calendar PDF carries no licence. | Same as SBP. **Owner decision needed.** |

Attribution draft for the owner to adapt (wording and placement are the owner's and the feature worker's decision, not settled here): "Vaccine schedule facts: Ministério da Saúde (Calendário Nacional de Vacinação 2026), Sociedade Brasileira de Pediatria (2026/2027) and Sociedade Brasileira de Imunizações (2026/2027), reorganised by Lotties. Not medical advice."

## 3. Method and field conventions

1. Each source was read in full (page images plus text); facts were copied into a working table, then into the JSON. Vaccine names and dose labels are our own; no sentence or table layout was reproduced.
2. **Ages in days.** Months: `round(30.4375 × months)`, halves rounded up (2 m = 61, 4 m = 122, 6 m = 183, 9 m = 274, 12 m = 365, 15 m = 457, 18 m = 548, 4 y = 1461, 5 y = 1826, 9 y = 3287, 10 y = 3653, 11 y = 4018, 14 y = 5114, 16 y = 5844). "X months and 15 days" adds 15 days (1 m 15 d = 45, 3 m 15 d = 106). An upper limit written "N meses/anos, 11 meses e 29 dias" (or "até 23 meses e 29 dias") is the day before the next month or birthday: 11 m 29 d = 364, 23 m 29 d = 730, 4 y 11 m 29 d = 1825, 5 y 11 m 29 d = 2191, 6 y 11 m 29 d = 2556, 14 y 11 m 29 d = 5478. "Ao nascer" = 0. Weeks: 6 weeks = 42, 4 weeks = 28, 8 weeks = 56. Intervals: 2 months = 61, 3 months = 91, 6 months = 183, 5 years = 1826.
3. **recommendedAgeDays**: the age the source's table puts the dose at. When the source gives a range ("15 a 18 meses"), the start of the range.
4. **earliestAgeDays**: the minimum age the source states for that dose; when it states only a minimum interval, the earliest age of the previous dose plus that interval (e.g. penta-2 = 42 + 30 = 72); when a society states neither, the recommended age (conservative: the app never calls an early dose valid on our guess). A "dose zero" given before the routine age (yellow fever at 6-8 months, MMR at 6-11 months, varicella from 9 months in outbreaks) never counts, so it does not lower `earliestAgeDays`.
5. **latestAgeDays**: the last age at which the source still gives or recommends the dose; for PNI doses, the SUS catch-up limit (section 5.3). `null` = no upper limit inside 0-19 years (or none stated).
6. **minIntervalDaysFromPrevious**: the minimum interval the source states after the previous dose of the same series ("previous" is listed in section 4; for boosters it may be a dose of another vaccine key, e.g. `dtp-reforco-1` follows `penta-3`). When a source states a single interval and no shorter minimum (HPV 0-6 months, dengue 0-3 months), that interval. `null` = not stated.
7. **sources**: which of `pni`, `sbp`, `sbim` list a dose at that age. **network**: `public` when the PNI lists it (free in the SUS), otherwise `private`.
8. **alternativeGroup**: doses with the same group fill the same slot; recording any one satisfies the slot. Used where the PNI and the societies give the same slot with a different product or age (penta vs hexavalente, whole-cell vs acellular boosters, MenC vs ACWY, varicella 15 m/4 y vs 12 m/15 m, hepatitis A, dengue, yearly influenza, adolescent tetanus booster). When the ages agree and only a preference differs (pneumococcal valence, rotavirus product, polio window), there is one dose entry with all its sources and the difference is in `notes` and section 6.
9. **Order.** `vaccines` in order of the first scheduled dose; `doses` grouped by `vaccineKey` in that order, then by `recommendedAgeDays`, PNI entry first on ties. Keys inside objects keep the brief's order; the file is UTF-8, 2-space indent, LF, trailing newline (canonical `json.dumps(indent=2, ensure_ascii=False)` output).
10. Vaccines `vop` (oral polio, removed from the SUS schedule in 2024; P5 still counts an earlier VOP booster) and `tetraviral` (MMRV) have no doses of their own: they exist so a dose can be recorded. Section 5.4 says which slots they fill.

## 4. The schedule

Ages in days in brackets. "All" = PNI, SBP and SBIm. "After" = the previous dose the minimum interval refers to. R = `needsReview`.

| Dose | Recommended | Earliest | Latest | Min interval (after) | Sources | Network | Group | R |
|---|---|---|---|---|---|---|---|---|
| bcg-1 | birth (0) | 0 | 4 y 11 m 29 d (1825) | - | All | public | - | |
| hepatite-b-1 | birth (0) | 0 | 30 d (30) | - | All | public | - | |
| hepatite-b-2 | 1 m (30) | 30 | - | 30 (hepatite-b-1) | SBP, SBIm | private | - | R |
| hepatite-b-3 | 6 m (183) | 183 | - | - (hepatite-b-2) | SBP, SBIm | private | - | R |
| vsr-nirsevimabe-1 | birth (0) | 0 | 11 m 29 d (364) | - | SBP, SBIm | private | - | R |
| penta-1 | 2 m (61) | 6 wk (42) | 6 y 11 m 29 d (2556) | - | PNI | public | dtp-primaria-1 | |
| penta-2 | 4 m (122) | 72 | 2556 | 30 (penta-1) | PNI | public | dtp-primaria-2 | |
| penta-3 | 6 m (183) | 102 | 2556 | 30 (penta-2) | PNI | public | dtp-primaria-3 | |
| hexavalente-1 | 2 m (61) | 61 | - | - | SBP, SBIm | private | dtp-primaria-1 | R |
| hexavalente-2 | 4 m (122) | 122 | - | - (hexavalente-1) | SBP, SBIm | private | dtp-primaria-2 | R |
| hexavalente-3 | 6 m (183) | 183 | - | - (hexavalente-2) | SBP, SBIm | private | dtp-primaria-3 | R |
| vip-1 | 2 m (61) | 61 | 1825 | - | All | public | - | |
| vip-2 | 4 m (122) | 91 | 1825 | 30 (vip-1) | All | public | - | |
| vip-3 | 6 m (183) | 121 | 1825 | 30 (vip-2) | All | public | - | |
| vip-reforco-1 | 15 m (457) | 1 y (365) | 1825 | 183 (vip-3) | All | public | - | |
| vip-reforco-2 | 4 y (1461) | 4 y (1461) | 1825 | 183 (vip-reforco-1) | All | public | - | R |
| rotavirus-1 | 2 m (61) | 1 m 15 d (45) | 11 m 29 d (364) | - | All | public | - | |
| rotavirus-2 | 4 m (122) | 3 m 15 d (106) | 23 m 29 d (730) | 30 (rotavirus-1) | All | public | - | |
| rotavirus-3 | 6 m (183) | 183 | 730 | 30 (rotavirus-2) | SBP, SBIm | private | - | R |
| pneumo-conjugada-1 | 2 m (61) | 61 | 364 | - | All | public | - | |
| pneumo-conjugada-2 | 4 m (122) | 122 | 364 | 30 (pneumo-1) | All | public | - | R |
| pneumo-conjugada-3 | 6 m (183) | 183 | - | - (pneumo-2) | SBP, SBIm | private | - | R |
| pneumo-conjugada-reforco | 12 m (365) | 365 | 1825 | 60 (pneumo-2) | All | public | - | |
| meningo-c-1 | 3 m (91) | 91 | 364 | - | PNI | public | meningo-primaria-1 | |
| meningo-c-2 | 5 m (152) | 121 | 364 | 30 (meningo-c-1) | PNI | public | meningo-primaria-2 | |
| meningo-acwy-1 | 3 m (91) | 2 m (61) | - | - | SBP, SBIm | private | meningo-primaria-1 | R |
| meningo-acwy-2 | 5 m (152) | 152 | - | - (meningo-acwy-1) | SBP, SBIm | private | meningo-primaria-2 | R |
| meningo-acwy-reforco-1 | 12 m (365) | 365 | 1825 | 60 (2nd primary dose) | All | public | - | |
| meningo-acwy-reforco-2 | 5 y (1826) | 1826 | 6 y 11 m 29 d (2556) | - | SBP, SBIm | private | - | R |
| meningo-acwy-adolescente | 11 y (4018) | 4018 | 14 y 11 m 29 d (5478) | - | PNI, SBP | public | - | |
| meningo-acwy-adolescente-2 | 16 y (5844) | 5844 | - | - | SBP | private | - | R |
| meningo-b-1 | 3 m (91) | 2 m (61) | - | - | SBP, SBIm | private | - | |
| meningo-b-2 | 5 m (152) | 122 | - | 61 (meningo-b-1) | SBP, SBIm | private | - | |
| meningo-b-reforco | 12 m (365) | 365 | 23 m 29 d (730) | - | SBP, SBIm | private | - | |
| influenza-1 | 6 m (183) | 183 | 5 y 11 m 29 d (2191) | - | All | public | - | |
| influenza-2 | 7 m (213) | 211 | 2191 | 28 (influenza-1) | All | public | - | |
| influenza-anual | placeholder 1 y (365) | 365 | 2191 | - | PNI | public | influenza-anual | R |
| influenza-anual-sociedades | placeholder 1 y (365) | 365 | - | - | SBP, SBIm | private | influenza-anual | R |
| covid-19-1 | 6 m (183) | 183 | 1825 | - | All | public | - | |
| covid-19-2 | 7 m (213) | 211 | 1825 | 28 (covid-19-1) | All | public | - | |
| covid-19-3 | 9 m (274) | 267 | 1825 | 56 (covid-19-2) | PNI | public | - | R |
| febre-amarela-1 | 9 m (274) | 274 | - | - | All | public | - | |
| febre-amarela-reforco | 4 y (1461) | 304 | - | 30 (febre-amarela-1) | All | public | - | R |
| triplice-viral-1 | 12 m (365) | 365 | - | - | All | public | - | |
| triplice-viral-2 | 15 m (457) | 380 | - | 15 (triplice-viral-1) | All | public | - | R |
| varicela-1-sociedades | 12 m (365) | 365 | - | - | SBP, SBIm | private | varicela-1 | |
| varicela-1 | 15 m (457) | 457 | 2556 | - | PNI | public | varicela-1 | |
| varicela-2-sociedades | 15 m (457) | 457 | - | 91 (varicela-1-sociedades) | SBP, SBIm | private | varicela-2 | |
| varicela-2 | 4 y (1461) | 548 | 2556 | 91 (varicela-1) | PNI | public | varicela-2 | |
| hepatite-a-1-sociedades | 12 m (365) | 365 | - | - | SBP, SBIm | private | hepatite-a-1 | |
| hepatite-a-1 | 15 m (457) | 457 | 1825 | - | PNI | public | hepatite-a-1 | |
| hepatite-a-2 | 18 m (548) | 548 | - | 183 (hepatite-a-1-sociedades) | SBP, SBIm | private | - | |
| dtp-reforco-1 | 15 m (457) | 457 | 2556 | 183 (penta-3) | PNI | public | dtp-reforco-1 | |
| dtp-reforco-2 | 4 y (1461) | 640 | 2556 | 183 (dtp-reforco-1) | PNI | public | dtp-reforco-2 | |
| dtpa-reforco-1 | 15 m (457) | 457 | - | - (hexavalente-3) | SBP, SBIm | private | dtp-reforco-1 | |
| dtpa-reforco-2 | 4 y (1461) | 1461 | 2556 | - (dtpa-reforco-1) | SBP, SBIm | private | dtp-reforco-2 | |
| hib-reforco | 15 m (457) | 457 | 1825 | - | SBP, SBIm | private | - | R |
| dt-adulto-reforco-14a | 14 y (5114) | 5114 | - | 1826 (last DTP booster) | PNI | public | dt-reforco-adolescente | |
| dtpa-adulto-reforco-9a | 9 y (3287) | 3287 | - | - | SBIm | private | dt-reforco-adolescente | R |
| dtpa-adulto-reforco-14a | 14 y (5114) | 5114 | - | - | SBP | private | dt-reforco-adolescente | |
| hpv-1 | 9 y (3287) | 3287 | 14 y 11 m 29 d (5478) | - | All | public | - | |
| hpv-2 | 9 y 6 m (3470) | 3470 | - | 183 (hpv-1) | SBP, SBIm | private | - | |
| dengue-1-sociedades | 4 y (1461) | 1461 | - | - | SBP, SBIm | private | dengue-1 | R |
| dengue-2-sociedades | 4 y 3 m (1552) | 1552 | - | 91 (dengue-1-sociedades) | SBP, SBIm | private | dengue-2 | R |
| dengue-1 | 10 y (3653) | 3653 | 5478 | - | PNI | public | dengue-1 | |
| dengue-2 | 10 y 3 m (3744) | 3744 | 5478 | 91 (dengue-1) | PNI | public | dengue-2 | |

Counts: 26 vaccines (2 without doses: `vop`, `tetraviral`), 66 doses (38 public, 28 private), 23 with `needsReview`.

What each source says in short (facts, our wording):
- **PNI, first year:** BCG and hepatitis B at birth; penta, VIP, rotavirus and pneumococcal at 2 and 4 months; MenC at 3 and 5 months; penta and VIP at 6 months; influenza and covid-19 from 6 months (covid 6, 7, 9 months); yellow fever at 9 months. **Second year:** PCV20 booster, ACWY and MMR at 12 months; DTP and VIP boosters, MMR 2nd dose, varicella and hepatitis A at 15 months. **Later:** DTP 2nd booster, VIP 2nd booster (since 2026-08-03), varicella 2nd dose and yellow fever booster at 4 years; HPV4 single dose at 9 years; dengue (2 doses) at 10 years; ACWY at 11 years; dT at 14 years.
- **SBP 2026/2027:** same antigens plus acellular preference, a third infant pneumococcal dose (3+1 with PCV20/PCV15), Hib booster at 15 months, ACWY preferred for every meningococcal dose with boosters at 12 months, 5-6 years and 11-12 years (and a conditional dose at 16), MenB at 3, 5, 12 months, MMR + varicella at 12 and 15 months (MMRV preferred for the second), hepatitis A at 12 and 18 months, HPV in 2 doses (HPV9 preferred), dTpa at 14 years, dengue from 4 years, influenza every year for all ages from 6 months, and the RSV antibody at birth when the mother was not vaccinated.
- **SBIm 2026/2027 (children under 10):** close to SBP: hepatitis B 0-1-6 (or 4 doses with combinations), rotavirus 2 or 3 doses by product, 3+1 pneumococcal, ACWY or C at 3, 5, 12-15 months and 5-6 years, MenB 3, 5, 12-15 months, MMR and varicella 12 and 15-24 months, hepatitis A 12 and 18 months, polio boosters at 15 months and 4-6 years, dTpa at 9 years, HPV 2 doses from 9 years, dengue from 4 years, nirsevimab for under-12-month-olds in listed situations.

## 5. Rules the feature worker needs

### 5.1 Doses at birth and their windows

| Dose | Window | Source detail |
|---|---|---|
| BCG (`bcg-1`) | at birth, in the maternity ward or at the first visit; PNI: within 30 days of life as routine; SUS catch-up up to 4 y 11 m 29 d | postpone below 2 kg (PNI "peso inferior a 2 kg"; SBP "> 2.000 g"; SBIm "≥ 2.000 g"); postpone while hospitalised with general impairment or with severe skin lesions; contraindicated in immunodeficiency; HIV-exposed children get it only when asymptomatic without immunosuppression (PNI); societies: postpone when a newborn screening for inborn errors of immunity is pending or the mother used immunosuppressants/biologics in pregnancy; no revaccination for a missing scar |
| Hepatitis B (`hepatite-b-1`) | SBP and SBIm: within the first 12 hours; PNI: from 0 to 30 days of life | after 30 days the SUS skips the birth dose and starts with penta at 2 months (penta minimum age 6 weeks); mother HBsAg-positive: vaccine plus hepatitis B immunoglobulin, ideally within 12 hours, immunoglobulin at most up to 7 days (PNI; SBP and SBIm also say up to day 7) |
| RSV antibody (`vsr-nirsevimabe-1`) | societies: single dose in the first year, preferably in the maternity ward, any season, for babies of mothers not vaccinated against RSV; up to 11 m 29 d | the SUS gives it only to babies born before 37 weeks while under 6 months (any time of year) and to children under 2 years with eligible conditions (during the RSV season; SBIm: February to August); see section 8 for the pregnancy choice |

### 5.2 Rotavirus deadlines

- 1st dose: PNI from 1 month 15 days (45 d), SBIm from 6 weeks (42 d); **maximum 11 months 29 days (364 d) in all three sources**. PNI: if the 1st dose is not given in that window, the child loses the chance of the 2nd dose (no rotavirus vaccination at all).
- 2nd dose: PNI from 3 months 15 days (106 d) to 23 months 29 days (730 d); the PNI minimum interval is 30 days but the 2nd dose may not be given before 3 m 15 d.
- Last dose of any series (RV1 2nd, RV5 3rd): **by 23 months 29 days (730 d)** (SBP; SBIm calls catch-up use off label).
- Intervals: 60 days recommended; minimum 30 days (PNI, SBIm) or 4 weeks (SBP).
- RV5 (private) needs 3 doses; if any dose was RV5 or unknown, give 3 (SBP, SBIm). A dose that is spat out or vomited is not repeated (SBP, SBIm). Not for hospitalised babies (SBP, SBIm).

### 5.3 SUS catch-up limits (`latestAgeDays` of PNI doses)

| Vaccine | SUS gives it until | Days |
|---|---|---|
| BCG | 4 y 11 m 29 d | 1825 |
| Hepatitis B birth dose | 30 days of life (then penta) | 30 |
| Penta (all 3 doses) | 6 y 11 m 29 d | 2556 |
| VIP (all 5 doses) | 4 y 11 m 29 d; 2nd booster only from 4 y (registration range 4 to under 5 years) | 1825 |
| Rotavirus | 1st dose 11 m 29 d; 2nd dose 23 m 29 d | 364 / 730 |
| Pneumococcal primary doses | 11 m 29 d (from 12 months: booster or a single dose instead) | 364 |
| Pneumococcal booster or single dose | 4 y 11 m 29 d | 1825 |
| MenC primary doses | 11 m 29 d (from 12 months: a single ACWY dose instead) | 364 |
| ACWY at 12 months (booster or single dose) | 4 y 11 m 29 d | 1825 |
| Influenza routine | 5 y 11 m 29 d (8 y 11 m 29 d for Indigenous children and children with comorbidities) | 2191 |
| Covid-19 | 4 y 11 m 29 d | 1825 |
| Yellow fever | no upper limit in this age range (adults to 59 years); booster only if the 1st dose was before 5 years | - |
| MMR | no upper limit in this age range (2 doses for 5 to 29 years) | - |
| Hepatitis A | 4 y 11 m 29 d | 1825 |
| DTP boosters | 6 y 11 m 29 d (from 7 years dT is used) | 2556 |
| Varicella | 6 y 11 m 29 d (general population; lifelong for Indigenous people) | 2556 |
| HPV4 | 14 y 11 m 29 d (15 to 19 years only through state catch-up strategies) | 5478 |
| ACWY adolescent | 14 y 11 m 29 d | 5478 |
| Dengue | 14 y 11 m 29 d | 5478 |
| dT | no upper limit | - |

### 5.4 Combined products and which slots they fill (schema v1 cannot express this)

From SBIm's composition table and the SBP/PNI notes:

| Product | Contains | Fills |
|---|---|---|
| Penta (`penta`, SUS) | diphtheria, tetanus, whole-cell pertussis, Hib, hepatitis B | `dtp-primaria-N`; plus a hepatitis B dose (birth dose + penta = 4 hepatitis B doses), so `hepatite-b-2/3` are not needed |
| Hexavalente acelular (`hexavalente`, private) | diphtheria, tetanus, acellular pertussis, Hib, hepatitis B, polio | `dtp-primaria-N` and `vip-N` of the same age; hepatitis B as above |
| Pentavalente acelular (DTPa-VIP-Hib, private; no key yet) | diphtheria, tetanus, acellular pertussis, Hib, polio | at 15 months: `dtpa-reforco-1` + `hib-reforco` + `vip-reforco-1` |
| DTPa-VIP / dTpa-VIP (private; no key yet) | diphtheria, tetanus, acellular pertussis, polio | at 4-6 years: `dtpa-reforco-2` + `vip-reforco-2` (SBIm) |
| Tetraviral (`tetraviral`) | measles, mumps, rubella, varicella | SUS (when monovalent varicella is missing; Rio uses it at 15 months): `triplice-viral-2` + `varicela-1`; societies: `triplice-viral-2` + `varicela-2-sociedades` (or both first doses at 12 months) |
| Hepatitis A+B (Twinrix, private, from 1 year; no key yet) | hepatitis A, hepatitis B | catch-up of both (SBIm, SBP) |

Until schema v2, the feature must carry this mapping itself or accept duplicate reminders.

## 6. Disagreements (PNI vs SBP vs SBIm)

| # | Topic | PNI | SBP | SBIm | In the data |
|---|---|---|---|---|---|
| D1 | Polio 2nd booster | at 4 years, reintroduced 2026-08-03 (P5); window 4 to under 5 years; P3 (Jan 2026) still shows one booster | 4-6 years; notes the PNI reintroduction | 4-6 years; says the PNI has one booster (written before the change) | one entry, PNI window, R |
| D2 | Pneumococcal | 2+1: PCV20 at 2 m, PCV10 at 4 m while stocks last (then PCV20), PCV20 booster at 12 m | 3+1 with PCV20 or PCV15 (2, 4, 6 m + 12-15 m) when starting by 6 months | 3+1 with PCV20 or PCV15; booster 12-15 m | dose 3 private only; product in notes; R on doses 2 and 3 |
| D3 | Diphtheria-tetanus-pertussis | whole-cell (penta, then DTP boosters at 15 m and 4 y) | acellular preferred; DTP/DTPa at 2, 4, 6, 15 m, 4-6 y | acellular preferred; boosters 15-18 m and 4-6 y | penta/DTP vs hexavalente/DTPa in groups |
| D4 | Hib booster | none (3 doses in penta) | 4th dose at 15 m required after acellular combinations | booster at 15-18 m, mainly after acellular combinations | private `hib-reforco`, R |
| D5 | Hepatitis B | birth dose (up to 30 days) + penta at 2, 4, 6 m | first 12 h; 2nd at 1 or 2 m, 3rd at 6 m (private 0-2-6); 4 doses with penta | first 12 h; 0-1-6; 4 doses with combinations | `hepatite-b-2/3` private, R |
| D6 | Rotavirus | RV1, 2 doses; 1st dose from 1 m 15 d; minimum 30 days | RV1 2 doses or RV5 3 doses; minimum 4 weeks | RV1 or RV5; 1st dose from 6 weeks; minimum 30 days | `rotavirus-3` private; earliest 45 d (PNI) |
| D7 | Meningococcal | MenC 3, 5 m; ACWY 12 m; ACWY 11 y | ACWY preferred for every dose; boosters 12 m, 5-6 y, 11-12 y, conditional 16 y | ACWY preferred; boosters 12-15 m and 5-6 y | groups for the primary doses; private boosters, R |
| D8 | Meningococcal B | not offered | 3, 5, 12 m | 3, 5, 12-15 m | private |
| D9 | Varicella | 15 m and 4 y (tetraviral only if monovalent missing) | 12 m and 15 m (MMRV preferred for the 2nd) | 12 m and 15-24 m (MMRV preferred for the 2nd) | separate entries in groups `varicela-1/2` |
| D10 | MMR 2nd dose interval | 30 days; 15-day minimum only for travel or outbreaks | 3 months when given as MMRV | 3 months from the previous MMR, varicella or MMRV | PNI value in the field, R |
| D11 | Hepatitis A | single dose at 15 m (to 4 y 11 m 29 d) | 2 doses at 12 and 18 m | 2 doses at 12 and 18 m | separate entries |
| D12 | Influenza | routine 6 m to 5 y 11 m 29 d; 2 doses the first time for 6 m to under 6 y | every year for all children and adolescents; 2 doses the first time under 9 y | same as SBP; extra dose 3 months later possible for risk groups | yearly placeholders, R |
| D13 | HPV | HPV4 single dose, 9-14 y | HPV9 preferred, 2 doses (0, 6 m), 9-19 y | HPV9 preferred, 2 doses | `hpv-2` private |
| D14 | Dengue | Qdenga, 10-14 y | Qdenga from 4 y (to 60 y) | Qdenga from 4 y | separate entries, society ones R |
| D15 | Yellow fever after a first dose at 5 y or later | single dose | second dose preferred for all; 2 doses for unvaccinated adolescents | second dose 10 years later | conditional booster, R |
| D16 | Adolescent tetanus/diphtheria | dT at 14 y, then every 10 y | dTpa (or dT) at 14 y | dTpa at 9 y (5 years after the 4-6 y booster) | three entries in `dt-reforco-adolescente` |
| D17 | RSV antibody | preterm < 37 weeks under 6 m; comorbidities under 2 y | all newborns of unvaccinated mothers, at the maternity | same, plus listed situations | private entry, R |
| D18 | BCG weight threshold | postpone below 2 kg | more than 2,000 g | 2,000 g or more | note only (differs exactly at 2,000 g) |
| D19 | Influenza product | trivalent | tri- or quadrivalent | trivalent (SUS), tri- or quadrivalent (private) | not modelled |
| D20 | VIP catch-up | up to 4 y 11 m 29 d | any age (in private clinics) | - | PNI limit in the field |

## 7. Needs review

### 7.1 Doses with `needsReview: true` (23)

| Dose | Why |
|---|---|
| hepatite-b-2, hepatite-b-3 | Only for a stand-alone hepatitis B series; satisfied by penta/hexa, which schema v1 cannot express; SBP and SBIm differ on the month of dose 2 (1-2 vs 1); no infant minimum interval for dose 3 |
| hexavalente-1/2/3 | Societies recommend antigens, not a product; hexavalente chosen as the combination they list for private clinics; coverage of VIP and hepatitis B slots not expressible; no minimum age, interval or age limit stated |
| vip-reforco-2 | Recent PNI change (2026-08-03); P3 and SBIm not updated; SUS window from P5 table 1; societies to 6 years |
| rotavirus-3 | Product-dependent (RV5 only); no minimum age stated |
| pneumo-conjugada-2 | Product at this dose depends on local stock and on dose 1 during the PCV10 to PCV20 transition; the 30-day minimum applies only when starting at 6 months or later |
| pneumo-conjugada-3 | Dose count depends on product and starting age (labels) |
| meningo-acwy-1, meningo-acwy-2 | Infant ACWY dose count and ages depend on the product |
| meningo-acwy-reforco-2 | SBP table says 4-6 years, its note 5-6 years; window end is our reading |
| meningo-acwy-adolescente-2 | Hollow circle in the SBP table without a printed legend; conditional on never having had ACWY |
| influenza-anual, influenza-anual-sociedades | Yearly recurrence not expressible; 365 days is a placeholder |
| covid-19-3 | Only in the Comirnaty 3-dose scheme |
| febre-amarela-reforco | Conditional on a first dose before 5 years |
| triplice-viral-2 | Field holds the PNI minimum (15 days, exceptional); societies require 3 months with MMRV |
| hib-reforco | Conditional (SBP: after acellular combinations; SBIm: mainly then); usually inside a combined product |
| dtpa-adulto-reforco-9a | SBIm adolescent calendar not consulted |
| dengue-1-sociedades, dengue-2-sociedades | Societies give a starting age, not a recommended age |
| vsr-nirsevimabe-1 | Depends on maternal RSV vaccination, prematurity and comorbidities |

### 7.2 Document-level items

- **R-DOC-1 Licences.** CC BY-ND for gov.br; all rights reserved for SBP and SBIm. Owner decision before publishing (section 2).
- **R-DOC-2 SBP link and revision.** The PDF link carries a nonce; the PDF was modified on 2026-09-10, after its printed date (2026-07-28). Re-download and compare before release.
- **R-DOC-3 SBP hollow circles.** The SBP table uses filled and hollow circles without a printed legend; the hollow ones (hepatitis B at 4 m, rotavirus at 6 m, ACWY at 16 y) were read from the notes as "depends on product/situation".
- **R-DOC-4 PNI technical calendar outdated.** P3 (2026-01-30) predates PCV20 and the VIP 2nd booster; watch for a revised technical calendar or Instrução Normativa and re-check intervals.
- **R-DOC-5 PCV10 at 4 months.** P1 (2026-10-13) still lists PCV10 at 4 months; when stocks end the PNI moves to PCV20 at 2, 4 and 12 months (P6, SBP note 07). Update the notes then.
- **R-DOC-6 Instrução Normativa CNV 2026 not read.** It may hold rules (e.g. covid-19 product use, influenza dates) not in the calendars.
- **R-DOC-7 SBIm under 10 only.** SBIm adolescent recommendations (10-19 years) are absent; SBIm-only adolescent doses may be missing.
- **R-DOC-8 Rounding.** Day values use round-half-up of 30.4375 × months; a different convention shifts some values by one day (e.g. 24 months = 730.5).
- **R-DOC-9 Ranges.** "X a Y anos" upper ends were read as the day before the (Y+1)th birthday.
- **R-DOC-10 Earliest age of society doses.** Set to the recommended age when no minimum is stated: a correctly early private dose may look early in the app.
- **R-DOC-11 Indigenous and special groups excluded** from the dose list (section 8).

## 8. Special populations not covered

The dose list is for a healthy child following the routine calendar. Not modelled:

- **Premature babies.** SBP: weight 2 kg or less or under 33 weeks needs 4 hepatitis B doses (0, 2, 4, 6 m); BCG waits for 2 kg; the SUS gives nirsevimab to babies born before 37 weeks while under 6 months; PCV20 guide: watch for apnoea for 48 hours in babies of 28 weeks or less still in hospital; rotavirus is not given in hospital (SBP, SBIm). SBIm has a separate premature calendar (not read).
- **Immunocompromised children and other special conditions.** Handled by CRIE/RIE (Manual CRIE 2023, Portaria GM/MS 6.623/2025) and SBIm's special-patient calendars: live vaccines (BCG, rotavirus, yellow fever, MMR, varicella, dengue) may be contraindicated; HPV 3 doses; covid-19 3 doses then periodic doses (P1: every 6 months up to 4 y 11 m 29 d; P3: once a year up to 4 y 11 m 29 d, and yearly from 5 years with special conditions; the two PNI documents differ); extra Hib, pneumococcal (PCV20 via RIE), meningococcal doses; babies whose mothers used biologics (e.g. rituximab) in pregnancy have BCG and rotavirus postponed or contraindicated (SBP, SBIm). HIV-exposed children: BCG only when asymptomatic (PNI).
- **HBsAg-positive mothers:** immunoglobulin plus vaccine at birth (in notes, not a dose entry).
- **Indigenous children:** influenza routine to 8 y 11 m 29 d with yearly doses; varicella for life; PCV20 (formerly VPP23, while stocks last) at 5 years without a previous conjugate dose; Yanomami and Ye'kwana rules (NT 37/2023). Not modelled.
- **Travel and outbreaks.** Yellow fever at 6-8 months in areas with confirmed circulation (dose zero) and at least 10 days before travel, international certificate (CIVP); MMR dose zero at 6-11 months in outbreak response; varicella from 9 months and post-exposure within 5 days; influenza Northern/Southern hemisphere vaccine for travellers or the North region (SBIm); rabies pre-exposure in the Legal Amazon. Not modelled.
- **Pregnancy-related RSV choice.** Two strategies protect the newborn: the RSV vaccine in pregnancy (Abrysvo, offered by the PNI to all pregnant women from 28 weeks, per SBP note 18) or the antibody (nirsevimab or clesrovimab) for the baby. The societies do not recommend both for a healthy term baby, but do recommend the antibody even after maternal vaccination when the mother is immunocompromised, the birth came less than 14 days after the maternal dose, the baby is premature, or has a listed high-risk condition. The feature needs to know whether and when the mother was vaccinated before suggesting the antibody (open question for the orchestrator: how and whether to ask). Other pregnancy vaccines that protect the newborn (dTpa from 20 weeks, influenza, covid-19) are not modelled.
- **Other:** breastfeeding mothers of babies under 6 months receiving yellow fever (stop breastfeeding 10 days, SBP); HPV for sexual-violence victims, PrEP users and recurrent respiratory papillomatosis; health workers; adolescent pregnancy; second-season RSV antibody at 12-23 months for high-risk children (SBP, SBIm); extra PCV20/PCV15 doses for children under 6 already vaccinated with PCV10 (SBP, SBIm). Not modelled.

## 9. Sanity checks

Done by hand on the table in section 4, then repeated with a throwaway script in the agent's scratch folder (not committed).

| Check | Result |
|---|---|
| JSON parses; top-level keys `schemaVersion, profile, generatedOn, sources, vaccines, doses` in that order; every dose has the 13 keys in the brief's order | pass |
| Every `doseId` unique; every `vaccineKey` exists in `vaccines` | pass (66 unique ids) |
| `earliestAgeDays <= recommendedAgeDays` for every dose; `recommendedAgeDays <= latestAgeDays` when `latestAgeDays` is set | pass (66/66) |
| For the 42 (dose, previous dose) pairs of section 4: recommended age strictly increases; `earliest(dose) >= earliest(previous) + minInterval`; `recommended(dose) - recommended(previous) >= minInterval` | pass (42/42) |
| Every dose with a `minIntervalDaysFromPrevious` has a previous dose in that list | pass |
| `network` is `public` exactly when `pni` is in `sources` | pass (38 public, 28 private) |
| `needsReview` is true exactly when `needsReviewReason` is set | pass (23) |
| Every `alternativeGroup` has at least two members | pass (15 groups) |
| Every `label` and `notes` has non-empty `pt-BR` and `en` | pass |
| Day conversions match section 3 rule 2 (spot-checked 2, 4, 6, 9, 12, 15, 18 months, 4, 5, 9, 10, 11, 14, 16 years and every "11 meses e 29 dias" limit) | pass |
| PNI catch-up limits in section 5.3 equal the `latestAgeDays` of the PNI entries | pass |
| Rotavirus: dose 1 latest 364, dose 2 and 3 latest 730, dose 2 earliest 106 | pass |
| No dose is listed for a population outside routine (indigenous, CRIE, premature, travel) | pass |
| Cross-check against Rio (X1): same doses and maximum ages as P1/P3/P5/P6, except Rio uses tetraviral at 15 months (local choice, allowed by P1 note 5) and lists HPV to 19 y 11 m 29 d (the 15-19 catch-up strategy the PNI leaves to each state) | consistent |

## 10. Schema v1 gaps (for a later schema version; not done here)

1. **Coverage (`covers`)**: a dose of a combined product should list the slots it fills (section 5.4).
2. **Recurrence**: yearly influenza (and periodic covid-19 doses for special groups) need a repeat rule instead of a placeholder age.
3. **Conditions**: doses that apply only in some cases (yellow fever booster, Hib booster, ACWY at 16, RSV antibody, hepatitis B stand-alone doses) need a condition field.
4. **Product**: doses tied to a product (RV5 3rd dose, Comirnaty 3rd dose, PCV10 or PCV20 at 4 months) need a product field.
5. **Per-source windows**: one dose shared by several sources can have different windows (VIP 2nd booster: SUS 4 to under 5 years, societies 4-6 years); schema v1 holds one window per entry.
6. **More product keys**: pentavalente acelular (DTPa-VIP-Hib), DTPa-VIP, dTpa-VIP and hepatitis A+B are common private products and have no key yet.

## 11. Schema v2 (2026-10-22, with the vaccinations feature)

What changed in `code/api/data/vaccine-schedule.br.json` (scripted, canonical format kept; every v1 field, value, `needsReview` flag and reason is unchanged, and the 66 v1 doses keep their order):
- `schemaVersion` is 2. Every dose has five new fields, always present: `previousDoseIds`, `covers`, `recurrence`, `condition`, `recordOnly`.
- **`previousDoseIds`** (new; v1 kept it only in the "After" column of section 4): the doses `minIntervalDaysFromPrevious` counts from; when the previous slot has alternatives both are listed (`penta-2` after `penta-1` or `hexavalente-1`; `dtp-reforco-1` after `penta-3` or `hexavalente-3`; `pneumo-conjugada-reforco` after dose 2 or the private dose 3; `meningo-acwy-reforco-1` after `meningo-c-2` or `meningo-acwy-2`; `hepatite-a-2` after either first hepatitis A dose). The engine counts from the latest given one.
- **`covers`** (gap 1 of section 10): `penta-1` covers `hepatite-b-2`, `penta-3` covers `hepatite-b-3`; `hexavalente-1` covers `vip-1` and `hepatite-b-2`, `hexavalente-2` covers `vip-2`, `hexavalente-3` covers `vip-3` and `hepatite-b-3` (section 5.4). One recorded combined dose marks the covered doses given and they are never reminded.
- **`recordOnly`** combined products (gap 6, from section 5.4), doses the family can record that are never a slot of their own: `tetraviral-1-sociedades` (12 months, covers `triplice-viral-1` + `varicela-1-sociedades`), `tetraviral-15m` (SUS at 15 months, covers `triplice-viral-2` + `varicela-1`), `tetraviral-2-sociedades` (covers `triplice-viral-2` + `varicela-2-sociedades`), and two new vaccines with one dose each: `penta-acelular` / `penta-acelular-reforco` (DTPa-VIP-Hib at 15 months, covers `dtpa-reforco-1`, `hib-reforco`, `vip-reforco-1`) and `dtpa-vip` / `dtpa-vip-reforco` (SBIm, 4-6 years, covers `dtpa-reforco-2`, `vip-reforco-2`). Hepatitis A+B (catch-up only) is still not modelled.
- **`recurrence`** (gap 2): `influenza-anual` and `influenza-anual-sociedades` have `{"everyDays": 365, "startAgeDays": 365}` with `previousDoseIds` = the two first-season doses: due from 1 year, then a year after the latest influenza dose; the 365-day age is no longer a placeholder (their review reasons still describe the campaign timing).
- **`condition`** (gap 3, RSV only): `vsr-nirsevimabe-1` has `rsv-maternal-vaccination-unknown-or-no`: it applies unless the family answered that the mother got the RSV vaccine in pregnancy. The other conditional doses keep `condition: null` and their review flag.
- Counts: 28 vaccines (2 new), 71 doses (66 scheduled as before + 5 record-only), 23 with `needsReview` (unchanged).
- Gaps still open: product fields (gap 4), per-source windows (gap 5), conditions other than RSV, hepatitis A+B.
- Validation (`VaccineScheduleValidator`, at API startup and in `VaccineScheduleDataTests`) and the yearly update procedure are in docs/design/18-vaccines.md sections 1 and 8.
