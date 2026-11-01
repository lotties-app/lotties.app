# Alexa: aba Distribution pronta para colar

Cada campo abaixo está em um bloco para copiar. Os números entre parênteses são os caracteres usados e o limite do console. Ordem igual à do console: **Distribution** > cada idioma > Skill Preview; depois **Privacy & Compliance** e **Availability**. O nome de invocação (`lotties`) fica em Build, não aqui. Contexto: [ALEXA-SUBMISSION.md](ALEXA-SUBMISSION.md); textos de origem: [ALEXA-CERTIFICATION.md](ALEXA-CERTIFICATION.md).

Dicas do console:
- Em cada idioma novo, use o botão **Copy from an existing locale** (canto superior direito) para copiar do idioma já preenchido e só ajustar o que muda (por exemplo, English (UK) a partir de English (US)).
- Nas frases de exemplo, o console já mostra `Alexa,` na frente; digite só o que vem depois.
- O **Public Name** pode ter qualquer caixa; use `Lotties`.
- Se o console reclamar de uma frase de exemplo, ela tem que ser exatamente uma frase que o modelo entende (teste no simulador).


---

## English (US)

### Public Name (7/50)

```
Lotties
```

### One Sentence Description (76/160)

```
Log your baby's sleep, feeds and diapers by voice, and hear what you logged.
```

### Detailed Description (1697/4000)

```
Lotties is a free, open source baby tracker for parents. With this skill you can keep your hands on your baby and still keep the record up to date: say what happened and Lotties saves it in your family's Lotties account, so you and your co-parent see the same day.

  Log by voice: the baby fell asleep or woke up, a bottle with the amount, nursing, a diaper (wet, dirty or both), a bath, tummy time, a temperature reading, belly pain, spit-up, teething, a symptom or a milestone from a list, nail trims, skin care and outdoor time.

  Ask about the day: when was the last feed, how long has she been sleeping, how many diapers today, how many diapers a day on average, how much she slept today, how much she drank in bottles today, how many feeds today, how old she is, a summary of the day or the week, the next appointment, and which vaccines are due.

  Medicines: tell Lotties you gave a medicine you registered in the app, and ask for your medicine reminders. These are the reminders you registered yourself, not recommendations from Lotties: it never suggests, checks or says a dose.

  Look ahead from your own history: when the next nap window may be, when the next feed or diaper change may come, and how big her last bottles were. These are patterns from what you logged, not advice.

  You need a Lotties account with a baby (sign up free at lotties.app) and you link it once in the Alexa app. Entries made by voice are marked as added by Alexa in the app.

  Lotties keeps a record and shows patterns. It does not diagnose, treat or give medical advice and it is not a medical device. For any health concern talk to your pediatrician; in an emergency call your local emergency number.
```

### What's new (83)

```
First release: log sleep, bottles, nursing and diapers by voice; ask about the day.
```

### Example Phrases (3)

1. ```open lotties```
2. ```tell lotties the baby fell asleep```
3. ```ask lotties when was the last feed```

### Keywords (104)

```
baby, newborn, parenting, sleep tracker, feeding tracker, diaper tracker, baby log, nap, bottle, nursing
```

### Category

Lifestyle (se Lifestyle não existir, use Health & Fitness)

### Icons

- Small (108x108): `docs/design/alexa-icons/alexa-icon-108.png`
- Large (512x512): `docs/design/alexa-icons/alexa-icon-512.png`

### Privacy Policy URL

```
https://lotties.app/privacy
```

### Terms of Use URL

Deixe em branco.


---

## Portuguese (BR)

### Public Name (7/50)

```
Lotties
```

### One Sentence Description (77/160)

```
Registre sono, mamadas e fraldas do bebê por voz e ouça o que foi registrado.
```

### Detailed Description (1769/4000)

```
O Lotties é um acompanhamento de rotina do bebê, gratuito e de código aberto. Com este skill você mantém as mãos no bebê e o registro em dia: diga o que aconteceu e o Lotties guarda na conta da família, para você e quem cuida junto verem o mesmo dia.

  Registre por voz: o bebê dormiu ou acordou, uma mamadeira com a quantidade, amamentação, uma fralda (xixi, cocô ou os dois), banho, tempo de bruços, temperatura, dor de barriga, regurgitação, dentição, um sintoma ou marco de uma lista, corte de unhas, cuidados com a pele e passeio.

  Pergunte sobre o dia: quando foi a última mamada, há quanto tempo ela está dormindo, quantas fraldas hoje, quantas fraldas por dia em média, quanto ela dormiu hoje, quanto tomou de mamadeira hoje, quantas mamadas hoje, a idade do bebê, o resumo do dia ou da semana, a próxima consulta e quais vacinas estão pendentes.

  Remédios: diga ao Lotties que você deu um remédio que cadastrou no app e peça os seus lembretes de remédios. São os lembretes que você mesmo cadastrou, não recomendações do Lotties: ele nunca sugere, confere nem diz uma dose.

  Olhe para frente com o seu próprio histórico: quando pode ser a próxima janela de sono, a próxima mamada ou troca de fralda, e o tamanho das últimas mamadeiras. São padrões do que você registrou, não orientação.

  Você precisa de uma conta Lotties com um bebê (cadastro gratuito em lotties.app) e vincula uma vez no app Alexa. O que for registrado por voz aparece no app como adicionado pela Alexa.

  O Lotties guarda o registro e mostra padrões. Ele não faz diagnóstico, não indica tratamento nem dá orientação médica e não é um dispositivo médico. Para qualquer preocupação com a saúde, fale com o pediatra; em uma emergência, ligue para o número de emergência da sua região.
```

### What's new (97)

```
Primeira versão: registre sono, mamadeiras, amamentação e fraldas por voz e pergunte sobre o dia.
```

### Example Phrases (3)

1. ```abrir lotties```
2. ```diga ao lotties que o bebê dormiu```
3. ```pergunte ao lotties quando foi a última mamada```

### Keywords (112)

```
bebê, recém-nascido, maternidade, paternidade, sono do bebê, mamadas, fraldas, diário do bebê, soneca, mamadeira
```

### Category

Estilo de vida (se não existir, use Saúde e fitness)

### Icons

- Small (108x108): `docs/design/alexa-icons/alexa-icon-108.png`
- Large (512x512): `docs/design/alexa-icons/alexa-icon-512.png`

### Privacy Policy URL

```
https://lotties.app/privacy
```

### Terms of Use URL

Deixe em branco.


---

## English (UK) (se o idioma existir no skill)

Use **Copy from an existing locale** > English (US). Nada muda, a não ser que a Amazon peça. O modelo de interação en-GB usa o mesmo JSON do en-US (cole o arquivo `alexa/interaction-model.en-US.json` também nele e dê Build).


---

## Privacy & Compliance

| Pergunta | Resposta |
| --- | --- |
| Does this skill allow users to make purchases or spend money? | No |
| Does this skill collect users' personal information? | **Yes** |
| Is this skill directed to or intended for children under 13? | **No** |
| Does this skill contain advertising? | No |
| Export compliance | marque as caixas padrão (sem criptografia restrita além de HTTPS) |
| Privacy Policy URL | https://lotties.app/privacy |

### Testing Instructions (1861/2000)

Colar em inglês (os revisores da Amazon leem em inglês). Credenciais só no campo de conta de teste do console, nunca aqui.

```
Lotties is a baby tracker. Commands need the Alexa account to be linked to a Lotties account; opening the skill and Help work without linking.

1. Test account (a demo family with one baby named "Demo Baby"): sign in with the username and password given in the "Test account" field of this form when the app asks you to link your account (Alexa app > Skills > Your Skills > Dev > Lotties > Enable to use / Link account).
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
5. Daily totals ("how much did she drink today", "how many feeds today") depend on entries of the current day. If the answer says nothing was logged today, first say "Alexa, tell lotties to log a bottle" and answer "one hundred twenty", then ask again.
```

### Test account

E-mail e senha da conta de demonstração (veja ALEXA-SUBMISSION.md, Etapa 2), somente nos campos do console.


---

## Availability

- Países: Estados Unidos (inglês) e Brasil (português). Se mantiver English (UK), adicione o Reino Unido.
- Preço: grátis. Sem compras dentro do skill.
- Publicação: certificação e depois liberar para todos.


## Conferência final

- [ ] Cada campo preenchido nos dois idiomas, sem erro vermelho.
- [ ] As 3 frases de exemplo testadas no simulador, nos dois idiomas.
- [ ] Os dois ícones enviados.
- [ ] A URL de privacidade abre sem login e mostra o responsável e o contato reais.
- [ ] Conta de demonstração testada em uma janela anônima.
