# Alexa skill: certification texts

Copy-paste texts for the Alexa developer console (Distribution and Certification tabs). Setup is in
[ALEXA.md](ALEXA.md); the privacy facts behind the answers are in
[design/33-privacy-audit.md](design/33-privacy-audit.md). Rules this file follows: no health claims, no doses,
medicine reminders described only as the family's own registered reminders, nothing the code does not do, the invocation name is the one in the interaction models.

Status: **draft**. Every example phrase was checked against `alexa/interaction-model.*.json` on 2026-10-27 (a test keeps the
models valid); recheck after any model change: every example phrase has to work exactly as written.

Console limits change; use the character counters in the console and shorten if one field complains.

## 0. Before submitting

- **Invocation name.** The models ship with the one-word `lotties` (needs Amazon's brand approval: submit evidence that
  you own the brand, for example the site https://lotties.app and the GitHub organization `lotties-app`; a trademark
  registration is the strongest). If Amazon rejects it, switch to `lotties baby` in both models, rebuild, and update the
  example phrases below (replace "lotties" by "lotties baby"). The invocation name **cannot be changed after the skill is
  certified and published**, so settle it before the first submission.
- Privacy build values and the lawyer's review of the policy: [PRIVACY-OWNER-CHECKLIST.md](PRIVACY-OWNER-CHECKLIST.md).
- A test Lotties account for the reviewers (section 6), never a real family's.
- Icons: `docs/design/icons` (108x108 small, 512x512 large PNG; if the folder has no PNG at those sizes, export them
  from the SVG/PNG there).

## 1. Skill preview, English (US) (also fill English (UK) with the same text if that locale is kept)

- **Skill name:** `Lotties`
- **Invocation name:** `lotties`
- **One sentence description (summary):**
  Log your baby's sleep, feeds and diapers by voice, and hear what you logged.
- **Detailed description:**

  ```
  Lotties is a free, open source baby tracker for parents. With this skill you can keep your hands on your baby and still keep the record up to date: say what happened and Lotties saves it in your family's Lotties account, so you and your co-parent see the same day.

  Log by voice: the baby fell asleep or woke up, a bottle with the amount, nursing, a diaper (wet, dirty or both), a bath, tummy time, a temperature reading, belly pain, spit-up, teething, a symptom or a milestone from a list, nail trims, skin care and outdoor time.

  Ask about the day: when was the last feed, how long has she been sleeping, how many diapers today, how many diapers a day on average, how much she slept today, how much she drank in bottles today, how many feeds today, how old she is, a summary of the day or the week, the next appointment, and which vaccines are due.

  Medicines: tell Lotties you gave a medicine you registered in the app, and ask for your medicine reminders. These are the reminders you registered yourself, not recommendations from Lotties: it never suggests, checks or says a dose.

  Look ahead from your own history: when the next nap window may be, when the next feed or diaper change may come, and how big her last bottles were. These are patterns from what you logged, not advice.

  You need a Lotties account with a baby (sign up free at lotties.app) and you link it once in the Alexa app. Entries made by voice are marked as added by Alexa in the app.

  Lotties keeps a record and shows patterns. It does not diagnose, treat or give medical advice and it is not a medical device. For any health concern talk to your pediatrician; in an emergency call your local emergency number.
  ```

- **Example phrases (3, each must work exactly and start the way Alexa expects):**
  1. `Alexa, open lotties`
  2. `Alexa, tell lotties the baby fell asleep`
  3. `Alexa, ask lotties when was the last feed`

  More that are safe to show in the app/help (not in the console list): `Alexa, ask lotties how many diapers today`,
  `Alexa, tell lotties to log a bottle`, `Alexa, ask lotties when is the next nap window`, `Alexa, tell lotties to log a bath`, `Alexa, ask lotties is any medicine due`.
- **Keywords:** baby, newborn, parenting, sleep tracker, feeding tracker, diaper tracker, baby log, nap, bottle, nursing
- **Category:** Lifestyle (or Health & Fitness if Lifestyle is not offered; the description makes no health claims)
- **Privacy policy URL:** https://lotties.app/privacy
- **Terms of use URL:** optional (leave empty unless a terms page exists)
- **What's new (version notes):** First release: log sleep, bottles, nursing and diapers by voice; ask about the day.

## 2. Skill preview, Portuguese (BR)

- **Nome do skill:** `Lotties`
- **Nome de invocação:** `lotties`
- **Descrição curta:**
  Registre sono, mamadas e fraldas do bebê por voz e ouça o que foi registrado.
- **Descrição detalhada:**

  ```
  O Lotties é um acompanhamento de rotina do bebê, gratuito e de código aberto. Com este skill você mantém as mãos no bebê e o registro em dia: diga o que aconteceu e o Lotties guarda na conta da família, para você e quem cuida junto verem o mesmo dia.

  Registre por voz: o bebê dormiu ou acordou, uma mamadeira com a quantidade, amamentação, uma fralda (xixi, cocô ou os dois), banho, tempo de bruços, temperatura, dor de barriga, regurgitação, dentição, um sintoma ou marco de uma lista, corte de unhas, cuidados com a pele e passeio.

  Pergunte sobre o dia: quando foi a última mamada, há quanto tempo ela está dormindo, quantas fraldas hoje, quantas fraldas por dia em média, quanto ela dormiu hoje, quanto tomou de mamadeira hoje, quantas mamadas hoje, a idade do bebê, o resumo do dia ou da semana, a próxima consulta e quais vacinas estão pendentes.

  Remédios: diga ao Lotties que você deu um remédio que cadastrou no app e peça os seus lembretes de remédios. São os lembretes que você mesmo cadastrou, não recomendações do Lotties: ele nunca sugere, confere nem diz uma dose.

  Olhe para frente com o seu próprio histórico: quando pode ser a próxima janela de sono, a próxima mamada ou troca de fralda, e o tamanho das últimas mamadeiras. São padrões do que você registrou, não orientação.

  Você precisa de uma conta Lotties com um bebê (cadastro gratuito em lotties.app) e vincula uma vez no app Alexa. O que for registrado por voz aparece no app como adicionado pela Alexa.

  O Lotties guarda o registro e mostra padrões. Ele não faz diagnóstico, não indica tratamento nem dá orientação médica e não é um dispositivo médico. Para qualquer preocupação com a saúde, fale com o pediatra; em uma emergência, ligue para o número de emergência da sua região.
  ```

- **Frases de exemplo (3):**
  1. `Alexa, abrir lotties`
  2. `Alexa, diga ao lotties que o bebê dormiu`
  3. `Alexa, pergunte ao lotties quando foi a última mamada`

  Outras, para a ajuda do app (fora da lista do console): `Alexa, pergunte ao lotties quantas fraldas hoje`,
  `Alexa, peça ao lotties para registrar uma mamadeira`, `Alexa, pergunte ao lotties qual a próxima janela de sono`.
- **Palavras-chave:** bebê, recém-nascido, maternidade, paternidade, sono do bebê, mamadas, fraldas, diário do bebê, soneca, mamadeira
- **Categoria:** Estilo de vida (ou Saúde e fitness, se a primeira não existir)
- **URL da política de privacidade:** https://lotties.app/privacy (a página abre em português quando o idioma do navegador é pt-BR)
- **Novidades:** Primeira versão: registre sono, mamadeiras, amamentação e fraldas por voz e pergunte sobre o dia.

## 3. Privacy and compliance (answers)

| Question | Answer | Why |
| --- | --- | --- |
| Does this skill allow users to make purchases or spend money? | No | Free; no in-skill purchases |
| Does this skill collect personal information? | **Yes** | With account linking it reads and writes the parent's baby log; spoken answers carry log facts and, **by default, no child name** (the name only if the parent turns on "Say my baby's name in answers") and no free text typed by people (audit section 3) |
| Is this skill directed to or intended for children under 13? | **No** | Used by parents and caregivers; the data is about a child but the user is the adult |
| Does this skill contain advertising? | No | No ads |
| Does the skill use health information? | Yes, user-entered | It reads back the family's own logs; no medical advice, no doses; it can record that a registered medicine was given and read the family's own medicine reminders ("not recommendations from Lotties") |
| Export compliance | Standard (no restricted encryption beyond HTTPS) | |
| Is the skill available in all countries? | Choose per language: US (and UK if kept) for English, Brazil for Portuguese | |
| Account linking required | Yes for commands (the welcome and help work without it) | Linking is the way Alexa knows which family |

Where the policy covers Alexa: https://lotties.app/privacy, section "Who sees your data", "Companies and services that
receive data" (anchor `#privacy-sharing-companies`). It must say, and does: Amazon records and processes the voice;
Lotties receives only the command and its values; the text Lotties sends back for Alexa to speak carries no baby name unless
the parent turned it on, and no free text or names of people; it can carry feed and sleep times, diaper counts, predicted
times, the date and time of the next appointment and due vaccines; Amazon keeps the account-linking token. After the new questions ship, re-read the policy text against the final answers (the worker that
adds them updates the policy; compare before submitting).

## 4. Account linking page (console)

Already configured in [ALEXA.md](ALEXA.md) section 5. For the certification form: authorization code grant, PKCE on,
scope `openid` and `offline_access`, the domain `auth.lotties.app`. Reviewers sign in on the Lotties (Keycloak) login page.

## 5. Distribution: availability and countries

- English: United States (add United Kingdom only if the en-GB locale is kept with the en-US model).
- Portuguese: Brazil.
- Pricing: free. No in-skill purchasing, no subscriptions.

## 6. Testing instructions (for the Amazon reviewers)

Paste this in "Testing Instructions" (adapt the account lines; the real credentials go only in the console field, never in
this repository):

```
Lotties is a baby tracker. Commands need the Alexa account to be linked to a Lotties account; opening the skill and Help work without linking.

1. Test account (a demo family with one baby named "Demo Baby"): sign in with the username and password given in the "Test account" field of this form when the app asks you to link your account (Alexa app > Skills > Your Skills > Dev > Lotties > Enable to use / Link account). The first time you open the Lotties app (https://lotties.app) with this account you will see a consent screen ("Before you start"); accept it (choose "the child's parent or legal guardian", tick the declaration and tap "Accept and continue"). The account used for the test has already accepted it, so the voice commands work; a new account that has not accepted hears "open the Lotties app and accept the terms of use" until it does.
2. Try, after linking:
   - "Alexa, open lotties" (welcome message)
   - "Alexa, tell lotties the baby fell asleep" then "Alexa, tell lotties the baby woke up"
   - "Alexa, tell lotties to log a bottle" (it asks how many milliliters, answer "one hundred twenty")
   - "Alexa, tell lotties to log a wet diaper"
   - "Alexa, ask lotties when was the last feed"
   - "Alexa, ask lotties how many diapers today"
   - "Alexa, ask lotties when is the next nap window"
   - "Alexa, ask lotties how much did she drink today"
   - "Alexa, ask lotties how many feeds today"
   - "Alexa, tell lotties to log a bath"
   - "Alexa, ask lotties is any medicine due" (reminders you registered, not recommendations)
3. The skill logs and reads back what the family recorded. It gives no medical advice, no doses and no diagnosis, and it never deletes records. Medicine commands only record a dose of a medicine registered in the app and read back its reminders; they never suggest or check a dose. Anything it logs is marked "Added by Alexa" in the Lotties app at https://lotties.app (same login).
4. Portuguese (Brazil) works the same: "Alexa, abrir lotties", "Alexa, diga ao lotties que o bebê dormiu".
```

Checklist for the owner: create the demo account with a Parent role on a fake baby ("Demo Baby", no real data), keep one
bottle and a few diapers logged so the read commands have something to say, **open the Lotties app with it once and
accept the consent screen** (docs/design/38-consent-and-terms.md; without it every command answers "open the Lotties app
and accept the terms of use", and the reviewers will see that screen), and put the credentials only in the console's
test-account field.

## 7. Content rules to keep

- Never "monitors", "detects", "keeps your baby healthy", "recommends", "should" or anything about doses. Medicine reminders are always "the reminders you registered", never advice or "what to give".
- The answer to a temperature or a symptom is the fact that it was logged: no "fever", no "normal", no advice.
- The answer to "why is she crying" always carries the not-a-diagnosis sentence and the call-your-pediatrician
  red flags; the console description must not promise that it finds the cause.
- No names of real children, families or doctors in screenshots, descriptions or test accounts.
- Icons and art: the project's own (`docs/design/icons`); credits stay in `CREDITS.md`.

## 8. After certification

- Add the live skill link to the web app's "Voice assistants" page (`code/web/src/i18n/locales/*/assistants.json`) and
  to the landing page if wanted.
- Re-test the account linking with a fresh Lotties account after the skill goes live (the Alexa redirect URLs can add
  a region; keep all of them in the Keycloak client).
