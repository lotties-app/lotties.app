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
  pais, receitas, peso e altura, vacinas, consultas, sintomas e anotações, notas de médico. Nome e data de nascimento
  do bebê.
- **Dados das pessoas:** nome de exibição, e-mail da conta no Keycloak (o aplicativo não lê o e-mail), papel na família,
  profissional de saúde (nome, especialidade, registro profissional **autodeclarado, sem verificação**).
- **Dados técnicos:** endereço IP e navegador nos registros do nginx/Traefik/Keycloak (retenção a confirmar).
- **Dados de terceiros** digitados pelo usuário: contatos de médicos e clínicas, vacina da mãe.
- Nenhuma foto, arquivo ou áudio do bebê é coletado.

## 4. Fluxos para fora do servidor do responsável

| Destinatário | O que sai | Quando |
| --- | --- | --- |
| Amazon (Alexa) | a voz é gravada e transcrita pela Amazon; o Lotties recebe a intenção e os valores. A **resposta falada** devolvida pelo Lotties pode conter nome do bebê, horários e quantidades de mamadas e sono, contagem de fraldas, próxima consulta, vacinas pendentes (e, nas novas perguntas, previsões e médias). A Amazon também guarda os tokens da conta vinculada | só com a skill ativada e a conta vinculada pelo usuário |
| Serviços de push do navegador (Google, Mozilla, Apple, Microsoft) | endpoint do navegador e uma mensagem cifrada que eles não leem | só com notificações ativadas |
| BrasilAPI, ViaCEP, OpenStreetMap Nominatim | o CEP ou o texto digitado, a partir do IP do servidor; nada sobre bebê ou usuário | quando o usuário aperta "buscar endereço" |
| Relay de e-mail do Keycloak (se houver) | o e-mail da conta e as mensagens de verificação/senha | a confirmar (C6) |
| Cloudflare | todo o tráfego do site (proxy), ver item 2 | sempre |
| Lojas (Apple, Google) | estatísticas e relatórios de falha agregados que as lojas já recebem | só nos apps publicados |
| Assistentes de IA (MCP) | quando o usuário conecta um cliente (por exemplo o Claude), esse serviço recebe as respostas das ferramentas (nome do bebê, registros recentes) | só com o servidor MCP ativado e o cliente conectado pelo usuário |

## 5. Bases legais propostas (a validar)

- Execução do serviço (art. 7, V): conta e registros.
- Consentimento específico (art. 11, I): dados de saúde, "ao registrar a informação". **O aplicativo não pede hoje um
  consentimento separado e destacado** (lacuna G3).
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

1. **Consentimento para dados de saúde de crianças (art. 11 e art. 14).** A base "execução de contrato + consentimento
   implícito ao registrar" basta, ou é preciso um consentimento específico e destacado de pai/responsável, com registro
   (por exemplo, ação obrigatória de Termos no Keycloak ou tela de primeiro uso)? O aplicativo deve exigir que quem cria
   o bebê declare ser pai, mãe ou responsável?
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
12. **Código aberto e termos.** Faltam termos de uso? A política ainda precisa de uma cláusula de limitação de
    responsabilidade para os avisos "não é dispositivo médico" além do que já está escrito?

## 8. O que levar à reunião

- Este documento e `docs/PRIVACY-OWNER-CHECKLIST.md` (itens C1–C14 respondidos pelo responsável).
- A política publicada, nos dois idiomas, e `docs/design/33-privacy-audit.md`.
- Para as lojas: `docs/design/20-store-readiness.md` seção 3 (respostas de App Privacy e Data safety) e
  `docs/ALEXA-CERTIFICATION.md` seção 3.
- A lista de lacunas abertas (G3 consentimento, G6 aviso de mudança de política, G7 URL de exclusão para o Google Play).
