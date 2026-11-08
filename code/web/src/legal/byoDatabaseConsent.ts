import type { Locale } from '../i18n/config';
import { sectionAnchor } from './privacyPolicy';

/*
 * The text of the optional consent `byo_database` (docs/design/47-bring-your-own-database.md section 10,
 * docs/design/38-consent-and-terms.md), shown by the own-database setup before a database is saved and recorded
 * with `PUT /me/consents/optional/byo_database`. It is a legal text, kept here beside the policy (not in the i18n
 * catalogs) and part of the consent digest (consentVersions.test.ts): a change of meaning needs a new consent
 * version. It must state only what the code does (the facts in dataFlows.ts OWN_DATABASE_FLOW) and never a
 * claim of forbiddenClaims.ts.
 *
 * `{provider}` is the provider name the person typed (such as "Supabase"); `byoDatabaseConsentText` fills it in.
 */
export interface ByoDatabaseConsentText {
  title: string;
  /** What changes and what does not, in one paragraph. */
  intro: string;
  /** The plain facts and limits, one per line. */
  points: readonly string[];
  /** The sentence next to the checkbox the person ticks to agree. */
  declaration: string;
  /** The label of the link to the policy section. */
  policyLink: string;
}

/** The in-app address of the policy section about it. */
export const BYO_DATABASE_POLICY_HREF = `/privacy#${sectionAnchor('own-database')}`;

export const BYO_DATABASE_CONSENT: Readonly<Record<Locale, ByoDatabaseConsentText>> = {
  en: {
    title: "Keep this baby's records in your own database",
    intro:
      "You keep using the Lotties app and your account exactly as before. Only where this baby's care records are stored changes: in your own PostgreSQL database at {provider}, instead of on Lotties' servers. Lotties reads and writes them there, through the Lotties servers, to run the app.",
    points: [
      "What moves: the baby's care records (daily entries, your own entry types, medicines and prescriptions, formulas, appointments, saved doctors and clinics, vaccinations, measurements and notes). What stays with Lotties: your account, your consents, who belongs to the baby, the baby's profile and your settings.",
      'The records still pass through the Lotties servers every time the app reads or writes them, and the Lotties servers can read them while they do.',
      'The connection details you enter are stored encrypted (AES-256-GCM) and are never shown again. The key is held by whoever runs Lotties, so the Lotties servers, and the people who run them, can open them. This is not end-to-end encryption.',
      '{provider} is a company you choose, not one Lotties chooses. Its own terms, its prices and the country or region you picked apply to your records there. You are responsible for that account.',
      'Your provider may pause or close a free database, limit it, or lose data, and free plans may have no backups. Once the records are moved and the undo period the app shows has ended, Lotties keeps no copy of them, so download a backup of the baby from time to time.',
      'For this baby, reminders, invited members and doctor access are not available in this first version.',
      'You can move the records back to Lotties, or disconnect, at any time.',
    ],
    declaration:
      "I am this baby's owner in Lotties, I chose {provider}, and I agree that Lotties stores this baby's care records there and reads and writes them as described above.",
    policyLink: 'Read the privacy policy section on your own database',
  },
  'pt-BR': {
    title: 'Guardar os registros deste bebê no seu próprio banco de dados',
    intro:
      'Você continua usando o app Lotties e a sua conta exatamente como antes. Só muda onde os registros de cuidado deste bebê ficam guardados: no seu próprio banco de dados PostgreSQL em {provider}, e não nos servidores do Lotties. O Lotties lê e grava esses registros lá, por meio dos servidores do Lotties, para o app funcionar.',
    points: [
      'O que muda de lugar: os registros de cuidado do bebê (os registros do dia a dia, os seus próprios tipos de registro, remédios e receitas, fórmulas, consultas, médicos e clínicas salvos, vacinas, medidas e notas). O que fica com o Lotties: a sua conta, os seus consentimentos, quem participa do bebê, o perfil do bebê e os seus ajustes.',
      'Os registros continuam passando pelos servidores do Lotties sempre que o app os lê ou grava, e os servidores do Lotties conseguem lê-los nesse momento.',
      'Os dados de conexão que você informa são guardados criptografados (AES-256-GCM) e nunca mais são mostrados. A chave fica com quem opera o Lotties; por isso os servidores do Lotties, e as pessoas que os operam, conseguem abri-los. Isto não é criptografia de ponta a ponta.',
      '{provider} é uma empresa que você escolhe, não o Lotties. Os termos dela, os preços dela e o país ou a região que você escolheu valem para os seus registros lá. Você é responsável por essa conta.',
      'O seu provedor pode pausar ou encerrar um banco de dados gratuito, limitá-lo ou perder dados, e planos gratuitos podem não ter backup. Depois que os registros forem movidos e o prazo para desfazer que o app mostra terminar, o Lotties não guarda cópia deles, então baixe de vez em quando um backup do bebê.',
      'Para este bebê, lembretes, membros convidados e o acesso de médicos não estão disponíveis nesta primeira versão.',
      'Você pode trazer os registros de volta para o Lotties, ou desconectar, a qualquer momento.',
    ],
    declaration:
      'Sou o titular deste bebê no Lotties, escolhi {provider} e concordo que o Lotties guarde os registros de cuidado deste bebê lá e os leia e grave como descrito acima.',
    policyLink: 'Leia a seção da política de privacidade sobre o seu próprio banco de dados',
  },
};

/** The consent text in `locale` with the provider name filled in (a blank name reads as "your provider"). */
export function byoDatabaseConsentText(locale: Locale, provider: string): ByoDatabaseConsentText {
  const text = BYO_DATABASE_CONSENT[locale];
  const name = provider.trim() || (locale === 'pt-BR' ? 'o seu provedor' : 'your provider');
  const fill = (value: string) => {
    const filled = value.replaceAll('{provider}', name);
    return filled.charAt(0).toLocaleUpperCase(locale) + filled.slice(1);
  };
  return {
    title: fill(text.title),
    intro: fill(text.intro),
    points: text.points.map(fill),
    declaration: fill(text.declaration),
    policyLink: fill(text.policyLink),
  };
}
