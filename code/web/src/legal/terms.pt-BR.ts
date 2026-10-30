import { privacyPtBR } from './privacy.pt-BR';
import type { TermsDocument } from './termsTypes';

/*
 * Termos de uso, português do Brasil (docs/CONSENT-AND-TERMS-DRAFT.md seção 5; rascunho para o advogado, não é aconselhamento
 * jurídico). Dizer só o que o código faz. Uma mudança que altera o sentido de uma frase é uma mudança relevante: aumente a versão
 * dos termos e acrescente uma entrada em consentVersions.json (consentVersions.test.ts falha até o digest do texto acompanhar).
 */
export const termsPtBR: TermsDocument = {
  locale: 'pt-BR',
  clauses: [
    {
      id: 'who',
      title: 'Quem somos',
      text: 'O Lotties é um aplicativo gratuito e de código aberto (AGPL-3.0) de acompanhamento da rotina de bebês. O responsável pelo serviço é {controller}. Contato: {contact}.',
    },
    {
      id: 'beta',
      title: 'Fase de teste',
      text: 'O serviço está em teste e é oferecido "como está": pode mudar, falhar, ficar indisponível ou ser encerrado, e dados podem ser perdidos. Mantenha cópias do que for importante (há exportação em Hub > Exportar dados). Avisaremos com antecedência razoável antes de encerrar o serviço.',
    },
    {
      id: 'who-may-use',
      title: 'Quem pode usar',
      text: 'Maiores de 18 anos. Quem registra dados de uma criança declara ser pai, mãe, responsável legal ou adulto autorizado por eles.',
    },
    {
      id: 'account',
      title: 'Sua conta',
      text: 'Você responde pelo que acontece na sua conta e pelas pessoas a quem der acesso. Guarde sua senha e avise-nos se suspeitar de acesso indevido.',
    },
    {
      id: 'data',
      title: 'Seus dados',
      text: 'Os dados que você registra continuam sendo seus. Você nos autoriza a guardá-los, sincronizá-los e mostrá-los às pessoas que você escolher, apenas para o serviço funcionar. Como tratamos dados pessoais: a [Política de privacidade](/privacy).',
    },
    {
      id: 'acceptable-use',
      title: 'Uso aceitável',
      text: 'Não use o Lotties para algo ilegal, para prejudicar outras pessoas ou o serviço, nem para registrar dados de uma criança sem ter o direito de fazê-lo. Não tente acessar dados de outras famílias.',
    },
    {
      id: 'health',
      title: 'Saúde',
      text: 'O Lotties guarda um registro e mostra padrões do que você anotou. Ele não faz diagnóstico, não indica tratamento e não é um dispositivo médico. Lembretes de remédios são lembretes do que você cadastrou, não recomendações do Lotties. Em caso de dúvida sobre a saúde, fale com o pediatra ou o farmacêutico; em emergência, ligue para o número de emergência da sua região.',
    },
    {
      id: 'integrations',
      title: 'Integrações',
      text: 'A Alexa, o assistente de IA, as notificações e a busca de endereço são serviços de terceiros, que você escolhe ligar; cada um tem as próprias regras.',
    },
    {
      id: 'security',
      title: 'Segurança e incidentes',
      text: 'Usamos medidas de segurança adequadas, mas nenhum sistema é totalmente seguro. Se houver um incidente de segurança relevante, avisaremos as pessoas afetadas e a ANPD, nos prazos da lei.',
    },
    {
      id: 'changes',
      title: 'Mudanças',
      text: 'Podemos mudar estes Termos. Mudanças relevantes pedem novo consentimento; as pequenas aparecem como aviso.',
    },
    {
      id: 'ending',
      title: 'Encerrar',
      text: 'Você pode apagar a conta a qualquer momento em Ajustes. Podemos suspender uma conta que descumpra estes Termos ou que ponha o serviço ou outras pessoas em risco.',
    },
    {
      id: 'liability',
      title: 'Responsabilidade',
      text: 'Na medida permitida pela lei, não nos responsabilizamos por perdas decorrentes de falhas, indisponibilidade ou uso do serviço em fase de teste, exceto em caso de dolo ou culpa grave e nos casos em que a lei não permite limitar a responsabilidade (por exemplo, direitos do titular de dados e do consumidor).',
    },
    {
      id: 'open-source',
      title: 'Código aberto',
      text: 'O código-fonte está no [repositório do projeto]({repoUrl}) sob a AGPL-3.0; estes Termos não limitam os direitos que essa licença lhe dá sobre o código.',
    },
    {
      id: 'law',
      title: 'Lei',
      text: 'Estes Termos seguem a lei brasileira.',
    },
  ],
  fallbacks: privacyPtBR.fallbacks,
};
