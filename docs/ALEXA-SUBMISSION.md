# Alexa: roteiro final de submissão

Passo a passo para enviar o skill **Lotties** à certificação da Amazon. Quem faz: o dono do projeto (a conta de
desenvolvedor Amazon, o Keycloak e o console são dele). Os textos prontos para colar estão em
[ALEXA-CERTIFICATION.md](ALEXA-CERTIFICATION.md); a configuração técnica em [ALEXA.md](ALEXA.md); a revisão jurídica em
[PRIVACY-LAWYER-BRIEF.md](PRIVACY-LAWYER-BRIEF.md) e [PRIVACY-OWNER-CHECKLIST.md](PRIVACY-OWNER-CHECKLIST.md).

Regra de ouro: **o nome de invocação não muda depois que o skill é certificado e publicado.** Decida o nome na etapa 1.

Tempo esperado: no mínimo 5 dias úteis por rodada (documentação da Amazon); conte com uma ou duas rodadas de ajustes.

---

## Etapa 0. Pré-requisitos (uma vez)

Marque cada item antes de seguir.

- [ ] Conta de desenvolvedor Amazon ativa, com o e-mail que vai receber o resultado da certificação.
- [ ] O produto está no ar na versão mais recente (`https://lotties.app/api/v1/version` mostra a versão que você espera) e
      `Alexa__Enabled` e `Alexa__SkillIds` estão no `deploy/homelab/values/api.yaml`.
- [ ] Os dois modelos atuais (`alexa/interaction-model.pt-BR.json` e `alexa/interaction-model.en-US.json`) estão colados no
      console, com **Build Model** concluído nos dois idiomas. Conferência: Ctrl+F por `BottleTodayIntent` no JSON
      Editor de cada idioma.
- [ ] Endpoint: HTTPS, `https://lotties.app/api/v1/alexa`, opção de certificado **"sub-domain of a domain that has a
      wildcard certificate"** (ver ALEXA.md seção 4; sem isso a Amazon não alcança o servidor).
- [ ] Account linking configurado e testado com uma conta real (ALEXA.md seção 5), com os três URLs de redirect da
      Amazon no cliente `lotties-alexa` do Keycloak.

## Etapa 1. Decidir o nome de invocação

O modelo traz `lotties` (uma palavra, nome de marca). A Amazon só aceita nome de uma palavra com prova de marca; se
recusar, o plano B é `lotties baby`.

Decisão antes de submeter:

- **Tentar `lotties` primeiro (recomendado).** Se a Amazon recusar, troque pelo plano B e submeta de novo. Isso custa uma
  rodada de espera, mas dá o melhor nome.
- **Ir direto em `lotties baby`.** Mais seguro, uma rodada a menos; pior para falar.

Prova de marca para anexar ou citar nas notas do teste: o site https://lotties.app, o domínio, a organização
https://github.com/lotties-app e o nome do produto na política de privacidade. Um registro de marca formal é a prova
mais forte; sem ele, a aprovação do nome de uma palavra é incerta.

**Se for preciso trocar para `lotties baby`** (antes de publicar), faça tudo junto:

1. `invocationName` nos dois modelos (`alexa/interaction-model.*.json`) e colar de novo no console + Build.
2. Frases de exemplo em `docs/ALEXA-CERTIFICATION.md` (trocar "lotties" por "lotties baby" nas seções 1, 2 e 6).
3. Exemplos no app: `code/web/src/i18n/locales/en/assistants.json` e `pt-BR/assistants.json`, e os textos falados de
   boas-vindas e ajuda se citarem o nome.
4. Testar de novo as frases de exemplo no simulador (Etapa 5).

Peça-me para fazer os itens 2 e 3 quando decidir.

## Etapa 2. Conta de demonstração para os revisores

Os revisores da Amazon precisam entrar com uma conta Lotties que tenha um bebê e dados. **Nunca use uma conta ou um bebê
de verdade.**

1. Crie um e-mail só para isso (uma caixa que você controla).
2. Em https://lotties.app, "Criar uma conta" com esse e-mail e uma senha longa, sem exigir MFA.
3. No Keycloak (realm `lotties.app`), abra o usuário e deixe **Email verified = On** e **sem ações obrigatórias** (sem
   "Verify email", sem "Update password"), para o revisor não travar no login. Confirme que ele consegue entrar em uma
   janela anônima.
4. No app, crie o bebê **"Demo Baby"** (nome fictício, data de nascimento fictícia, de uns 3 a 5 meses).
5. Deixe o papel dessa conta como **Owner**.
6. Ajuste "Unidades" (Ajustes > Unidades) para **Automático**.
7. Preencha dados para os comandos de consulta terem o que dizer (ver "Dados mínimos" abaixo).
8. **Não deixe um sono aberto.** Se houver um, o comando de janela de sono responde "está dormindo".

### Dados mínimos da conta de demonstração

Para todas as respostas da Alexa terem conteúdo:

| Comando | O que precisa existir |
| --- | --- |
| última mamada, mamadeira hoje, mamadas hoje | pelo menos 2 ou 3 mamadeiras hoje, com quantidade |
| fraldas hoje, fraldas por dia | fraldas em pelo menos **3 dias** diferentes, e algumas hoje |
| próxima janela de sono | uns **7 dias** de sonos (sonecas e noite) e **nenhum sono aberto** |
| próxima mamada, próxima fralda | histórico de mamadas e fraldas dos últimos dias |
| tamanho das últimas mamadeiras | pelo menos 3 mamadeiras nos últimos 14 dias |
| quanto dormiu hoje | pelo menos um sono hoje |
| próxima consulta | uma consulta futura cadastrada |
| vacinas pendentes | o bebê com data de nascimento que gere vacinas pendentes ou em dia |
| por que está chorando | dados recentes de mamada, fralda e sono (e o resultado sempre traz o aviso) |

Atalho (recomendado): o repositório gera um **backup sintético** com 14 dias de dados inventados (56 sonos, 70 mamadeiras, 98 fraldas, nenhum sono aberto) para um bebê fictício chamado **Lia** (nascimento 2026-06-20), que o app importa sem erro:

1. O arquivo já foi gerado em `docs/samples/lotties-demo-backup-lia.json` (essa pasta é ignorada pelo git; não há dado real nele).
2. No app, com a conta de demonstração: **Hub > Import backup**, escolha esse arquivo e confirme. Isso cria o bebê "Lia" com os dados (use-o no lugar de criar "Demo Baby" à mão).
3. Para refazer o arquivo (por exemplo, com datas mais novas), rode no clone:

```bash
LOTTIES_DEMO_BACKUP_OUT=docs/samples/lotties-demo-backup-lia.json dotnet test code/api/tests/Lotties.Api.Tests --filter DemoBackupGenerator
```

   O teste também importa o arquivo no servidor de testes e falha se qualquer registro for recusado. As datas vão de 2026-10-12 a 2026-10-25; para outras datas, mude `FirstDay` e `LastDay` em `code/api/tests/Lotties.Api.Tests/Backups/DemoBackupGenerator.cs`.
4. **Nomes:** use "Lia" (não "Alexa Baby": a resposta falada "Alexa Baby tomou…" acorda a assistente em um aparelho de verdade).
5. As respostas de "hoje" ficam vazias, porque o histórico termina em 2026-10-25. Registre uma mamadeira e uma fralda por voz antes de enviar (ou antes de cada revisão) para as consultas do dia terem o que dizer.

---

## Etapa 3. Textos e imagens da página do skill

No console: **Distribution** > cada idioma (English (US), Portuguese (BR); e English (UK), se mantiver a localidade).

1. **Skill preview**: colar nome, descrição curta, descrição longa, três frases de exemplo e palavras-chave de
   `ALEXA-CERTIFICATION.md` seções 1 e 2. Categoria: Lifestyle (ou Health & Fitness se Lifestyle não existir).
2. **Ícones:** use os dois arquivos prontos em `docs/design/alexa-icons/`:
   - pequeno: `alexa-icon-108.png` (108x108);
   - grande: `alexa-icon-512.png` (512x512).
3. **Privacy policy URL:** `https://lotties.app/privacy`. Abra a página antes e confira o texto (Etapa 4).
4. **Terms of use URL:** deixe em branco.
5. **Notas de versão:** as de `ALEXA-CERTIFICATION.md`.
6. **Availability:** EUA (inglês) e Brasil (português); preço grátis.
7. Salve cada idioma e confira que o botão "Save and continue" passa sem erro.

As três frases de exemplo têm que funcionar **exatamente como escritas** no simulador (Etapa 5).

## Etapa 4. Política de privacidade (a Amazon abre a URL)

Antes de submeter, abra https://lotties.app/privacy e confira:

- [ ] O responsável aparece com **nome e contato reais**. Se ainda mostrar "os mantenedores do projeto Lotties" e o
      rastreador do GitHub, preencha `VITE_PRIVACY_CONTROLLER_NAME`, `VITE_PRIVACY_CONTACT_EMAIL` e
      `VITE_PRIVACY_DPO` no `deploy/homelab/.env` e faça o deploy (peça-me, mando o deploy).
- [ ] A seção sobre a Alexa está lá (âncora `#privacy-sharing-companies`): voz gravada pela Amazon, o que o Lotties
      recebe, a resposta falada com o nome do bebê e fatos do registro, e o token da conta vinculada.
- [ ] A versão e a data aparecem no fim (versão 6 em 2026-10-25, ou a atual).
- [ ] A página abre sem login, em português e em inglês.
- [ ] A denúncia privada de vulnerabilidades está ativada no repositório do GitHub (item C10 do checklist) ou há um
      e-mail de contato.

A revisão do advogado (PRIVACY-LAWYER-BRIEF.md) é a decisão certa **antes de publicar**, mas a Amazon só verifica que a
URL abre, que cobre o uso de dados pelo skill e que há contato.

## Etapa 5. Teste final no simulador

Console > **Test** > "Skill testing is enabled in: Development". Recarregue a página e teste, em **cada idioma**, com a
conta de demonstração vinculada. A lista cobre todas as frases do `ALEXA-CERTIFICATION.md`:

Português (nome do skill sempre, com "ao" quando a frase pede):

- `abrir lotties`
- `diga ao lotties que o bebê dormiu` e `diga ao lotties que o bebê acordou`
- `peça ao lotties para registrar uma mamadeira` e responder `cento e vinte`
- `peça ao lotties para registrar fralda de xixi`
- `pergunte ao lotties quando foi a última mamada`
- `pergunte ao lotties quantas fraldas hoje`
- `pergunte ao lotties quantos mls de mamadeira tomou hoje`
- `pergunte ao lotties quantas mamadas hoje`
- `pergunte ao lotties qual a próxima janela de sono`
- `pergunte ao lotties por que ela está chorando` (tem que terminar com o aviso e os sinais de alerta)
- `peça ao lotties para desfazer o último registro` (deve dizer que nada foi apagado)

English (US): as equivalentes em `ALEXA-CERTIFICATION.md` (`open lotties`, `tell lotties the baby fell asleep`, `ask
lotties when was the last feed`, `tell lotties to log a bottle` + `one hundred twenty`, `ask lotties how many diapers
today`, `ask lotties how much did she drink today`, `ask lotties when is the next nap window`, `ask lotties why is she
crying`, `tell lotties to undo the last thing`).

Confira também:

- [ ] Cada resposta fala em horário local correto e na unidade da conta.
- [ ] Nada vira uma pergunta como "Quanto?" quando você fez uma pergunta de consulta.
- [ ] Sem sono aberto sobrando ao fim (diga `acordou` se deixou algum).
- [ ] No app, os registros criados mostram "Adicionado pela Alexa" e o pedido de exclusão mostra o aviso com **Excluir**
      e **Manter**.
- [ ] Um teste com um papel **Viewer** recusa a escrita, e uma conta com dois bebês pede para escolher em Ajustes >
      Assistentes de voz.

## Etapa 6. Instruções para os revisores

Console > **Certification** > **Submission** (ou o formulário "Testing Instructions"). Cole o texto de
`ALEXA-CERTIFICATION.md` seção 6 e preencha:

- **E-mail da conta de demonstração e senha:** somente nos campos de conta de teste do console, **nunca** neste
  repositório, em issue ou em print público.
- Informe que o skill exige vincular a conta, que abrir o skill e a ajuda funcionam sem vincular, e que os comandos de
  escrita dizem na tela do app "Adicionado pela Alexa".
- Informe que o skill **nunca exclui registros** (só pede, e a pessoa aprova no app) e que **não dá conselho médico,
  dose nem diagnóstico**.

## Etapa 7. Validação e envio

Console > **Certification**:

1. **Validation:** execute. Corrija tudo que for erro (avisos de "possível problema" podem ser lidos e justificados).
   Erros comuns: frase de exemplo que não funciona, endpoint inacessível, ícone com tamanho errado, política de
   privacidade que não abre.
2. **Functional test:** execute o teste automatizado se o console oferecer.
3. **Submission:** responda a **Privacy & Compliance** com a tabela da seção 3 de `ALEXA-CERTIFICATION.md`:
   - compras: não;
   - coleta informação pessoal: sim;
   - voltado a crianças: **não** (é usado por pais);
   - anúncios: não;
   - exportação: padrão.
4. Revise e clique em **Submit for review**.
5. Anote a data do envio e acompanhe o e-mail da conta de desenvolvedor.

## Etapa 8. Se for recusado

A Amazon responde por e-mail e no console, dizendo o que falhou. Os motivos mais prováveis para este skill:

| Motivo provável | O que fazer |
| --- | --- |
| nome de invocação de uma palavra sem prova de marca | trocar para `lotties baby` (Etapa 1) e reenviar |
| frase de exemplo não funciona como escrita | reescrever a frase no console para a que o simulador aceita |
| conta de demonstração não entra, ou sem dados | consertar a conta (Etapa 2) e responder com a nova senha no campo de teste |
| política de privacidade sem a parte da Alexa, ou sem contato | completar a política (Etapa 4) e reenviar |
| resposta de saúde percebida como conselho médico | confirmar que o texto de choro traz o aviso e os sinais de alerta; mostrar nas notas que o skill nunca dá dose ou diagnóstico |
| vinculação de conta falha | conferir os três redirect URLs no Keycloak e o `Client ID`/secret do console |

Cada rodada recomeça a contagem de dias úteis. Guarde o texto de cada rejeição na issue do projeto (sem credenciais).

## Etapa 9. Depois de aprovado

- [ ] O skill passa para **Live**; ele não pode mais mudar o nome de invocação.
- [ ] Atualizar o app: link do skill na página "Assistentes de voz" e, se quiser, na página inicial
      (`code/web/src/i18n/locales/*/assistants.json`). Peça-me.
- [ ] Testar o vínculo de conta com uma conta nova real, em um aparelho real (app Alexa).
- [ ] Atualizar `docs/ALEXA.md` e a lista de pendências do projeto (board) com a data de aprovação.
- [ ] A partir daí, mudanças no modelo ou no endpoint exigem reenviar para certificação; combine mudanças pequenas em uma
      só rodada.

## Lista de conferência rápida (cole no dia da submissão)

- [ ] Nome decidido: `lotties` ou `lotties baby`
- [ ] Modelos atuais colados e construídos (pt-BR e en-US)
- [ ] Endpoint com a opção de certificado de curinga
- [ ] Conta de demonstração com dados, sem sono aberto, e-mail verificado, sem ações obrigatórias
- [ ] Textos e frases de exemplo testados no simulador, nos dois idiomas
- [ ] Ícones 108x108 e 512x512 enviados
- [ ] Política de privacidade aberta e com responsável e contato reais
- [ ] Credenciais só no campo de teste do console
- [ ] Validation sem erros
- [ ] Submit for review
