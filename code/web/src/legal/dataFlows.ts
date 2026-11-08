import type { CuratedId } from '../credits/curatedCredits';
import type { PolicySectionId } from './policyTypes';

/*
 * The data flows the privacy policy must describe, as facts the tests hold the text to
 * (docs/design/33-privacy-audit.md sections 2 and 3). A new data category or a new company that
 * receives data is a conscious change: add it here, describe it in both privacy.<lang>.ts files and in
 * the audit; dataFlows.test.ts fails until the three agree.
 */

/** The rows of the "What we collect and why" table, in order. */
export const DATA_CATEGORY_IDS = [
  'account',
  'consent',
  'babyProfile',
  'records',
  'health',
  'careProviders',
  'doctorProfile',
  'sharing',
  'accessLog',
  'notifications',
  'cryMonitor',
  'assistants',
  'rest',
  'ownDatabase',
  'technical',
  'device',
  'backups',
] as const;
export type DataCategoryId = (typeof DATA_CATEGORY_IDS)[number];

/*
 * Flows that use a device sensor and keep the raw signal on the device (docs/design/33-privacy-audit.md
 * section 12): what the policy must say about each, held by dataFlows.test.ts. A new sensor (camera,
 * location) or a change of what leaves the device is a policy change: add or update it here, in both
 * privacy.<lang>.ts files, the audit and the policy version.
 */
export interface OnDeviceFlow {
  id: 'cryMonitor';
  /** `active`: built and offered (web app only), behind its own consent. */
  status: 'active';
  /** The browser permission it asks for, only when the person starts it. */
  permission: 'microphone';
  /** Off until someone starts it on a device, after a separate consent on that device. */
  trigger: 'optIn';
  defaultOn: false;
  /** Who may start it (the roles that log for the baby). */
  consentBy: readonly ('Owner' | 'Parent' | 'Caregiver')[];
  /** The raw signal: analysed on the device only, never recorded, stored or sent (not even to us). */
  rawSignal: { stored: false; sent: false };
  /** The row of "What we collect" that describes what it saves (an ordinary fussy record). */
  dataCategory: DataCategoryId;
  /** Where its model and runtime come from: our own server, no third party at run time. */
  modelFrom: 'ownServer';
  /** Companies that receive something because of it: the encrypted alert to opted-in family members. */
  recipients: readonly ThirdPartyId[];
  /** The platforms that offer it (not the native apps yet, docs/design/31 CD10). */
  platforms: readonly 'web'[];
}

export const ON_DEVICE_FLOWS: readonly OnDeviceFlow[] = [
  {
    id: 'cryMonitor',
    status: 'active',
    permission: 'microphone',
    trigger: 'optIn',
    defaultOn: false,
    consentBy: ['Owner', 'Parent', 'Caregiver'],
    rawSignal: { stored: false, sent: false },
    dataCategory: 'cryMonitor',
    modelFrom: 'ownServer',
    recipients: ['pushServices'],
    platforms: ['web'],
  },
];

/** The rows of the "Companies and services that receive data" table, in order. */
export const THIRD_PARTY_IDS = [
  'pushServices',
  'alexa',
  'ownDatabaseProvider',
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
  /**
   * Who picks the company: `lotties` (the code names it, such as Amazon for Alexa) or `user` (the person names
   * it herself and Lotties does not choose or contract it: the database provider of OWN_DATABASE_FLOW).
   */
  chosenBy: 'lotties' | 'user';
}

export const THIRD_PARTIES: readonly ThirdParty[] = [
  // Web Push (built): Google FCM, Mozilla, Apple, Microsoft; the payload is encrypted (RFC 8291).
  {
    id: 'pushServices',
    trigger: 'optIn',
    abroad: true,
    creditIds: ['webpush'],
    chosenBy: 'lotties',
  },
  // The Alexa skill (built, off until the owner enables it): Amazon hears the voice and speaks our answers (no baby name unless the parent turns on sayBabyName, no medicine name unless sayMedicineNames, no data about a doctor but a coded specialty).
  { id: 'alexa', trigger: 'optIn', abroad: true, creditIds: [], chosenBy: 'lotties' },
  // Bring your own database (docs/design/47, policy 13): the PostgreSQL provider the baby's Owner names herself
  // (Supabase, Neon or any other); it stores the baby's care records, in the region she picked (so maybe abroad).
  { id: 'ownDatabaseProvider', trigger: 'optIn', abroad: true, creditIds: [], chosenBy: 'user' },
  // "Find address" in the provider sheet: only the typed CEP or text, sent by our server.
  {
    id: 'addressLookup',
    trigger: 'userAction',
    abroad: true,
    creditIds: ['brasilapi', 'viacep', 'nominatim'],
    chosenBy: 'lotties',
  },
  // Links the person taps (Open in maps, WhatsApp, tel:, mailto:) and files she shares.
  { id: 'userLinks', trigger: 'userAction', abroad: true, creditIds: [], chosenBy: 'lotties' },
  // Apple App Store and Google Play (when the native apps are published).
  { id: 'appStores', trigger: 'install', abroad: true, creditIds: [], chosenBy: 'lotties' },
  // The source repository and the default contact channel (public issues, private reports). "Report a problem"
  // (landing/outboundLinks.ts) opens the bug form with four technical facts in the address: version, platform,
  // language, route path without ids (policy 11). Nothing is sent by Lotties itself.
  { id: 'github', trigger: 'userAction', abroad: true, creditIds: [], chosenBy: 'lotties' },
];

/*
 * Bring your own database (docs/design/47-bring-your-own-database.md, docs/design/33-privacy-audit.md section 17):
 * the facts the policy must state about it, held by dataFlows.test.ts against the `own-database` section. A change
 * of any fact (members or reminders become available, a passphrase unlock, another cipher) is a policy change:
 * update it here, in both privacy.<lang>.ts files, byoDatabaseConsent.ts, the audit and the policy version.
 */
export interface OwnDatabaseFlow {
  id: 'ownDatabase';
  /** Off for every baby until its Owner connects a database; hosting by Lotties stays the default. */
  trigger: 'optIn';
  defaultOn: false;
  /** Chosen per baby, and reversible (move back to Lotties-hosted storage). */
  per: 'baby';
  reversible: true;
  /** Only the baby's Owner may connect one (design 47 D11). */
  consentBy: readonly 'Owner'[];
  /** The optional consent recorded before a database is saved (`PUT /me/consents/optional/byo_database`). */
  consentKind: 'byo_database';
  /** The company that stores the records: one the person names (THIRD_PARTIES, `chosenBy: 'user'`). */
  recipient: ThirdPartyId;
  /** The row of "What we collect" that describes what Lotties keeps for it (the connection details). */
  dataCategory: DataCategoryId;
  /** The policy section that describes it. */
  sectionId: PolicySectionId;
  /** The baby's care records that live in her database (design 47 D2). */
  storedThere: readonly (
    | 'events'
    | 'customEventTypes'
    | 'medications'
    | 'prescriptions'
    | 'formulas'
    | 'appointments'
    | 'careProviders'
    | 'vaccinations'
    | 'measurements'
    | 'notes'
  )[];
  /** What stays with Lotties (design 47 D3). */
  staysWithLotties: readonly (
    'account' | 'consents' | 'memberships' | 'babyProfile' | 'settings'
  )[];
  /** Every read and write goes through the Lotties API: the records pass through our servers. */
  throughLottiesServers: true;
  /** The connection details: sealed at rest, but the Lotties server (and so the operator) can open them. */
  connectionDetails: {
    cipher: 'AES-256-GCM';
    keyHeldBy: 'operator';
    readableByLottiesServer: true;
    endToEnd: false;
    shownAgain: false;
    logged: false;
  };
  /** Not offered for such a baby in the first version (design 47 D9, D11). */
  notAvailable: readonly ('reminders' | 'members' | 'doctors')[];
  /** Backups of the database are the person's and her provider's; Lotties keeps no copy (export is offered). */
  backupsBy: 'user';
}

export const OWN_DATABASE_FLOW: OwnDatabaseFlow = {
  id: 'ownDatabase',
  trigger: 'optIn',
  defaultOn: false,
  per: 'baby',
  reversible: true,
  consentBy: ['Owner'],
  consentKind: 'byo_database',
  recipient: 'ownDatabaseProvider',
  dataCategory: 'ownDatabase',
  sectionId: 'own-database',
  storedThere: [
    'events',
    'customEventTypes',
    'medications',
    'prescriptions',
    'formulas',
    'appointments',
    'careProviders',
    'vaccinations',
    'measurements',
    'notes',
  ],
  staysWithLotties: ['account', 'consents', 'memberships', 'babyProfile', 'settings'],
  throughLottiesServers: true,
  connectionDetails: {
    cipher: 'AES-256-GCM',
    keyHeldBy: 'operator',
    readableByLottiesServer: true,
    endToEnd: false,
    shownAgain: false,
    logged: false,
  },
  notAvailable: ['reminders', 'members', 'doctors'],
  backupsBy: 'user',
};

/*
 * Planned data flows: described in the policy, NOT built (no code collects or uses anything for them).
 * Each has its own policy section that must say it is not active and off by default (dataFlows.test.ts),
 * and a `planned` table listing what it would use; none of it is a row of the "What we collect" table.
 * Activating one is a policy change of its own: build it, then update the section, this entry (status
 * `active`, its data categories and recipients), the audit and the policy version.
 */

/** The rows of the planned table of community insights (docs/design/34-community-insights.md), in order. */
export const COMMUNITY_INSIGHT_IDS = [
  'milk',
  'growth',
  'tummyTime',
  'routine',
  'patterns',
  'crying',
] as const;
export type CommunityInsightId = (typeof COMMUNITY_INSIGHT_IDS)[number];

export interface PlannedFlow {
  id: 'communityInsights';
  /** `planned`: not built, nothing collected; the policy states it in the section title and its first note. */
  status: 'planned';
  /** Only after a separate, specific opt-in (never bundled with sign-up or the policy), off by default. */
  trigger: 'optIn';
  defaultOn: false;
  /** Who may give the consent, per baby (the other roles cannot). */
  consentBy: readonly ('Owner' | 'Parent')[];
  /** The policy section that describes it. */
  sectionId: PolicySectionId;
  /** The rows of its `planned` table. */
  rows: readonly CommunityInsightId[];
  /** Companies that would receive data: none (computed on our own servers). */
  recipients: readonly ThirdPartyId[];
  /** The smallest group of babies (from different families) a published statistic may come from. */
  minGroupSize: number;
}

export const PLANNED_FLOWS: readonly PlannedFlow[] = [
  {
    id: 'communityInsights',
    status: 'planned',
    trigger: 'optIn',
    defaultOn: false,
    consentBy: ['Owner', 'Parent'],
    sectionId: 'community-insights',
    rows: COMMUNITY_INSIGHT_IDS,
    recipients: [],
    minGroupSize: 20,
  },
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
  // The Cry monitor's model runs on the device, served by our own server: nothing goes to its authors.
  yamnet: { kind: 'noPersonalData' },
  audioset: { kind: 'noPersonalData' },
  art: { kind: 'noPersonalData' },
};
