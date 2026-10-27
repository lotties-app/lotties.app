# Consent, beta notice and terms of use: draft texts for the lawyer

**Draft. Not legal advice.** Implemented 2026-10-27 (design 38 section 9): the consent screen, the beta line, the optional sentences, the notice and the terms page show these texts (`code/web/src/i18n/locales/*/consent.json`, `code/web/src/legal/terms.*.ts`); the lawyer's changes go there and raise the consent version. Clause 14 (venue) is not shown until the lawyer decides it. Plain-language texts for the consent screen, the beta notice, the optional consents, the
"policy updated" notice and the terms of use of Lotties, in Brazilian Portuguese (the reference text) and English.
Design: [design/38-consent-and-terms.md](design/38-consent-and-terms.md). Facts behind them: the privacy policy
(`https://lotties.app/privacy`), [design/33-privacy-audit.md](design/33-privacy-audit.md) and
[PRIVACY-LAWYER-BRIEF.md](PRIVACY-LAWYER-BRIEF.md). Words in `[brackets]` are filled from the build settings of the
privacy page (controller name, contact e-mail), never typed twice. Say only what the code does; a change that alters the
meaning of a sentence is a **material** change and raises the consent version.

Points the lawyer should decide are marked **(L)**.

---

## 1. Consent screen (shown once per version, before any baby data)

### pt-BR

**Antes de começar**

O Lotties guarda a rotina de uma criança: sono, mamadas, fraldas, remédios, crescimento, vacinas, consultas e anotações.
Isso é **dado de saúde de uma criança**, e por isso pedimos o seu consentimento de forma separada e clara.

- **Teste.** O Lotties ainda está em fase de teste. Pode ter falhas, ficar fora do ar e **perder dados**. Não use como
  única fonte de nenhuma decisão de saúde: ele não é um dispositivo médico e não dá orientação médica.
- **O que fazemos com os dados.** Usamos só para o serviço funcionar: guardar, sincronizar e mostrar o que você e as
  pessoas que você convidar registram. **Não vendemos os dados, não os usamos para anúncios e não os compartilhamos**
  com terceiros, a não ser os serviços que você mesmo ativar (por exemplo, notificações ou a Alexa).
- **Risco.** Cuidamos dos dados com medidas de segurança, mas **nenhum sistema é totalmente seguro: pode haver
  vazamento**. Se acontecer algo relevante, avisamos você e a autoridade de proteção de dados, como a lei exige.
- **Seus direitos.** Você pode ver, baixar, corrigir e apagar tudo, e retirar este consentimento, a qualquer momento, em
  Ajustes > Privacidade e dados.
- **Quem responde pelos dados:** [responsável]. Contato: [e-mail de privacidade].

**(required)** ☐ Declaro que sou **pai, mãe ou responsável legal** da criança, ou um adulto **autorizado** por eles
(familiar, cuidador ou profissional de saúde), e **consinto** que os dados de saúde da criança sejam tratados para o
funcionamento do Lotties, nos termos da [Política de Privacidade] e dos [Termos de Uso]. **(L)**

[Aceitar e continuar]   [Recusar]

Se recusar, você sai do app e nada sobre uma criança é guardado.

### en

**Before you start**

Lotties keeps a child's routine: sleep, feeds, diapers, medicines, growth, vaccines, appointments and notes. That is
**health data about a child**, so we ask for your consent separately and clearly.

- **Beta.** Lotties is still being tested. It can have bugs, go offline and **lose data**. Do not use it as the only
  source for any health decision: it is not a medical device and gives no medical advice.
- **What we do with the data.** Only what the service needs: store, sync and show what you and the people you invite
  record. **We do not sell the data, use it for ads, or share it** with third parties, other than services you turn on
  yourself (for example notifications or Alexa).
- **Risk.** We protect the data with security measures, but **no system is fully secure: a leak is possible**. If
  something relevant happens, we will tell you and the data protection authority, as the law requires.
- **Your rights.** You can see, download, correct and delete everything, and withdraw this consent, at any time in
  Settings > Privacy and data.
- **Responsible for the data:** [controller]. Contact: [privacy e-mail].

**(required)** ☐ I declare that I am the child's **parent or legal guardian**, or an adult **authorised** by them (a
family member, caregiver or health professional), and I **consent** to the child's health data being processed to run
Lotties, under the [Privacy Policy] and the [Terms of Use]. **(L)**

[Accept and continue]   [Decline]

If you decline you are signed out and nothing about a child is stored.

---

## 2. Beta notice (landing page footer line and sign-up)

- pt-BR: "O Lotties está em fase de teste. Leia os [Termos de Uso]."
- en: "Lotties is in beta. Read the [Terms of Use]."

## 3. Optional consents (each is a switch, off by default; the sentence appears next to it)

| Switch | pt-BR | en |
| --- | --- | --- |
| Push notifications | Ao ativar, o endereço do seu navegador ou aparelho e uma mensagem cifrada passam pelo serviço de notificações do seu navegador (Google, Apple, Mozilla ou Microsoft). | Turning this on sends your browser or device address and an encrypted message through your browser's push service (Google, Apple, Mozilla or Microsoft). |
| Alexa | Ao ativar, a Amazon grava e processa a sua voz e recebe a resposta que o Lotties fala (horários, quantidades e contagens do bebê, sem o nome por padrão). A Amazon guarda o token da conta vinculada. | Turning this on means Amazon records and processes your voice and receives the answer Lotties speaks (times, amounts and counts, without the baby's name by default). Amazon keeps the linked-account token. |
| Assistente de IA (MCP) | Ao conectar, o serviço do seu assistente de IA recebe o que as ferramentas devolvem e pode guardar. Conecte só um assistente em que você confia. | When you connect, your AI assistant's service receives what the tools return and may keep it. Connect only an assistant you trust. |
| Falar o nome do bebê | A resposta, que vai para a Amazon ou para o seu assistente de IA, passa a incluir o nome da criança. | Answers sent to Amazon or your AI assistant will include the child's name. |
| Falar o nome dos remédios | A resposta passa a incluir o nome dos remédios, o que mostra a eles o que a criança toma. | Answers will include medicine names, which tells them what the child takes. |

## 4. "Policy updated" notice (minor changes)

- pt-BR: "Atualizamos a Política de Privacidade e os Termos de Uso em [data]. [Ver o que mudou]"
- en: "We updated the Privacy Policy and the Terms of Use on [date]. [See what changed]"

A **material** change (new data collected, new recipient, a new purpose, a change in rights or in who is responsible)
shows the consent screen again instead.

---

## 5. Terms of use

### pt-BR

**Termos de Uso do Lotties** (versão [versão], [data])

1. **Quem somos.** O Lotties é um aplicativo gratuito e de código aberto (AGPL-3.0) de acompanhamento da rotina de bebês.
   O responsável pelo serviço é [responsável]. Contato: [e-mail de privacidade].
2. **Fase de teste.** O serviço está em teste e é oferecido **"como está"**: pode mudar, falhar, ficar indisponível ou
   ser encerrado, e dados podem ser perdidos. Mantenha cópias do que for importante (há exportação em Hub > Exportar
   dados). Avisaremos com antecedência razoável antes de encerrar o serviço. **(L)**
3. **Quem pode usar.** Maiores de 18 anos. Quem registra dados de uma criança declara ser pai, mãe, responsável legal ou
   adulto autorizado por eles.
4. **Sua conta.** Você responde pelo que acontece na sua conta e pelas pessoas a quem der acesso. Guarde sua senha e
   avise-nos se suspeitar de acesso indevido.
5. **Seus dados.** Os dados que você registra continuam sendo seus. Você nos autoriza a guardá-los, sincronizá-los e
   mostrá-los às pessoas que você escolher, apenas para o serviço funcionar. Como tratamos dados pessoais: Política de
   Privacidade.
6. **Uso aceitável.** Não use o Lotties para algo ilegal, para prejudicar outras pessoas ou o serviço, nem para registrar
   dados de uma criança sem ter o direito de fazê-lo. Não tente acessar dados de outras famílias.
7. **Saúde.** O Lotties **guarda um registro e mostra padrões** do que você anotou. Ele não faz diagnóstico, não indica
   tratamento e **não é um dispositivo médico**. Lembretes de remédios são lembretes do que **você** cadastrou, não
   recomendações do Lotties. Em caso de dúvida sobre a saúde, fale com o pediatra ou o farmacêutico; em emergência, ligue
   para o número de emergência da sua região.
8. **Integrações.** A Alexa, o assistente de IA, as notificações e a busca de endereço são serviços de terceiros, que você
   escolhe ligar; cada um tem as próprias regras.
9. **Segurança e incidentes.** Usamos medidas de segurança adequadas, mas nenhum sistema é totalmente seguro. Se houver um
   incidente de segurança relevante, avisaremos as pessoas afetadas e a ANPD, nos prazos da lei.
10. **Mudanças.** Podemos mudar estes Termos. Mudanças relevantes pedem novo consentimento; as pequenas aparecem como
    aviso.
11. **Encerrar.** Você pode apagar a conta a qualquer momento em Ajustes. Podemos suspender uma conta que descumpra estes
    Termos ou que ponha o serviço ou outras pessoas em risco.
12. **Responsabilidade.** Na medida permitida pela lei, não nos responsabilizamos por perdas decorrentes de falhas,
    indisponibilidade ou uso do serviço em fase de teste, **exceto** em caso de dolo ou culpa grave e nos casos em que a lei
    não permite limitar a responsabilidade (por exemplo, direitos do titular de dados e do consumidor). **(L)**
13. **Código aberto.** O código-fonte está em https://github.com/lotties-app/lotties.app sob a AGPL-3.0; estes Termos não
    limitam os direitos que essa licença lhe dá sobre o código.
14. **Lei e foro.** Lei brasileira; foro [comarca]. **(L)**

### en

**Lotties Terms of Use** (version [version], [date])

1. **Who we are.** Lotties is a free, open source (AGPL-3.0) baby routine tracker. The service is run by [controller].
   Contact: [privacy e-mail].
2. **Beta.** The service is in testing and offered **"as is"**: it can change, fail, be unavailable or be shut down, and
   data can be lost. Keep copies of what matters (Hub > Export data). We will give reasonable notice before shutting the
   service down. **(L)**
3. **Who may use it.** Adults (18+). Whoever records a child's data declares being the child's parent, legal guardian or
   an adult they authorised.
4. **Your account.** You are responsible for what happens in your account and for the people you give access. Keep your
   password safe and tell us if you suspect unauthorised access.
5. **Your data.** The data you record stays yours. You allow us to store it, sync it and show it to the people you choose,
   only to run the service. How we handle personal data: the Privacy Policy.
6. **Acceptable use.** Do not use Lotties for anything illegal, to harm others or the service, or to record a child's data
   without the right to do so. Do not try to reach other families' data.
7. **Health.** Lotties **keeps a record and shows patterns** from what you logged. It does not diagnose, recommend
   treatment or act as a medical device. Medicine reminders are reminders of what **you** registered, not
   recommendations from Lotties. For any health concern, talk to your pediatrician or pharmacist; in an emergency call
   your local emergency number.
8. **Integrations.** Alexa, the AI assistant, notifications and address lookup are third-party services you choose to turn
   on, each with its own rules.
9. **Security and incidents.** We use appropriate security measures, but no system is fully secure. If a relevant security
   incident happens we will tell the people affected and the data protection authority within the legal deadlines.
10. **Changes.** We may change these Terms. Material changes ask for consent again; minor ones show as a notice.
11. **Ending.** You can delete your account at any time in Settings. We may suspend an account that breaks these Terms or
    puts the service or other people at risk.
12. **Liability.** To the extent the law allows, we are not liable for losses from failures, unavailability or use of a
    service in testing, **except** in cases of willful misconduct or gross negligence and where the law does not allow
    limiting liability (for example data-subject and consumer rights). **(L)**
13. **Open source.** The source code is at https://github.com/lotties-app/lotties.app under the AGPL-3.0; these Terms do not
    limit the rights that licence gives you over the code.
14. **Law and venue.** Brazilian law; venue [court district]. **(L)**

---

## 6. Questions for the lawyer (also copied to PRIVACY-LAWYER-BRIEF.md)

1. Is a single core consent with a "parent, guardian or authorised adult" declaration enough for art. 11, I and art. 14,
   §1, or must a caregiver or doctor not consent for the child at all (the parent's consent given elsewhere)?
2. How to word the leak-risk sentence so it is honest without being read as a waiver the law does not allow.
3. The limit-of-liability clause for a free beta service and whether the CDC applies.
4. Whether to keep a minimal proof of consent after the account is deleted, and for how long.
5. Whether the beta notice changes any duty (art. 46, art. 48) while real data is processed.
6. Venue and governing law, and whether an e-mail address and a company or CPF must appear in the Terms.
