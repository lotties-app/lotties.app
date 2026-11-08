# Lotties: resumo para revisão jurídica (LGPD)

Documento para levar a um advogado ou especialista em privacidade (Brasil). **Não é parecer jurídico**: junta o que o
aplicativo faz, o que a política pública afirma e as perguntas que o repositório não consegue responder. Os fatos vêm
do código e do kit de implantação (`docs/design/33-privacy-audit.md`, "a auditoria"); a lista de itens que só o
responsável pode confirmar está em `docs/PRIVACY-OWNER-CHECKLIST.md`. Política pública: https://lotties.app/privacy
(português e inglês).

## 1. O produto em um parágrafo

Lotties é um aplicativo gratuito e de código aberto (AGPL-3.0) para pais e cuidadores registrarem a rotina de um bebê:
sono, mamadas, fraldas, remédios, crescimento, vacinas, consultas, anotações. Funciona no navegador (PWA) e em apps
iOS/Android (em preparação), guarda uma cópia no aparelho e sincroniza com um servidor. Quem cria a conta convida outras
pessoas (co-responsável, babá, avós) e, opcionalmente, um médico, com permissões por papel. Há integrações opcionais:
assistente de voz Alexa, servidor MCP para assistentes de IA, avisos por push, detector de choro no aparelho
(microfone, o áudio não é gravado nem enviado) e busca de endereço de profissionais.

## 2. Quem trata os dados e onde

- Responsável pelo serviço: o dono do projeto; **se será pessoa física ou empresa ainda está por decidir** (pergunta 2).
  O nome publicado na política vem de variáveis de construção ainda não preenchidas (hoje a política mostra "os
  mantenedores do projeto Lotties").
- Hospedagem: cluster Kubernetes em um home lab do responsável (aplicação, API, banco PostgreSQL, Keycloak), **não** em
  provedor de nuvem. Local físico e país: a confirmar pelo responsável (item C1 do checklist).
- Cloudflare: DNS e proxy do domínio `lotties.app` e `auth.lotties.app` com túnel para o home lab. **Confirmado nesta
  revisão** (cabeçalhos das respostas mostram `server: cloudflare`; o túnel publica as duas rotas). Portanto toda a
  comunicação, inclusive dados de saúde em trânsito, passa pela Cloudflare (item C2). A auditoria ainda diz "a
  confirmar": atualizar.
- Contas de acesso: Keycloak próprio (e-mail, nome, senha com hash). Compartilhado com outros aplicativos do
  responsável (a confirmar isolamento por realm).
- Sem anúncios, sem telemetria, sem SDK de analytics ou de relatório de falhas, sem fontes ou CDN de terceiros, sem
  cookies do aplicativo (o Keycloak usa cookies de sessão na própria origem).

## 3. Quais dados

Todos sobre uma criança (menor de 12 anos), inseridos por adultos:

- **Dados de saúde (sensíveis, LGPD art. 5, II e art. 11):** sono, mamadas, fraldas, remédios e doses informadas pelos
  pais, receitas, peso e altura, vacinas, consultas, sintomas, temperaturas e anotações, notas de médico. Por voz (Alexa) podem ser registrados sintomas (de uma lista), temperaturas e "uma dose de medicamento foi dada", e lidos os lembretes de remédio cadastrados. Nome e data de nascimento
  do bebê.
- **Dados das pessoas:** nome de exibição, e-mail da conta no Keycloak (o aplicativo não lê o e-mail), papel na família,
  profissional de saúde (nome, especialidade, registro profissional **autodeclarado, sem verificação**).
- **Dados técnicos:** endereço IP e navegador nos registros do nginx/Traefik/Keycloak (retenção a confirmar).
- **Dados de terceiros** digitados pelo usuário: contatos de médicos e clínicas, vacina da mãe.
- Nenhuma foto, arquivo ou áudio do bebê é coletado.

## 4. Fluxos para fora do servidor do responsável

| Destinatário | O que sai | Quando |
| --- | --- | --- |
| Amazon (Alexa) | a voz é gravada e transcrita pela Amazon; o Lotties recebe a intenção e os valores. A **resposta falada** devolvida pelo Lotties **não contém o nome do bebê por padrão** (minimização, LGPD art. 6, III e art. 46, § 2: o nome só entra se o responsável ativar "Falar o nome do bebê nas respostas"), **não contém o nome de um medicamento por padrão** (só se o responsável ativar "Falar o nome dos remédios nas respostas"; **nunca** quantidade, dose, horários ou intervalo) e nunca leva texto digitado por pessoas nem dados de médicos ou clínicas (sem nome, clínica, telefone, endereço, e-mail, registro, título ou local de consulta, fórmula ou anotação): do médico, no máximo a **especialidade** do próximo compromisso ("com pediatra"), quando o texto digitado é uma especialidade conhecida. Pode conter horários e quantidades de mamadas e sono, contagem de fraldas, data e hora do próximo compromisso, vacinas pendentes (e previsões e médias), o que acabou de ser registrado por voz (banho, temperatura, sintoma de uma lista, "uma dose de medicamento foi dada", como a pessoa disse, sem julgamento nem orientação) e o número de lembretes de remédio cadastrados pela família que estão pendentes (sempre com o aviso "não são recomendações do Lotties"). A Amazon também guarda os tokens da conta vinculada | só com a skill ativada e a conta vinculada pelo usuário |
| Serviços de push do navegador (Google, Mozilla, Apple, Microsoft) | endpoint do navegador e uma mensagem cifrada que eles não leem | só com notificações ativadas |
| BrasilAPI, ViaCEP, OpenStreetMap Nominatim | o CEP ou o texto digitado, a partir do IP do servidor; nada sobre bebê ou usuário | quando o usuário aperta "buscar endereço" |
| Relay de e-mail do Keycloak (se houver) | o e-mail da conta e as mensagens de verificação/senha | a confirmar (C6) |
| Cloudflare | todo o tráfego do site (proxy), ver item 2 | sempre |
| Lojas (Apple, Google) | estatísticas e relatórios de falha agregados que as lojas já recebem | só nos apps publicados |
| Assistentes de IA (MCP) | quando o usuário conecta um cliente (por exemplo o Claude), esse serviço recebe as respostas das ferramentas (registros recentes, sem o nome do bebê por padrão; o nome só vai se o responsável ativar a opção, e nunca texto digitado por pessoas) | só com o servidor MCP ativado e o cliente conectado pelo usuário |

## 5. Bases legais propostas (a validar)

- Execução do serviço (art. 7, V): conta e registros.
- Consentimento específico (art. 11, I): dados de saúde. **Desde 2026-10-27 o aplicativo pede um consentimento
  separado e destacado** (docs/design/38-consent-and-terms.md; lacunas G3 e G6 fechadas no repositório): cada pessoa
  (dono, pai ou cuidador convidado, médico) aceita por si, antes de qualquer dado de bebê, os Termos de Uso e a Política
  da versão em vigor e declara ser pai, mãe ou responsável legal da criança ou um adulto autorizado por eles. O
  servidor recusa qualquer rota de bebê (403 `consent_required`), os lembretes, a Alexa e o MCP sem ele. Guarda-se: id
  do usuário, versão, data e hora, idioma e a condição declarada (sem IP), com histórico, apagados junto com a conta.
  Mudança relevante pede novo aceite; mudança pequena mostra um aviso. Os textos (tela, aviso de teste, consentimentos
  opcionais, Termos de Uso) estão em `docs/CONSENT-AND-TERMS-DRAFT.md` e **precisam da sua revisão**.
- Consentimento específico para o convite de médico e para recursos opcionais (push, Alexa, detector de choro).
- Legítimo interesse (art. 7, IX): logs técnicos, nunca para dado sensível.
- Obrigação legal quando aplicável.

## 6. Direitos e retenção

- Exclusão de conta: apaga bebês sem outro membro e tudo que aponta para o usuário (teste automatizado por tabela);
  registros apagados pelo usuário ficam só marcados como apagados até a criança ser apagada (não há rotina de
  expurgo); a conta Keycloak é removida por uma conta de serviço que o responsável ainda precisa criar.
- Exportação: dono e pai/mãe exportam o bebê completo; qualquer pessoa baixa os dados que o aparelho guarda; cuidadores,
  visualizadores e médicos têm acesso por tela e por pedido ao contato (pedido manual).
- Retenção: "enquanto necessário" na maior parte; prazos numéricos pendentes (logs, log de acesso de médico, convites,
  backups).
- Backups: cópia externa criptografada agendada e `pg_dump` antes de migrações, mais no-break; criptografia em repouso do
  banco a confirmar.

## 7. Perguntas ao advogado

1. **Consentimento para dados de saúde de crianças (art. 11 e art. 14).** *(Atualizado: a tela de consentimento e o
   registro existem, ver seção 5 e os itens 13 a 18; a pergunta passa a ser se bastam.)* A base "execução de contrato +
   consentimento implícito ao registrar" basta, ou é preciso um consentimento específico e destacado de pai/responsável,
   com registro (por exemplo, ação obrigatória de Termos no Keycloak ou tela de primeiro uso)? O aplicativo deve exigir
   que quem cria o bebê declare ser pai, mãe ou responsável?
2. **Controlador pessoa física ou empresa.** Qual formato publicar (nome e CPF/CNPJ), e como isso interage com Apple
   (conta individual ou organização) e Google Play (testers para conta pessoal)? Aplica-se o regime de agente de
   tratamento de pequeno porte, dado que há dado sensível de crianças? É necessário nomear **encarregado** (DPO)?
3. **Transferências internacionais (art. 33).** Amazon (Alexa), serviços de push, Cloudflare e Nominatim: a hipótese do
   art. 33, IX é suficiente? Algo exigido pela Resolução CD/ANPD nº 19/2024 (cláusulas-padrão) para cada um?
4. **Cloudflare como proxy.** Ela é operadora? Basta citá-la na tabela de destinatários ou é preciso algum contrato
   específico?
5. **Retenção.** Quais prazos publicar para logs, log de acesso de médico, convites, registros apagados, usuários
   anonimizados e backups? É aceitável não haver expurgo automático de registros apagados?
6. **Médico autodeclarado.** O profissional se cadastra sem verificação de registro. Que cuidado o texto deve ter?
7. **Dados de outras pessoas** digitados pelo usuário (contatos de médicos, vacina da mãe): a cláusula que torna o
   usuário responsável é suficiente?
8. **Idade mínima** de quem abre a conta: o texto diz "para adultos", nada verifica.
9. **Seção "Comparações com outros bebês" (ainda não ativa).** Descrever na política um recurso que não existe é
   aceitável, ou é melhor retirar até a implementação? Qual seria o consentimento da tela futura e o limite honesto da
   anonimização (art. 12)?
10. **Comunicação de incidente e mudanças da política.** O texto promete avisar a ANPD e os usuários (art. 48) e anunciar
    mudanças significativas antes de valerem. O que é razoável prometer para um projeto sem equipe?
11. **Assistentes (Alexa e IA).** A resposta falada leva dado de saúde à Amazon, e as respostas do servidor MCP podem
    levar a um assistente de IA escolhido pelo usuário. Esse fluxo, sempre iniciado pelo usuário, exige consentimento
    adicional além do texto da política? Como tratar o fato de o assistente de IA poder reter o conteúdo?
12. **Código aberto e termos.** *(Atualizado: os Termos de Uso existem em `/terms`, rascunho a revisar; ver itens 13 a
    18.)* A política ainda precisa de uma cláusula de limitação de responsabilidade para os avisos "não é dispositivo
    médico" além do que já está escrito?
13. **Consentimento único com declaração de "pai, responsável ou adulto autorizado".** Um consentimento principal com
    essa declaração basta para o art. 11, I e o art. 14, §1, ou um cuidador ou médico não deve consentir pela criança
    (vale o consentimento do pai ou responsável dado em outro lugar)? (rascunho, pergunta 1)
14. **A frase sobre risco de vazamento.** Como redigi-la para ser honesta sem ser lida como uma renúncia que a lei não
    permite? (rascunho, pergunta 2)
15. **Limite de responsabilidade para um serviço gratuito em teste** (cláusula 12 dos Termos) e se o CDC se aplica.
    (rascunho, pergunta 3)
16. **Prova mínima do consentimento após a exclusão da conta.** Hoje o registro e o histórico são apagados com a conta.
    Vale guardar uma prova mínima depois, e por quanto tempo? (rascunho, pergunta 4)
17. **O aviso de "fase de teste" muda algum dever** (art. 46, art. 48) enquanto dados reais são tratados? (rascunho,
    pergunta 5)
18. **Foro e lei aplicável**, e se um e-mail e uma empresa ou CPF precisam aparecer nos Termos. A cláusula 14 diz hoje só
    "lei brasileira"; o foro ficou de fora até a sua resposta. (rascunho, pergunta 6)
19. **Banco de dados próprio do usuário** (texto **retido**, ainda fora da política publicada; `docs/design/47-bring-your-own-database.md`
    seção 10, auditoria seção 17). Por decisão do responsável (2026-11-08), a produção continua com a política 12 e a
    versão de consentimento `2026-11-06.1`; o texto da política, o consentimento `byo_database` e os fatos ficam em
    `docs/legal-held/byo-database/` e entram juntos no lançamento geral do recurso, como **uma única versão material**
    (todos aceitam de novo). Recurso opcional, por bebê, desligado por padrão e ainda atrás de uma flag: o titular do bebê
    conecta um PostgreSQL dele (Supabase, Neon ou outro, escolhido e contratado por ele, na região que ele escolher) e os
    registros de cuidado do bebê passam a ficar lá; o app e a conta continuam iguais, e a API do Lotties lê e grava
    esses registros lá. Conta, consentimentos, membros, o perfil do bebê e os ajustes ficam no Lotties. Os dados de
    conexão ficam guardados criptografados (AES-256-GCM), mas a chave fica com o operador: o servidor do Lotties e quem
    o opera conseguem abri-los (não é criptografia de ponta a ponta, e a política diz isso). Perguntas, sem resposta
    pressuposta:
    - Qual é o papel do provedor escolhido pelo usuário: operador de quem (do usuário? do Lotties?), um controlador
      separado, ou outra figura? O Lotties não escolhe nem contrata o provedor; isso muda algum dever do Lotties sobre
      ele (art. 39, contrato, instruções)?
    - O usuário passa a ser controlador da própria cópia guardada no banco dele (inclusive dados de saúde de uma criança,
      arts. 11 e 14)? Isso cabe na exceção de tratamento por pessoa natural para fins particulares (art. 4º, I) ou não,
      já que o Lotties continua tratando os dados?
    - O Lotties continua controlador do tratamento que faz (ler e gravar os registros para o app funcionar), como a
      política afirma hoje ("o Lotties continua responsável... pelo que faz com os registros")? A redação está correta e
      suficiente?
    - Transferência internacional (art. 33) quando a região escolhida pelo usuário é fora do Brasil: quem é o
      responsável pela transferência, e a base citada na política (art. 33, IX, "para fazer o que você pediu") serve
      também para este caso?
    - O consentimento opcional `byo_database` (texto retido em `docs/legal-held/byo-database/`, arquivo
      `byoDatabaseConsent.ts` do patch, dado só pelo titular
      do bebê antes de conectar) basta, ou é preciso algo mais (por exemplo, um aviso aos outros membros quando a
      etapa 2 permitir membros)?
    - A mudança da política tinha sido marcada como **menor** (ninguém é afetado sem optar pelo recurso, e quem opta dá
      um consentimento próprio antes de qualquer dado ir ao provedor); o responsável decidiu que ela sai como
      **material**, no lançamento geral. Há algum motivo legal para ser diferente?
    - O texto que diz o que o provedor pode fazer (pausar, limitar, encerrar, perder dados; planos gratuitos sem backup) e
      que "você é responsável por essa conta" é adequado, ou soa como renúncia de responsabilidade que a lei não permite?
    - **Divisão de responsabilidades (pedido do responsável, 2026-11-08; precisa de revisão jurídica).** O responsável
      quer dizer com clareza que o Lotties não responde pelos dados quando o usuário escolhe o próprio banco. Foi escrito
      como divisão de deveres, não como isenção geral: o usuário responde pelo banco e pela conta no provedor
      (disponibilidade, backups e retenção, custos, termos do provedor, configurações de segurança e acesso, credenciais
      e funções que cria, o que mais guardar no mesmo banco, e cópias que ficam lá: cópia antiga, sobras, e os registros
      que continuam lá depois de excluir a conta se ele não pediu a exclusão); o Lotties "não é responsável por perda,
      indisponibilidade, exclusão ou exposição causadas pelo seu banco, pelo seu provedor ou pelas suas configurações lá"
      e "continua responsável pelo que ele mesmo faz" (como envia e guarda os dados de conexão, os próprios servidores e o
      próprio banco); a política retida diz ainda "nada nesta seção limita os direitos que a lei lhe dá". Já aparece,
      em linguagem simples, no guia do usuário (`docs/BYO-DATABASE.md`), na tela de escolha, na etapa de consentimento e
      no guia dentro do app (só visíveis onde o recurso está ligado). Perguntas: a exclusão de responsabilidade pode ser
      limitada pela lei (CDC, se houver relação de consumo; LGPD arts. 42 a 45, responsabilidade e excludentes do art.
      43), então o texto não pode prometer mais do que a lei permite: a redação está dentro desse limite? O art. 43, III
      (culpa exclusiva do titular ou de terceiro) é a base certa para a parte "causadas pelo seu banco, provedor ou
      configurações"? Algo precisa sair, ser suavizado ou ser acrescentado (por exemplo, o dever de segurança do art. 46
      do lado do Lotties)?

## 8. O que levar à reunião

- Este documento e `docs/PRIVACY-OWNER-CHECKLIST.md` (itens C1–C14 respondidos pelo responsável).
- A política publicada, nos dois idiomas, e `docs/design/33-privacy-audit.md`.
- Para as lojas: `docs/design/20-store-readiness.md` seção 3 (respostas de App Privacy e Data safety) e
  `docs/ALEXA-CERTIFICATION.md` seção 3.
- A lista de lacunas abertas (G7 URL de exclusão para o Google Play; G3 consentimento e G6 aviso de mudança de política estão fechadas no repositório e aguardam a sua revisão dos textos: `docs/CONSENT-AND-TERMS-DRAFT.md` e `docs/design/38-consent-and-terms.md`).
