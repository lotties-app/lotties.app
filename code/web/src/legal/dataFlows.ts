import type { CuratedId } from '../credits/curatedCredits';

/*
 * The data flows the privacy policy must describe, as facts the tests hold the text to
 * (docs/design/33-privacy-audit.md sections 2 and 3). A new data category or a new company that
 * receives data is a conscious change: add it here, describe it in both privacy.<lang>.ts files and in
 * the audit; dataFlows.test.ts fails until the three agree.
 */

/** The rows of the "What we collect and why" table, in order. */
export const DATA_CATEGORY_IDS = [
  'account',
  'babyProfile',
  'records',
  'health',
  'careProviders',
  'doctorProfile',
  'sharing',
  'accessLog',
  'notifications',
  'assistants',
  'technical',
  'device',
  'backups',
] as const;
export type DataCategoryId = (typeof DATA_CATEGORY_IDS)[number];

/** The rows of the "Companies and services that receive data" table, in order. */
export const THIRD_PARTY_IDS = [
  'pushServices',
  'alexa',
  'addressLookup',
  'userLinks',
  'appStores',
  'github',
] as const;
export type ThirdPartyId = (typeof THIRD_PARTY_IDS)[number];

export interface ThirdParty {
  id: ThirdPartyId;
  /** When data reaches them: a feature the person turns on, a tap of hers, installing a store app, visiting. */
  trigger: 'optIn' | 'userAction' | 'install';
  /** Whether the recipient may process the data outside Brazil (LGPD art. 33: the "transfers" section names it). */
  abroad: boolean;
  /** The curated credits (credits/curated.json) that name this recipient. */
  creditIds: readonly CuratedId[];
}

export const THIRD_PARTIES: readonly ThirdParty[] = [
  // Web Push (built): Google FCM, Mozilla, Apple, Microsoft; the payload is encrypted (RFC 8291).
  { id: 'pushServices', trigger: 'optIn', abroad: true, creditIds: ['webpush'] },
  // The Alexa skill (built, off until the owner enables it): Amazon hears the voice and speaks our answers.
  { id: 'alexa', trigger: 'optIn', abroad: true, creditIds: [] },
  // "Find address" in the provider sheet: only the typed CEP or text, sent by our server.
  {
    id: 'addressLookup',
    trigger: 'userAction',
    abroad: true,
    creditIds: ['brasilapi', 'viacep', 'nominatim'],
  },
  // Links the person taps (Open in maps, WhatsApp, tel:, mailto:) and files she shares.
  { id: 'userLinks', trigger: 'userAction', abroad: true, creditIds: [] },
  // Apple App Store and Google Play (when the native apps are published).
  { id: 'appStores', trigger: 'install', abroad: true, creditIds: [] },
  // The source repository and the default contact channel (public issues, private reports).
  { id: 'github', trigger: 'userAction', abroad: true, creditIds: [] },
];

/** How a curated credit relates to personal data. */
export type CreditPrivacy =
  /** Receives data from Lotties: it must be one of THIRD_PARTIES. */
  | { kind: 'recipient'; thirdParty: ThirdPartyId }
  /** Software we run on our own servers: nothing leaves to its authors. */
  | { kind: 'selfHosted' }
  /** A data source, font, icon set, standard, build tool or our own art: nothing about a person goes to it. */
  | { kind: 'noPersonalData' };

/**
 * Every curated credit, classified. A new credit does not compile until it is listed here, so adding a
 * service to the credits forces the question "does it receive personal data?".
 */
export const CURATED_CREDIT_PRIVACY: Readonly<Record<CuratedId, CreditPrivacy>> = {
  anvisa: { kind: 'noPersonalData' },
  pni: { kind: 'noPersonalData' },
  sbp: { kind: 'noPersonalData' },
  sbim: { kind: 'noPersonalData' },
  agenormsSleep: { kind: 'noPersonalData' },
  agenormsFeeding: { kind: 'noPersonalData' },
  agenormsDiapersCrying: { kind: 'noPersonalData' },
  osm: { kind: 'noPersonalData' },
  nominatim: { kind: 'recipient', thirdParty: 'addressLookup' },
  brasilapi: { kind: 'recipient', thirdParty: 'addressLookup' },
  viacep: { kind: 'recipient', thirdParty: 'addressLookup' },
  keycloak: { kind: 'selfHosted' },
  keycloakify: { kind: 'noPersonalData' },
  postgresql: { kind: 'selfHosted' },
  dotnet: { kind: 'selfHosted' },
  buildtools: { kind: 'noPersonalData' },
  webpush: { kind: 'recipient', thirdParty: 'pushServices' },
  fraunces: { kind: 'noPersonalData' },
  tabler: { kind: 'noPersonalData' },
  art: { kind: 'noPersonalData' },
};
