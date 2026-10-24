# Request for permission to cite published numbers (SBP, and SBIm for the vaccine calendar)

Draft for the owner to review, fill in and send. Nothing here is sent by the project. Replace every `[...]`. Find the right
contact on each society's own website (the "Fale conosco" or communications/legal page); this file does not guess addresses.

## Why ask

Lotties is open source (AGPL-3.0) and free. It uses **facts and numbers** from published SBP and SBIm material, never their
text, tables or figures, always with the source named on the public credits page (https://lotties.app/credits). Both
sites carry "todos os direitos reservados" and no reuse licence. Facts are not protected by copyright, but a written
permission closes the question and shows good faith. Silence changes nothing: the project keeps citing facts only.

What we use, so the request is specific (`docs/design/28-age-norms.md`, `docs/design/17-vaccine-schedule-data.md`):

| Source | What we take from it |
|---|---|
| SBP, *Manual de Alimentação: orientações para alimentação do lactente ao adolescente, na escola, na gestante, na prevenção de doenças e segurança alimentar* (2024; https://sbp.com.br/fileadmin/user_upload/24607c-ManAlim-OrientAlim_Lactente_ao_adl_na_escola-gest.pdf) | typical milk volume per feed by age and number of feeds per 24 h, used as a starting estimate for new babies |
| SBP, *Privação de sono na população pediátrica* (2025; https://www.sbp.com.br/pediatria-para-familias/cuidados-com-a-saude/privacao-de-sono-na-populacao-pediatrica/) | recommended total sleep hours per 24 h by age |
| SBP, *Calendário de Vacinação da SBP, Atualização 2026/2027* (Documento Científico nº 56) | which vaccines and doses the SBP recommends and at what ages and minimum intervals, shown as facts and marked as the SBP recommendation (private network) |
| SBIm, *Calendário de vacinação da criança* (current edition) | the same, for SBIm recommendations |

No endorsement is claimed. The app says it is not a medical device and does not give medical advice.

## Português (Brasil)

**Assunto:** Pedido de autorização para citar números publicados pela [SBP / SBIm] no aplicativo gratuito e de código aberto Lotties

Prezados,

Meu nome é [nome], responsável pelo Lotties (https://lotties.app), um aplicativo gratuito e de código aberto (licença
AGPL-3.0, código em [URL do repositório]) para pais e cuidadores registrarem sono, mamadas, fraldas, vacinas e consultas
de seus bebês. O aplicativo não é um dispositivo médico e não oferece aconselhamento médico.

Para dar estimativas iniciais a bebês novos, o aplicativo usa **apenas números e fatos** publicados pela [SBP / SBIm],
sem reproduzir textos, tabelas ou figuras, sempre com a fonte citada em https://lotties.app/credits:

- [lista da tabela acima, só as linhas da entidade a quem escrevo]

Gostaria de pedir a autorização por escrito da [SBP / SBIm] para continuar citando esses números e recomendações com
atribuição, em um projeto sem fins lucrativos, ou, se preferirem, que me indiquem os termos e a pessoa a contatar.
Também aceito qualquer observação sobre como a fonte deve ser citada ou sobre números que devam ser atualizados ou
removidos.

Fico à disposição para mostrar como os dados aparecem no aplicativo.

Atenciosamente,
[nome], [e-mail], [telefone opcional]
[cidade/estado]

## English

**Subject:** Request for permission to cite numbers published by [SBP / SBIm] in the free, open-source app Lotties

Dear [SBP / SBIm] team,

My name is [name], and I maintain Lotties (https://lotties.app), a free, open-source app (AGPL-3.0, source at [repository
URL]) that lets parents and caregivers log their baby's sleep, feeds, diapers, vaccines and appointments. The app is not a
medical device and gives no medical advice.

To give starting estimates to new babies, the app uses **only numbers and facts** published by [SBP / SBIm]. It
reproduces no text, tables or figures, and always names the source at https://lotties.app/credits:

- [rows of the table above for the organisation being asked]

I would like your written permission to keep citing these numbers and recommendations with attribution, in a non-profit
project, or, if you prefer, to be told the terms and whom to contact. Any note on how to cite the source, or on figures
that should be updated or removed, is welcome.

I can show you how the data appears in the app.

Kind regards,
[name], [email], [optional phone]
[city, state]

## After sending

- Save the reply (or the lack of one, with the date sent) next to the licence notes in `docs/design/28-age-norms.md`
  section on licence flags (L1-L5) and `docs/design/17-vaccine-schedule-data.md` (R-DOC-1).
- A written yes: tell Claude to change the licence lines, remove the owner-decision flag, and add the permission to the
  credits text if they asked for it.
- A no, or a request to remove something: tell Claude which numbers; the data files carry a source id per number, so
  removal is mechanical (`needsReview` or delete) and the dependent defaults fall back to the previous guesses.
- SBP and SBIm are separate organisations: send each its own message.
