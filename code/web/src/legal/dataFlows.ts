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
  'widgetUpdates',
  'cryMonitor',
  'assistants',
  'rest',
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
  'appPushServices',
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
  // Silent pushes for the widgets (docs/design/37b-widget-silent-push.md): Google FCM for the Android app only (the iOS
  // receive path is not shipped; naming Apple APNs needs its own policy change); the app's push token and a message with
  // no content ("sync"), only while a Lotties widget is installed, plus what the Firebase library sends Google to make
  // the token.
  { id: 'appPushServices', trigger: 'userAction', abroad: true, creditIds: [] },
  // The Alexa skill (built, off until the owner enables it): Amazon hears the voice and speaks our answers (no baby name unless the parent turns on sayBabyName, no medicine name unless sayMedicineNames, no data about a doctor but a coded specialty).
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
  // The source repository and the default contact channel (public issues, private reports). "Report a problem"
  // (landing/outboundLinks.ts) opens the bug form with four technical facts in the address: version, platform,
  // language, route path without ids (policy 11). Nothing is sent by Lotties itself.
  { id: 'github', trigger: 'userAction', abroad: true, creditIds: [] },
];

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
