import type { PolicyDocument } from './policyTypes';

/*
 * A política de privacidade em português (a versão principal para o Brasil). Os fatos por trás de cada
 * frase: docs/design/33-privacy-audit.md. Uma mudança de sentido aqui pede a mesma mudança em
 * privacy.en.ts, nova versão e data em privacyPolicy.ts e a auditoria atualizada. Links e `{valores}`:
 * policyTypes.ts.
 */
export const privacyPtBR: PolicyDocument = {
  locale: 'pt-BR',
  summary: {
    title: 'Em resumo',
    groups: [
      {
        title: 'O que coletamos',
        items: [
          'Sua conta de acesso: nome, e-mail e senha, guardados pelo nosso próprio servidor de login.',
          'O que você e as pessoas que você convida registram sobre o bebê, inclusive informações de saúde, como remédios e vacinas.',
          'O que o serviço precisa para funcionar: as configurações de lembretes, se você ativá-los, e registros técnicos.',
          'Se você ligar o Monitor de choro: o microfone, analisado só no seu aparelho e nunca gravado; só ficam salvos os períodos de choro detectados.',
        ],
      },
      {
        title: 'O que não fazemos',
        items: [
          'Nada de publicidade, de ferramentas de análise ou rastreamento, nem de venda de dados.',
          'Nada de orientação médica: o Lotties não é um dispositivo médico.',
          'Seus dados só chegam a outras empresas quando você usa um recurso que depende delas, como lembretes ou a Alexa.',
        ],
      },
      {
        title: 'Seus principais direitos',
        items: [
          'Baixar seus dados: [Central > Exportar dados](/hub/export).',
          'Excluir sua conta e seus dados: [Ajustes > Conta e dados](/settings#account).',
          'Perguntar, corrigir ou reclamar: [fale com a gente](#privacy-contact) ou com a ANPD.',
        ],
      },
    ],
  },
  sections: [
    {
      id: 'controller',
      title: 'Quem é o responsável',
      blocks: [
        {
          kind: 'p',
          text: 'O Lotties foi criado para ajudar pais e mães a atravessar a jornada de criar um bebê sem o peso de ferramentas de acompanhamento caras e assinaturas. Ele existe porque acreditamos que toda família merece acesso às mesmas ferramentas que usamos para nossos próprios filhos, livre de barreiras de custo.',
        },
        {
          kind: 'p',
          text: 'Esta política explica como o serviço Lotties, em lotties.app, e os apps para iOS e Android tratam dados pessoais. Responsável por esses dados (o controlador, nos termos da Lei Geral de Proteção de Dados, a LGPD): {controller}.',
        },
        {
          kind: 'p',
          text: 'Contato: {contact}. Encarregado pelo tratamento de dados pessoais: {dpo}.',
        },
        {
          kind: 'p',
          text: 'O Lotties funciona em servidores que o mantenedor opera em um home lab, com equipamento próprio, e não em um provedor de nuvem: o app, o banco de dados e o servidor de login (Keycloak).',
        },
        {
          kind: 'p',
          text: 'O Lotties é software livre e de código aberto (AGPL-3.0). Qualquer pessoa pode rodar a própria cópia a partir do [código-fonte]({repoUrl}). Uma cópia mantida por outra pessoa é responsabilidade de quem a opera, com os próprios termos de privacidade; esta política vale só para lotties.app.',
        },
      ],
    },
    {
      id: 'data',
      title: 'O que coletamos e por quê',
      blocks: [
        {
          kind: 'p',
          text: 'Coletamos apenas o que os recursos que você usa precisam. A tabela mostra cada tipo de informação, o que ela inclui e para que a usamos.',
        },
        {
          kind: 'table',
          id: 'data',
          caption: 'Informações que o Lotties trata',
          columns: ['Informação', 'O que inclui', 'Para que usamos'],
          rows: [
            {
              id: 'account',
              cells: [
                'Sua conta de acesso',
                'Os dados com que você se cadastra no nosso servidor de login (Keycloak), como nome e e-mail, e sua senha, que o Keycloak guarda apenas de forma protegida (um hash irreversível). O servidor do Lotties guarda só um identificador interno e o seu nome de exibição; ele nunca lê o seu e-mail. O app no seu aparelho recebe seu nome e e-mail do servidor de login. Guardamos também a sua escolha de unidades de medida (automática, métrica ou americana), que só muda como as quantidades aparecem para você; os registros continuam em unidades métricas.',
                'Para você entrar nos seus aparelhos e para mostrar seu nome às pessoas com quem você compartilha um bebê.',
              ],
            },
            {
              id: 'babyProfile',
              cells: [
                'O perfil do bebê',
                'Nome e data de nascimento e, se você preencher, dados de vacinação: a rede que vocês usam (pública, ou também particular), as semanas de gestação ao nascer e se a mãe tomou a vacina contra o VSR na gravidez.',
                'Para mostrar idades e a rotina do dia, e o calendário de vacinas adequado ao seu bebê.',
              ],
            },
            {
              id: 'records',
              cells: [
                'Registros do dia a dia',
                'O que você e as pessoas que você convida registram: sono, mamadas e mamadeiras (quantidades, a fórmula usada), fraldas, banhos, tempo de bruços e ao ar livre, choro, marcos do desenvolvimento, as anotações que você faz nos registros, seus próprios tipos de registro e cronômetros em andamento.',
                'É para isso que o app existe: manter o histórico, sincronizá-lo entre aparelhos e pessoas e calcular resumos e estimativas para você.',
              ],
            },
            {
              id: 'health',
              cells: [
                'Informações de saúde do seu bebê',
                'Remédios e receitas que você cadastra e as doses dadas, temperaturas, sintomas, dor de barriga, regurgitação, dentição, peso, comprimento e perímetro cefálico, vacinas (data, local, lote, quem aplicou), consultas (horário, local, médico, anotações, resultado), fórmulas e as notas e sugestões de um médico que você convidou.',
                'Para manter o histórico de saúde do bebê, mostrar os horários de remédios e vacinas a partir do que você cadastrou e enviar os lembretes que você ativar. São dados pessoais sensíveis pela LGPD.',
              ],
            },
            {
              id: 'careProviders',
              cells: [
                'Médicos e clínicas que você salva',
                'Nome, especialidade, registro profissional (como o CRM), clínica, endereço, telefone, WhatsApp, e-mail, site e anotações dos profissionais e locais que você adicionar.',
                'Para ter os contatos à mão e preencher consultas mais rápido.',
              ],
            },
            {
              id: 'doctorProfile',
              cells: [
                'Perfil de profissional de saúde',
                'Se você declarar que é profissional de saúde: o nome que as famílias veem, sua especialidade e seu número de registro. É autodeclarado: o Lotties não verifica.',
                'Para que as famílias que convidam você como médico(a) do bebê saibam quem você é.',
              ],
            },
            {
              id: 'sharing',
              cells: [
                'Compartilhamento e papéis',
                'Quem participa de cada bebê e com qual papel, as seções compartilhadas com cada médico e os convites (um convite é um link que você mesmo envia; guardamos só um resumo criptográfico irreversível dele, o papel e quando ele vence).',
                'Para compartilhar um bebê só com quem você escolher, com o acesso que você escolher.',
              ],
            },
            {
              id: 'accessLog',
              cells: [
                'Registro de acessos de médicos',
                'Quando um médico que você convidou abre os dados do seu bebê: quem, com qual papel e quando (no máximo um registro por hora).',
                'Para que o titular do bebê veja quando cada médico consultou os dados.',
              ],
            },
            {
              id: 'notifications',
              cells: [
                'Lembretes',
                'Se você ativar as notificações em um aparelho: o endereço de push que o seu navegador nos dá e as chaves dele, um nome do aparelho (como "Chrome no Android"), idioma, fuso horário, horário de silêncio, os lembretes escolhidos e um registro de envio (identificadores, tipo, horário e situação, nunca o texto).',
                'Para enviar os lembretes que você pediu, no seu horário local.',
              ],
            },
            {
              id: 'cryMonitor',
              cells: [
                'Monitor de choro (opcional, app web)',
                'Só se você ligar o Monitor de choro em um aparelho: o microfone desse aparelho escuta enquanto a página do monitor está aberta. O som é analisado nesse aparelho, mais ou menos um segundo por vez, e descartado na hora: nunca é gravado, guardado ou enviado, nem para nós. O que fica salvo é um período de choro no registro (quando começou e terminou, marcado como detectado automaticamente) e, se você responder, se o bebê estava mesmo chorando. O modelo de sons e o programa dele vêm do nosso próprio servidor; nenhuma outra empresa participa. No aparelho: que você concordou, quando e com qual versão do texto, e a sensibilidade escolhida.',
                'Para perceber o choro e registrá-lo para você, e para avisar os familiares que ligaram essa notificação. Suas respostas tiram os alarmes falsos dos padrões e das estatísticas.',
              ],
            },
            {
              id: 'assistants',
              cells: [
                'Assistente de voz (Alexa)',
                'O bebê que você escolhe para os comandos de voz (Ajustes > Assistentes de voz) e, se você ativar e vincular a skill do Lotties na Alexa, em cada pedido vindo da Amazon o comando e seus valores (como "mamadeira" e "120 ml"), o idioma e um token de acesso da sua conta.',
                'Para registrar e responder perguntas por voz.',
              ],
            },
            {
              id: 'technical',
              cells: [
                'Registros técnicos (logs)',
                'O que os nossos servidores registram para funcionar: identificadores internos da conta e do bebê envolvidos, o tipo de ação e o resultado, e erros. O servidor web também registra o endereço de rede (IP) de onde veio cada pedido de página, a página e o tipo de navegador. O texto de uma busca de endereço pode aparecer no registro desse pedido.',
                'Para manter o serviço funcionando, investigar problemas e protegê-lo contra abusos.',
              ],
            },
            {
              id: 'device',
              cells: [
                'No seu aparelho',
                'Uma cópia dos registros dos seus bebês para uso offline, as alterações que ainda não foram enviadas, sua sessão de login e suas preferências.',
                'Para o app funcionar sem conexão e abrir rápido. Veja [Cookies e armazenamento no seu aparelho](#privacy-device-storage).',
              ],
            },
            {
              id: 'backups',
              cells: [
                'Cópias e exportações',
                'Cópias do banco de dados que o mantenedor faz antes de atualizações que o alteram, e os arquivos que você exporta do app.',
                'Para recuperar o serviço se uma atualização falhar, e para você guardar ou levar seus dados.',
              ],
            },
          ],
        },
        {
          kind: 'note',
          text: 'O Lotties não pede sua localização, seus contatos, a câmera nem as fotos. Ele só pede o microfone quando você liga o Monitor de choro em um aparelho, no app web, e só o usa enquanto essa página está aberta; o som nunca sai do aparelho. O app não tem ferramentas de publicidade, de análise de uso nem de relatório de falhas.',
        },
      ],
    },
    {
      id: 'other-people',
      title: 'Informações sobre outras pessoas',
      blocks: [
        {
          kind: 'p',
          text: 'Parte do que você registra é sobre outras pessoas: os contatos de um médico ou de uma clínica, o médico de uma consulta, a vacina contra o VSR da mãe, nomes em anotações. Registre só o necessário e o que você tem o direito de compartilhar, e mantenha as informações corretas. Você é responsável por elas.',
        },
        {
          kind: 'p',
          text: 'A lista de Médicos e clínicas é para contatos; informações de saúde ficam nos registros do próprio bebê.',
        },
        {
          kind: 'p',
          text: 'O microfone do Monitor de choro também ouve outras pessoas no quarto, como uma babá ou visitas. Nada é gravado nem guardado, mas avise essas pessoas quando ele estiver ligado.',
        },
      ],
    },
    {
      id: 'legal-bases',
      title: 'Por que podemos usar esses dados (bases legais)',
      blocks: [
        {
          kind: 'p',
          text: 'A LGPD só permite tratar dados pessoais com uma base legal. Estas são as nossas:',
        },
        {
          kind: 'list',
          items: [
            'Sua conta, seus registros e o compartilhamento com as pessoas que você convida: execução do serviço que você pediu (LGPD, art. 7º, V).',
            'Informações de saúde do seu bebê (dados sensíveis): seu consentimento para essa finalidade (art. 11, I). Você o dá ao escolher registrar essas informações no app, para manter o histórico da criança. Você pode revogá-lo quando quiser, apagando esses registros ou a sua conta.',
            'Compartilhamento com um médico que você convida: seu consentimento específico, dado ao criar o convite e escolher as seções que o médico verá (art. 11, I). Você pode mudar as seções ou encerrar o acesso a qualquer momento.',
            'Recursos opcionais que você ativa (lembretes, a skill da Alexa, a busca de endereço): seu consentimento (art. 7º, I, e art. 11, I quando o lembrete for de um remédio ou de uma vacina). Para revogá-lo, desative o recurso ou desvincule a skill.',
            'O Monitor de choro: seu consentimento específico, pedido em cada aparelho antes de ligar, a um membro que pode registrar para o bebê (art. 11, I, e art. 14, § 1º). Você o revoga na página do monitor; os períodos já registrados continuam como registros comuns até você apagá-los.',
            'Registros técnicos e proteção do serviço: nosso legítimo interesse em mantê-lo funcionando e seguro (art. 7º, IX), limitado ao necessário e sem usar informações de saúde.',
            'Quando a lei ou uma autoridade exigir que guardemos ou entreguemos dados: cumprimento de obrigação legal (art. 7º, II, e art. 11, II, a).',
          ],
        },
        {
          kind: 'p',
          text: 'Dados de crianças são sempre tratados no melhor interesse da criança (art. 14); veja [Crianças](#privacy-children).',
        },
      ],
    },
    {
      id: 'sharing',
      title: 'Quem vê seus dados e com quem compartilhamos',
      blocks: [],
      subsections: [
        {
          id: 'people',
          title: 'Pessoas com quem você compartilha um bebê',
          blocks: [
            {
              kind: 'p',
              text: 'Os registros de um bebê são vistos apenas pelas pessoas que o titular do bebê convidar, com o papel que receberem:',
            },
            {
              kind: 'list',
              items: [
                'Titular e Responsável: veem tudo, registram e alteram os registros. Só o Titular gerencia membros, convites e o acesso de médicos.',
                'Cuidador(a): vê os registros do bebê e registra; altera só o que ele mesmo registrou.',
                'Visualizador: só visualiza.',
                'Médico(a): vê só as seções que o titular compartilhar (diário, crescimento, medicamentos, vacinas, fórmulas, notas), nunca as consultas, os membros nem os médicos e clínicas que você salvou. O titular pode ver no registro de acessos quando cada médico abriu os dados do bebê, e pode mudar ou encerrar esse acesso a qualquer momento.',
              ],
            },
            {
              kind: 'p',
              text: 'Notas marcadas como privadas só são vistas por quem as escreveu. Os médicos no Lotties se autodeclaram; não verificamos o registro profissional.',
            },
          ],
        },
        {
          id: 'companies',
          title: 'Empresas e serviços que recebem dados',
          blocks: [
            {
              kind: 'p',
              text: 'Não vendemos dados pessoais nem os entregamos a anunciantes, corretores de dados ou empresas de análise. Os dados só chegam a outras empresas nestes casos:',
            },
            {
              kind: 'table',
              id: 'recipients',
              caption: 'Quem recebe dados do Lotties, e quando',
              columns: ['Quem', 'O que recebe', 'Quando'],
              rows: [
                {
                  id: 'pushServices',
                  cells: [
                    'Serviços de push dos navegadores: Google (Chrome e a maioria dos navegadores Android), Mozilla (Firefox), Apple (Safari) e Microsoft (Edge)',
                    'O endereço de push do seu aparelho e o horário e o tamanho de cada lembrete ou alerta (como o "Choro detectado" do Monitor de choro). O conteúdo vai criptografado, de modo que só o seu aparelho consegue lê-lo; é o seu aparelho que monta o texto que você vê. Nenhum som é enviado.',
                    'Só se você ativar as notificações em um aparelho.',
                  ],
                },
                {
                  id: 'alexa',
                  cells: [
                    'Amazon (Alexa)',
                    'A Amazon grava e processa o que você fala com a Alexa, segundo os termos de privacidade da própria Amazon. O Lotties recebe só o comando e seus valores e devolve uma resposta curta que a Alexa fala, que pode incluir o nome do bebê, horários de mamadas e de sono, a quantidade de fraldas, a próxima consulta e as vacinas pendentes, e estimativas e resumos calculados a partir do seu registro: a próxima soneca, mamada ou troca de fralda esperada, a média de fraldas por dia, as quantidades das últimas mamadeiras, o sono de hoje até agora e, se você perguntar por que o bebê está chorando, as causas mais prováveis do dia a dia com os fatos registrados por trás delas. Os registros feitos por voz ficam marcados no app como feitos pela Alexa; a marca guarda só a palavra “alexa” e, num pedido de exclusão, o horário. A Amazon também guarda o token de acesso que liga a skill à sua conta.',
                    'Só se você ativar a skill do Lotties e vincular sua conta. Para parar, desvincule no app Alexa.',
                  ],
                },
                {
                  id: 'addressLookup',
                  cells: [
                    'Busca de endereço: BrasilAPI, ViaCEP e o Nominatim do OpenStreetMap',
                    'Só o CEP ou o texto que você digitou, enviados pelo nosso servidor. Nem o seu endereço de rede, nem a sua conta, nem o bebê, nem mais nada.',
                    'Só quando você toca em Buscar endereço ao cadastrar um médico ou uma clínica.',
                  ],
                },
                {
                  id: 'userLinks',
                  cells: [
                    'Apps e sites que você abre a partir do Lotties: Google Maps, WhatsApp e os apps de telefone, e-mail e calendário',
                    'O que você escolhe enviar: o endereço que você abre no mapa, o número para o qual liga ou manda mensagem, uma consulta que você adiciona ao calendário, um link de convite ou um arquivo que você compartilha.',
                    'Só quando você toca nesse tipo de link ou compartilha algo. Valem os termos deles.',
                  ],
                },
                {
                  id: 'appStores',
                  cells: [
                    'Apple App Store e Google Play',
                    'Cuidam do download do app. Dependendo das configurações do seu aparelho, podem nos passar estatísticas agregadas e relatórios de falhas; nunca os seus registros.',
                    'Só se você instalar o app para iOS ou Android.',
                  ],
                },
                {
                  id: 'github',
                  cells: [
                    'GitHub',
                    'Nada vindo do app. Se você visitar nosso código-fonte ou nos escrever por lá, valem os termos do GitHub, e as issues são públicas.',
                    'Só se você visitar ou escrever.',
                  ],
                },
              ],
            },
            {
              kind: 'p',
              text: 'Também podemos revelar dados quando a lei ou uma ordem judicial exigir.',
            },
          ],
        },
      ],
    },
    {
      id: 'children',
      title: 'Crianças',
      blocks: [
        {
          kind: 'p',
          text: 'O Lotties é feito para adultos: pais, outros cuidadores e profissionais de saúde. Ele não é feito para ser usado por crianças.',
        },
        {
          kind: 'p',
          text: 'O app guarda informações sobre bebês, registradas pelos pais ou responsáveis legais e pelas pessoas que eles convidam. Pela LGPD (art. 14), tratamos esses dados no melhor interesse da criança e apenas para fazer o app funcionar para a família: nunca para publicidade e nunca para tomar decisões sobre a criança ou a família.',
        },
        {
          kind: 'p',
          text: 'Cadastre um bebê só se você for o pai, a mãe ou o responsável legal, ou tiver a permissão deles. Um pai, mãe ou responsável legal pode nos pedir para ver, corrigir ou apagar os dados da criança (veja [Seus direitos](#privacy-rights)).',
        },
        {
          kind: 'p',
          text: 'O Monitor de choro só escuta o quarto do bebê em um aparelho onde um familiar que pode registrar para o bebê o ligou e concordou com os termos. O som é analisado nesse aparelho e nunca é guardado; só os períodos de choro são registrados.',
        },
      ],
    },
    {
      id: 'rights',
      title: 'Seus direitos e como exercê-los',
      blocks: [
        {
          kind: 'p',
          text: 'Pela LGPD (art. 18), você pode nos pedir: a confirmação de que tratamos seus dados e o acesso a eles; a correção de dados incompletos, errados ou desatualizados; a anonimização, o bloqueio ou a eliminação de dados desnecessários, excessivos ou tratados em desacordo com a lei; a portabilidade dos seus dados para outro serviço; a eliminação dos dados tratados com o seu consentimento; a informação sobre com quem os compartilhamos; a informação de que você pode não dar o consentimento e o que acontece nesse caso; e a revogação do consentimento. Você também pode reclamar à autoridade de proteção de dados, a [ANPD](https://www.gov.br/anpd/pt-br).',
        },
      ],
      subsections: [
        {
          id: 'in-app',
          title: 'No app',
          blocks: [
            {
              kind: 'list',
              items: [
                'Ver e corrigir: o que você registra aparece no app, e você pode editar conforme o seu papel permite. Seu perfil de profissional de saúde fica em Ajustes.',
                'Baixar uma cópia: [Central > Exportar dados](/hub/export) baixa um arquivo completo e legível de um bebê (Titulares e Responsáveis), que outro servidor Lotties pode importar. Em [Ajustes > Conta e dados](/settings#account), Baixar meus dados salva o que este aparelho tem. Um profissional de saúde encontra a opção na área do médico, [Ajustes > Conta e dados](/doctor/settings#account): seu perfil profissional e as notas, sugestões e medidas que registrou.',
                'Apagar registros: um registro apagado some na hora em todos os aparelhos. O servidor o mantém oculto, para que todos os aparelhos fiquem sabendo da exclusão, até o bebê ou a sua conta serem excluídos; se você precisar que ele seja eliminado antes, fale com a gente.',
                'Parar de compartilhar: o titular remove membros e médicos em [Central > Membros e papéis](/hub/family), onde qualquer pessoa também pode sair de um bebê.',
                'Revogar o consentimento de recursos opcionais: desative as notificações em [Ajustes](/settings#notifications), desvincule a skill no app Alexa, mude ou encerre o acesso de um médico em [Central > Acesso do médico](/hub/family#doctor-access) e retire o consentimento do Monitor de choro na página dele, [Central > Monitor de choro](/hub/cry-monitor), em cada aparelho.',
                'Excluir sua conta: [Ajustes > Conta e dados](/settings#account) > Excluir minha conta (na área do médico, [Ajustes > Conta e dados](/doctor/settings#account)). Bebês que só você usa são apagados com todos os registros. Em um bebê que outras pessoas mantêm, seu acesso termina; suas notas privadas, lembretes e perfil de médico são apagados; e o que você adicionou continua para elas sob o nome "Former member" (ex-membro). Se você for o único titular de um bebê que outras pessoas usam, torne outra pessoa titular antes.',
                'Sua conta de acesso no nosso servidor de login é excluída junto com seus dados quando o nosso servidor está configurado para isso, e o app diz antes da confirmação se ela será. Quando não está configurado, ou o servidor de login não responde naquele momento, seus dados são apagados mesmo assim, o app avisa que a conta de acesso continua (ela não guarda dados de bebês), e você pode nos pedir a remoção.',
              ],
            },
          ],
        },
        {
          id: 'ask-us',
          title: 'Falando com a gente',
          blocks: [
            {
              kind: 'p',
              text: 'Para qualquer outro pedido, ou se você não conseguir entrar: {contact}. Podemos pedir que você confirme que é você, por exemplo escrevendo do e-mail da sua conta. Respondemos assim que possível e enviamos a declaração completa dos seus dados em até 15 dias, como determina a LGPD (art. 19).',
            },
          ],
        },
      ],
    },
    {
      id: 'retention',
      title: 'Por quanto tempo guardamos',
      blocks: [
        {
          kind: 'list',
          items: [
            'Seus registros: até você apagá-los, o bebê ser excluído ou você excluir sua conta.',
            'Registros apagados: ficam ocultos até o bebê ou a sua conta serem excluídos (veja [Seus direitos](#privacy-rights)).',
            'O que você adicionou a um bebê que outras pessoas mantêm: continua com esse bebê depois que você sai ou exclui sua conta, sem o seu nome.',
            'Sua conta de login: até você excluir sua conta.',
            'Sua escolha de unidades de medida: até você mudá-la ou excluir sua conta.',
            'Lembretes: o registro de envio por 14 dias; adiamentos e dispensas por 7 dias após a última mudança. Um aparelho que fica 90 dias sem abrir o app para de receber lembretes, e o endereço de push de um aparelho desativado é apagado 30 dias depois.',
            'Registro de acessos de médicos e convites: ficam com o bebê até ele ser excluído.',
            'Monitor de choro: o som nunca é guardado. Os períodos de choro que ele registra são registros comuns (acima); o consentimento fica no aparelho até você retirá-lo ou sair da conta.',
            'Registros técnicos (logs): só pelo tempo necessário para operar e proteger o serviço.',
            'Cópias do banco feitas antes de atualizações: apagadas quando não forem mais necessárias. Até lá, ainda contêm dados apagados nesse meio-tempo.',
            'No seu aparelho: até você sair da conta (o app então apaga a cópia) ou limpar os dados do app.',
            'Arquivos que você exporta: onde você os guardar. Não conseguimos apagá-los por você.',
          ],
        },
      ],
    },
    {
      id: 'security',
      title: 'Como protegemos seus dados',
      blocks: [
        {
          kind: 'list',
          items: [
            'Toda conexão com lotties.app é criptografada (HTTPS); acessos por HTTP simples são redirecionados.',
            'O login acontece no nosso próprio servidor de login (Keycloak); o app nunca vê sua senha. O acesso usa tokens que expiram, que o servidor confere a cada pedido.',
            'A cada pedido, o servidor confere o seu papel naquele bebê e, para um médico, as seções compartilhadas. Notas privadas são filtradas no próprio banco de dados para todos, menos para quem as escreveu.',
            'Links de convite e os códigos dos lembretes são guardados apenas como resumos criptográficos irreversíveis (hashes).',
            'O app roda só o próprio código: sem scripts, fontes ou rastreadores de terceiros, o que é garantido por uma Política de Segurança de Conteúdo (CSP) rígida. O modelo de sons do Monitor de choro também vem do nosso próprio servidor.',
            'Só as páginas do próprio Lotties podem usar o microfone (uma Política de Permissões), e só depois que você liga o Monitor de choro; o navegador mostra quando ele está em uso.',
            'Limites de quantidade e de tamanho de pedidos; a conexão com a Alexa confere a assinatura da Amazon em cada pedido.',
            'O servidor usa uma conta de banco de dados com permissões limitadas e mantém senhas e chaves fora do código-fonte. Os logs do próprio app deixam de fora o que você escreve.',
            'O acesso de administrador aos servidores é restrito ao mantenedor. Só olhamos os dados guardados quando é preciso para operar o serviço, resolver um problema que você relatou ou cumprir a lei.',
          ],
        },
        {
          kind: 'p',
          text: 'Nenhum sistema é totalmente seguro. Os dados no seu aparelho e os arquivos que você exporta não são criptografados pelo app: proteja seu aparelho, saia da conta em aparelhos compartilhados e guarde bem os arquivos exportados. Se um incidente de segurança puder trazer risco ou dano relevante a você, avisaremos você e a ANPD (LGPD, art. 48).',
        },
        {
          kind: 'p',
          text: 'O Lotties roda em servidores de um home lab, não em um data center comercial. O servidor é protegido por um nobreak contra quedas de energia e possui backups automáticos criptografados fora do local, mas não podemos garantir que nenhum dado será perdido. Para os registros mais importantes, mantenha sua própria cópia usando [Central > Exportar dados](/hub/export).',
        },
      ],
    },
    {
      id: 'transfers',
      title: 'Transferência internacional de dados',
      blocks: [
        {
          kind: 'p',
          text: 'Nossos servidores são operados pelo mantenedor em um home lab (veja [Quem é o responsável](#privacy-controller)). Dados pessoais vão para outros países apenas por meio de recursos opcionais que você escolhe:',
        },
        {
          kind: 'list',
          items: [
            'Notificações: os serviços de push do Google, da Mozilla, da Apple e da Microsoft, que funcionam no mundo todo, inclusive nos Estados Unidos. Eles não conseguem ler o conteúdo dos lembretes nem dos alertas.',
            'Alexa: a Amazon, que processa os pedidos de voz nos próprios data centers, inclusive nos Estados Unidos.',
            'Busca de endereço: o Nominatim do OpenStreetMap é mantido pela OpenStreetMap Foundation, sediada no Reino Unido. A BrasilAPI e o ViaCEP também podem usar servidores fora do Brasil.',
            'As lojas de apps da Apple e do Google e o GitHub, quando você os usa, segundo os termos deles.',
          ],
        },
        {
          kind: 'p',
          text: 'Essas transferências acontecem só para fazer o que você pediu, quando você ativa o recurso (LGPD, art. 33, IX). Se não quiser, não ative esses recursos; o resto do app funciona sem eles.',
        },
      ],
    },
    {
      id: 'device-storage',
      title: 'Cookies e armazenamento no seu aparelho',
      blocks: [
        {
          kind: 'p',
          text: 'O Lotties não usa cookies de publicidade nem de rastreamento, e o app em si não cria cookies. Para funcionar, inclusive offline, ele guarda no seu aparelho:',
        },
        {
          kind: 'list',
          items: [
            'Sua sessão de login (tokens do nosso servidor de login, com seu nome e e-mail), no armazenamento local do navegador. O servidor de login cria os próprios cookies de sessão, no endereço dele, para manter você conectado.',
            'Uma cópia dos registros dos seus bebês e das alterações ainda não enviadas, no banco de dados do navegador (um por conta).',
            'Preferências e atalhos: idioma, tema, o bebê selecionado, botões fixados, cartões dispensados, valores e estimativas recentes e quantas vezes você abre cada item da Central (para ordenar seus atalhos).',
            'Um link de convite enquanto você faz login, por um instante (armazenamento de sessão).',
            'Se você usar o Monitor de choro: que você concordou neste aparelho (quando, e com qual versão do texto) e a sensibilidade escolhida. Nunca nenhum som.',
            'Os arquivos do próprio app, para que ele abra offline. Nenhum registro fica nesse cache.',
          ],
        },
        {
          kind: 'p',
          text: 'Sair da conta apaga do aparelho os registros e as preferências dessa conta; antes, o app avisa se há alterações ainda não enviadas. Idioma, tema e a sensibilidade do Monitor de choro continuam. Os apps para iOS e Android guardam os mesmos dados no armazenamento do próprio app; desinstalar remove tudo.',
        },
      ],
    },
    {
      id: 'not-medical',
      title: 'O Lotties não é um dispositivo médico',
      blocks: [
        {
          kind: 'p',
          text: 'O Lotties é uma ferramenta de registro e lembretes para famílias. Ele não é um dispositivo médico e não diagnostica, não trata nem dá orientação médica. Estimativas, padrões e faixas típicas são informação, não recomendação.',
        },
        {
          kind: 'p',
          text: 'Doses e horários de remédios vêm só do que você ou um médico cadastrou; siga sempre a orientação do seu médico. Lembretes podem atrasar ou falhar (sem conexão, configurações do celular), então não dependa só deles. Em uma emergência, procure um médico ou o serviço de emergência.',
        },
        {
          kind: 'p',
          text: 'O Monitor de choro não é uma babá eletrônica nem um dispositivo de segurança. Ele pode não perceber um choro e pode reagir a outros sons; só funciona enquanto a página dele está aberta e a tela ligada. Mantenha sempre um jeito de ouvir o seu bebê você mesmo.',
        },
      ],
    },
    {
      // Um recurso planejado, não construído (dataFlows.ts PLANNED_FLOWS, docs/design/34-community-insights.md):
      // mantenha o texto "ainda não está ativo" até o recurso existir; os testes conferem.
      id: 'community-insights',
      title: 'Comparações com outros bebês (opcional, ainda não ativo)',
      blocks: [
        {
          kind: 'note',
          text: 'Ainda não está ativo. Este recurso não existe hoje no Lotties: está desligado para todos, e nada sobre o seu bebê é usado para ele ou compartilhado com alguém. Esta seção explica como ele funcionaria, para que você saiba antes de ele existir. Ele só começaria para um bebê depois que o Titular ou um Responsável desse bebê o ativasse.',
        },
        {
          kind: 'p',
          text: 'As comparações com outros bebês juntariam informações de muitos bebês cujas famílias escolheram participar, para dar a todas as famílias estimativas melhores para a idade do bebê do que as tabelas gerais publicadas conseguem. Seriam opcionais: o app funciona do mesmo jeito sem elas.',
        },
      ],
      subsections: [
        {
          id: 'purposes',
          title: 'Para que serviriam',
          blocks: [
            { kind: 'p', text: 'Estatísticas de grupo, por idade em semanas, para:' },
            {
              kind: 'list',
              items: [
                'Quanto leite oferecer: as quantidades típicas por mamadeira de bebês da mesma idade, para sugerir quantidades iniciais melhores.',
                'Crescimento: como o peso, o comprimento e o perímetro cefálico do seu bebê se comparam com os de bebês da mesma idade, ao lado das curvas oficiais de crescimento.',
                'Tempo de bruços: quanto tempo de bruços por dia bebês da mesma idade costumam ter.',
                'Rotinas de sono e de alimentação: sonecas, sono noturno, mamadas e fraldas típicos nessa idade, como contexto para os padrões do próprio bebê.',
                'Padrões fora do comum: perceber quando a rotina do bebê muda muito em relação ao que é habitual para ele, comparando com o quanto as rotinas de bebês dessa idade costumam variar. Nunca chamariam um bebê ou um valor de normal ou anormal.',
                'Choro: o que as famílias de bebês da mesma idade mais acharam que ajudou, para ordenar as sugestões de "Por que ela está chorando?".',
                'Outras estimativas do mesmo tipo, cada uma incluída na lista publicada (veja as proteções abaixo) antes de ser usada.',
              ],
            },
            {
              kind: 'p',
              text: 'Como tudo no Lotties, seriam informação, não orientação médica (veja [O Lotties não é um dispositivo médico](#privacy-not-medical)).',
            },
          ],
        },
        {
          id: 'consent',
          title: 'Só se você disser sim',
          blocks: [
            {
              kind: 'list',
              items: [
                'Ficariam desligadas para todos os bebês até que alguém as ativasse, em uma tela própria que explica o recurso em palavras simples. Nunca fariam parte da criação da conta, do aceite desta política nem de nenhuma outra etapa, e o app funcionaria do mesmo jeito se você dissesse não.',
                'A escolha seria feita para cada bebê, pelo Titular ou por um Responsável do bebê que confirme ser o pai, a mãe ou o responsável legal da criança. Cuidadores, Visualizadores e médicos não poderiam ativá-las. Todos os Titulares e Responsáveis do bebê veriam se elas estão ativas, e qualquer um deles poderia desativá-las.',
                'Guardaríamos um registro da escolha: quem disse sim, para qual bebê, quando e para qual versão do texto, para poder demonstrar que o consentimento foi dado.',
                'Base legal: o consentimento específico do pai, da mãe ou do responsável legal para essa finalidade, separado de qualquer outro (LGPD, art. 11, I, e art. 14, § 1º), sempre no melhor interesse da criança.',
              ],
            },
          ],
        },
        {
          id: 'data',
          title: 'O que usariam, e o que nunca usariam',
          blocks: [
            {
              kind: 'table',
              id: 'planned',
              caption: 'Planejado, não coletado hoje: o que cada estimativa usaria',
              columns: ['Estimativa', 'O que usaria', 'O que você veria'],
              rows: [
                {
                  id: 'milk',
                  cells: [
                    'Quanto leite oferecer',
                    'Idade em semanas; a quantidade tomada em cada mamadeira e se era fórmula ou leite materno (nunca qual fórmula); mamadeiras por dia.',
                    'Quantidades típicas por mamada para a idade, como atalhos iniciais da quantidade da mamadeira.',
                  ],
                },
                {
                  id: 'growth',
                  cells: [
                    'Crescimento',
                    'Idade em semanas em cada medição; peso, comprimento e perímetro cefálico.',
                    'Onde as medidas do seu bebê ficam entre as de bebês da mesma idade, ao lado das curvas oficiais.',
                  ],
                },
                {
                  id: 'tummyTime',
                  cells: [
                    'Tempo de bruços',
                    'Idade em semanas; minutos de bruços por dia.',
                    'Quanto tempo de bruços bebês dessa idade costumam ter.',
                  ],
                },
                {
                  id: 'routine',
                  cells: [
                    'Rotinas de sono e de alimentação',
                    'Idade em semanas; por dia, a quantidade e a duração das sonecas e do sono noturno, e a quantidade de mamadas e de fraldas.',
                    'Rotinas típicas nessa idade.',
                  ],
                },
                {
                  id: 'patterns',
                  cells: [
                    'Padrões fora do comum',
                    'As mesmas contagens e durações diárias, comparadas com as semanas anteriores do próprio bebê.',
                    'Um aviso discreto quando a rotina muda muito em relação ao habitual dele; nunca um rótulo.',
                  ],
                },
                {
                  id: 'crying',
                  cells: [
                    'Choro',
                    'Idade em semanas; quanto durou cada choro e em que parte do dia (manhã, tarde, noite ou madrugada); o que o app sugeriu primeiro e o que você disse que ajudou.',
                    'O que mais ajudou bebês dessa idade.',
                  ],
                },
              ],
            },
            {
              kind: 'p',
              text: 'Nunca usariam nomes (do bebê, o seu ou de qualquer outra pessoa), a data de nascimento (só a idade em semanas), datas e horários exatos (só a parte do dia), anotações ou qualquer outro texto que você escreve, fotos (o Lotties não coleta nenhuma), localizações ou endereços, os médicos e clínicas que você salvou, remédios, vacinas, sintomas ou temperaturas, nem nada sobre um bebê cuja família não as ativou.',
            },
          ],
        },
        {
          id: 'safeguards',
          title: 'As proteções que teriam',
          blocks: [
            {
              kind: 'list',
              items: [
                'Só números de grupo: medianas e faixas para cada faixa de idade. Nenhum registro individual sairá da conta da sua família, e nenhuma cópia dos seus registros será feita para isso.',
                'Um tamanho mínimo de grupo: uma estatística só será publicada quando vier de pelo menos 20 bebês de famílias diferentes. Grupos menores ficam de fora, e para eles o app continua usando as tabelas publicadas.',
                'Um limite para o peso de cada família: uma família que registra muito não contará mais do que qualquer outra, e valores extremos serão limitados, para que nenhum bebê sozinho mude um número.',
                'Estatísticas fixas, não buscas: os resultados serão um conjunto fixo de números, recalculado periodicamente, e não respostas a perguntas que qualquer pessoa possa fazer, para que não possam ser combinados para identificar um bebê. Quando ajudar, um pouco de ruído aleatório será acrescentado (um método chamado privacidade diferencial).',
                'Calculadas nos nossos próprios servidores (veja [Quem é o responsável](#privacy-controller)). Nenhuma outra empresa receberá os dados nem os resultados.',
                'Sem venda, sem publicidade, sem criação de perfis de famílias e sem decisões sobre a sua criança ou a sua família.',
                'Abertas: o código que calcula as estatísticas fará parte do código-fonte aberto, e a lista de estatísticas, com o que cada uma usa, será publicada antes de ser usada.',
              ],
            },
            {
              kind: 'p',
              text: 'Estatísticas de grupo como essas são muito difíceis de ligar a um bebê, mas nenhum método torna isso impossível em todos os casos. Por isso existem essas proteções e os grupos pequenos ficam de fora. Antes de o recurso ser ativado, as proteções serão avaliadas em um relatório de impacto à proteção de dados pessoais (RIPD), previsto na LGPD.',
            },
          ],
        },
        {
          id: 'results',
          title: 'Quem veria os resultados',
          blocks: [
            {
              kind: 'list',
              items: [
                'Quem usa o Lotties, apenas como comparações dentro do app, como "bebês dessa idade costumam..." ao lado dos números do seu bebê. Ninguém veria os registros de outra família, e nenhuma outra família veria os seus.',
                'Os resultados não seriam entregues nem vendidos a ninguém fora do app.',
                'Médicos: o que um médico que você convidou pode ver continua igual (as seções que você compartilha, veja [Pessoas com quem você compartilha um bebê](#privacy-sharing-people)). Um médico não poderia ativar as comparações para o seu bebê.',
              ],
            },
          ],
        },
        {
          id: 'withdraw',
          title: 'Desativar, e os seus direitos',
          blocks: [
            {
              kind: 'list',
              items: [
                'O Titular ou qualquer Responsável do bebê poderia desativá-las a qualquer momento, tão facilmente quanto foram ativadas. A partir daí, os registros do bebê deixam de ser usados: o próximo cálculo já os deixa de fora.',
                'As estatísticas já calculadas são números de grupo sem ligação com nenhum bebê, então a parte do seu bebê não tem como ser separada delas. Elas são substituídas no próximo cálculo, que já não inclui o seu bebê.',
                'Os registros do seu bebê em si nunca seriam compartilhados: continuam na sua conta, onde você ainda pode vê-los, exportá-los e apagá-los.',
                'Apagar um registro, o bebê ou a sua conta também o tira do próximo cálculo.',
                'Você mantém todos os direitos listados em [Seus direitos](#privacy-rights), inclusive perguntar se os dados do seu bebê foram usados e pedir que eles sejam apagados.',
              ],
            },
          ],
        },
        {
          id: 'activation',
          title: 'Antes de serem ativadas',
          blocks: [
            {
              kind: 'p',
              text: 'Antes de as comparações com outros bebês começarem, atualizaremos esta seção com os detalhes finais (inclusive o tamanho mínimo de grupo e a lista de estatísticas), mudaremos a versão e a data desta política (veja [Mudanças nesta política](#privacy-changes)) e avisaremos você no app. Uma mudança nesta política, sozinha, nunca as ativa: elas só começam para um bebê quando o Titular ou um Responsável desse bebê disser sim na tela própria.',
            },
          ],
        },
      ],
    },
    {
      id: 'changes',
      title: 'Mudanças nesta política',
      blocks: [
        {
          kind: 'p',
          text: 'Esta é a versão {version}, atualizada em {lastUpdated}. Quando mudarmos a política, atualizaremos esta página e a data. Para mudanças importantes, avisaremos antes de elas valerem, por exemplo com um aviso no app. Todas as versões anteriores continuam públicas no [histórico do código-fonte]({repoUrl}).',
        },
      ],
    },
    {
      id: 'contact',
      title: 'Contato',
      blocks: [
        { kind: 'p', text: 'Dúvidas, pedidos sobre seus dados e reclamações: {contact}.' },
        { kind: 'p', text: 'Encarregado pelo tratamento de dados pessoais: {dpo}.' },
        {
          kind: 'p',
          text: 'Se você não ficar satisfeito com a nossa resposta, pode reclamar à [ANPD](https://www.gov.br/anpd/pt-br), a Autoridade Nacional de Proteção de Dados.',
        },
      ],
    },
  ],
  fallbacks: {
    controller: 'os mantenedores do projeto Lotties',
    contact:
      'o [rastreador público de issues do projeto no GitHub]({issuesUrl}), para dúvidas (não publique dados pessoais lá), ou, para qualquer assunto pessoal, um [relato privado aos mantenedores no GitHub]({advisoryUrl})',
    dpo: 'o mesmo contato acima',
  },
};
