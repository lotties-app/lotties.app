/*
 * What people can say to each voice assistant (docs/VOICE-COMMANDS.md), as data for the Voice
 * commands page (settings/VoiceCommandsPage.tsx). Every entry points at the real thing it describes,
 * and voiceCommands.test.ts fails when one of them is gone or a new one is missing here:
 * - `alexaIntent`: an intent of alexa/interaction-model.{en-US,pt-BR}.json;
 * - `tools`: MCP tools of code/api/src/Lotties.Api/Assistants/Mcp/McpToolCatalog.cs that the Siri
 *   intents (LottiesSiriIntents.swift) or the Android voice catalog (VoiceCatalog.kt) call;
 * - `siriPhrases`: keys of code/mobile/ios/App/App/en.lproj/AppShortcuts.strings;
 * - `androidShortcut`: a shortcut id of code/mobile/android/app/src/main/res/xml/shortcuts.xml.
 * Texts live in the catalog: `voiceCommands.say.<say>` (the phrase or shortcut, per assistant) and
 * `voiceCommands.actions.<action>.does|answer` (shared: the same server sentence answers every
 * assistant). Static content: nothing here reads or sends data.
 */

export const VOICE_ASSISTANTS = ['siri', 'alexa', 'android'] as const;
export type VoiceAssistant = (typeof VOICE_ASSISTANTS)[number];

export const VOICE_TOPICS = ['log', 'ask', 'undo', 'medication'] as const;
export type VoiceTopic = (typeof VOICE_TOPICS)[number];

/** The shape every entry has; the catalog below keeps its literal keys (typed `t()` calls). */
export interface VoiceCommandShape {
  say: string;
  action: string;
  topic: VoiceTopic;
  alexaIntent?: string;
  tools?: readonly string[];
  siriPhrases?: readonly string[];
  androidShortcut?: string;
}

/** The activities of the generic Siri and Android "activity" entry (SiriActivity, VoiceCatalog.ACTIVITIES). */
const ACTIVITY_TOOLS = [
  'log_bath',
  'log_tummy_time',
  'log_belly_massage',
  'log_nasal_suction',
  'log_nail_trim',
  'log_skin_care',
  'log_outdoor',
  'log_fussy',
  'log_spit_up',
  'log_teething',
  'log_breast_pump',
] as const;

/** The questions of the generic Siri and Android "ask" entry (SiriAskTopic, VoiceCatalog.TOPICS). */
const ASK_TOOLS = [
  'get_last_feed',
  'get_next_nap_window',
  'get_next_feed',
  'get_next_diaper',
  'get_last_diaper',
  'get_diapers_today',
  'get_bottle_today',
  'get_feeds_today',
  'get_sleep_today',
  'get_day_summary',
  'get_week_summary',
  'get_next_appointment',
  'get_due_vaccines',
] as const;

const HEALTH_TOOLS = ['log_temperature', 'log_symptom', 'log_belly_pain'] as const;

/** Siri intents that have no spoken phrase: in the Shortcuts app and Spotlight only. */
const SHORTCUTS_ONLY_TOOLS = [
  'get_sleep_status',
  'get_diapers_average',
  'get_bottle_average',
  'get_cry_reasons',
  'list_babies',
  'get_baby_profile',
  'log_milestone',
] as const;

export const VOICE_COMMANDS = {
  siri: [
    {
      say: 'siriDiaper',
      action: 'diaper',
      topic: 'log',
      tools: ['log_diaper'],
      siriPhrases: [
        'Log a ${content} diaper in ${applicationName}',
        'Log a diaper in ${applicationName}',
        'Diaper change in ${applicationName}',
      ],
    },
    {
      say: 'siriBottle',
      action: 'bottleSiri',
      topic: 'log',
      tools: ['log_bottle'],
      siriPhrases: ['Log a bottle in ${applicationName}'],
    },
    {
      say: 'siriBreastfeed',
      action: 'nursing',
      topic: 'log',
      tools: ['log_nursing'],
      siriPhrases: ['Start a breastfeed in ${applicationName}'],
    },
    {
      say: 'siriSleep',
      action: 'sleepChange',
      topic: 'log',
      tools: ['log_sleep_start', 'log_sleep_end'],
      siriPhrases: ['Baby ${change} in ${applicationName}'],
    },
    {
      say: 'siriActivity',
      action: 'activity',
      topic: 'log',
      tools: ACTIVITY_TOOLS,
      siriPhrases: ['Log ${activity} in ${applicationName}', 'Start ${activity} in ${applicationName}'],
    },
    {
      say: 'siriHealth',
      action: 'health',
      topic: 'log',
      tools: HEALTH_TOOLS,
      siriPhrases: ['Log ${health} in ${applicationName}'],
    },
    {
      say: 'siriAsk',
      action: 'askTopic',
      topic: 'ask',
      tools: ASK_TOOLS,
      siriPhrases: ['Ask ${topic} in ${applicationName}'],
    },
    { say: 'siriShortcuts', action: 'shortcutsApp', topic: 'ask', tools: SHORTCUTS_ONLY_TOOLS },
    {
      say: 'siriUndo',
      action: 'undo',
      topic: 'undo',
      tools: ['request_delete_last_entry'],
      siriPhrases: ['Undo the last entry in ${applicationName}'],
    },
    { say: 'noMedication', action: 'medicationNotAvailable', topic: 'medication' },
  ],
  alexa: [
    { say: 'alexaSleepStart', action: 'sleepStart', topic: 'log', alexaIntent: 'SleepStartIntent' },
    { say: 'alexaSleepEnd', action: 'sleepEnd', topic: 'log', alexaIntent: 'SleepEndIntent' },
    { say: 'alexaBottle', action: 'bottle', topic: 'log', alexaIntent: 'BottleIntent' },
    { say: 'alexaNursing', action: 'nursing', topic: 'log', alexaIntent: 'NursingIntent' },
    { say: 'alexaDiaper', action: 'diaper', topic: 'log', alexaIntent: 'DiaperIntent' },
    { say: 'alexaBath', action: 'bath', topic: 'log', alexaIntent: 'BathIntent' },
    { say: 'alexaTummyTime', action: 'tummyTime', topic: 'log', alexaIntent: 'TummyTimeIntent' },
    { say: 'alexaBreastPump', action: 'breastPump', topic: 'log', alexaIntent: 'BreastPumpIntent' },
    {
      say: 'alexaBellyMassage',
      action: 'bellyMassage',
      topic: 'log',
      alexaIntent: 'BellyMassageIntent',
    },
    { say: 'alexaFussy', action: 'fussy', topic: 'log', alexaIntent: 'FussyIntent' },
    { say: 'alexaOutdoor', action: 'outdoor', topic: 'log', alexaIntent: 'OutdoorIntent' },
    {
      say: 'alexaNasalSuction',
      action: 'nasalSuction',
      topic: 'log',
      alexaIntent: 'NasalSuctionIntent',
    },
    { say: 'alexaNailTrim', action: 'nailTrim', topic: 'log', alexaIntent: 'NailTrimIntent' },
    { say: 'alexaSkinCare', action: 'skinCare', topic: 'log', alexaIntent: 'SkinCareIntent' },
    { say: 'alexaSpitUp', action: 'spitUp', topic: 'log', alexaIntent: 'SpitUpIntent' },
    { say: 'alexaTeething', action: 'teething', topic: 'log', alexaIntent: 'TeethingIntent' },
    { say: 'alexaMilestone', action: 'milestone', topic: 'log', alexaIntent: 'MilestoneIntent' },
    { say: 'alexaSymptom', action: 'symptom', topic: 'log', alexaIntent: 'SymptomIntent' },
    {
      say: 'alexaTemperature',
      action: 'temperature',
      topic: 'log',
      alexaIntent: 'TemperatureIntent',
    },
    { say: 'alexaBellyPain', action: 'bellyPain', topic: 'log', alexaIntent: 'BellyPainIntent' },
    { say: 'alexaLastFeed', action: 'lastFeed', topic: 'ask', alexaIntent: 'LastFeedIntent' },
    { say: 'alexaLastDiaper', action: 'lastDiaper', topic: 'ask', alexaIntent: 'LastDiaperIntent' },
    {
      say: 'alexaSleepStatus',
      action: 'sleepStatus',
      topic: 'ask',
      alexaIntent: 'SleepStatusIntent',
    },
    {
      say: 'alexaDiapersToday',
      action: 'diapersToday',
      topic: 'ask',
      alexaIntent: 'DiapersTodayIntent',
    },
    { say: 'alexaFeedsToday', action: 'feedsToday', topic: 'ask', alexaIntent: 'FeedsTodayIntent' },
    {
      say: 'alexaBottleToday',
      action: 'bottleToday',
      topic: 'ask',
      alexaIntent: 'BottleTodayIntent',
    },
    { say: 'alexaSleepToday', action: 'sleepToday', topic: 'ask', alexaIntent: 'SleepTodayIntent' },
    { say: 'alexaDaySummary', action: 'daySummary', topic: 'ask', alexaIntent: 'DaySummaryIntent' },
    {
      say: 'alexaWeekSummary',
      action: 'weekSummary',
      topic: 'ask',
      alexaIntent: 'WeekSummaryIntent',
    },
    {
      say: 'alexaNextNap',
      action: 'nextNapWindow',
      topic: 'ask',
      alexaIntent: 'NextNapWindowIntent',
    },
    { say: 'alexaNextFeed', action: 'nextFeed', topic: 'ask', alexaIntent: 'NextFeedIntent' },
    { say: 'alexaNextDiaper', action: 'nextDiaper', topic: 'ask', alexaIntent: 'NextDiaperIntent' },
    {
      say: 'alexaDiapersAverage',
      action: 'diapersAverage',
      topic: 'ask',
      alexaIntent: 'DiapersAverageIntent',
    },
    {
      say: 'alexaBottleAverage',
      action: 'bottleAverage',
      topic: 'ask',
      alexaIntent: 'BottleAverageIntent',
    },
    {
      say: 'alexaNextAppointment',
      action: 'nextAppointment',
      topic: 'ask',
      alexaIntent: 'NextAppointmentIntent',
    },
    {
      say: 'alexaDueVaccines',
      action: 'dueVaccines',
      topic: 'ask',
      alexaIntent: 'DueVaccinesIntent',
    },
    {
      say: 'alexaCryReasons',
      action: 'cryReasons',
      topic: 'ask',
      alexaIntent: 'CryReasonsIntent',
    },
    {
      say: 'alexaBabyProfile',
      action: 'babyProfile',
      topic: 'ask',
      alexaIntent: 'BabyProfileIntent',
    },
    {
      say: 'alexaListBabies',
      action: 'listBabies',
      topic: 'ask',
      alexaIntent: 'ListBabiesIntent',
    },
    { say: 'alexaSetBaby', action: 'setBaby', topic: 'ask', alexaIntent: 'SetBabyHelpIntent' },
    { say: 'alexaPanel', action: 'panel', topic: 'ask', alexaIntent: 'PanelIntent' },
    { say: 'alexaUndo', action: 'undo', topic: 'undo', alexaIntent: 'RequestDeleteLastIntent' },
    {
      say: 'alexaMedicationLog',
      action: 'medicationLog',
      topic: 'medication',
      alexaIntent: 'MedicationIntent',
    },
    {
      say: 'alexaMedicationReminder',
      action: 'medicationReminder',
      topic: 'medication',
      alexaIntent: 'MedicationReminderIntent',
    },
  ],
  android: [
    {
      say: 'androidDiaperWet',
      action: 'diaper',
      topic: 'log',
      tools: ['log_diaper'],
      androidShortcut: 'diaper_wet',
    },
    {
      say: 'androidDiaperDirty',
      action: 'diaper',
      topic: 'log',
      tools: ['log_diaper'],
      androidShortcut: 'diaper_dirty',
    },
    {
      say: 'androidDiaperBoth',
      action: 'diaper',
      topic: 'log',
      tools: ['log_diaper'],
      androidShortcut: 'diaper_both',
    },
    {
      say: 'androidBottle',
      action: 'bottleAndroid',
      topic: 'log',
      tools: ['log_bottle'],
      androidShortcut: 'bottle',
    },
    {
      say: 'androidBreastfeed',
      action: 'nursing',
      topic: 'log',
      tools: ['log_nursing'],
      androidShortcut: 'breastfeed',
    },
    {
      say: 'androidFellAsleep',
      action: 'sleepStart',
      topic: 'log',
      tools: ['log_sleep_start'],
      androidShortcut: 'fell_asleep',
    },
    {
      say: 'androidWokeUp',
      action: 'sleepEnd',
      topic: 'log',
      tools: ['log_sleep_end'],
      androidShortcut: 'woke_up',
    },
    {
      say: 'androidActivity',
      action: 'activity',
      topic: 'log',
      tools: ACTIVITY_TOOLS,
      androidShortcut: 'activity',
    },
    {
      say: 'androidHealth',
      action: 'health',
      topic: 'log',
      tools: HEALTH_TOOLS,
      androidShortcut: 'health',
    },
    {
      say: 'androidAskLastFeed',
      action: 'lastFeed',
      topic: 'ask',
      tools: ['get_last_feed'],
      androidShortcut: 'ask_last_feed',
    },
    {
      say: 'androidAsk',
      action: 'askTopic',
      topic: 'ask',
      tools: ASK_TOOLS,
      androidShortcut: 'ask',
    },
    {
      say: 'androidUndo',
      action: 'undo',
      topic: 'undo',
      tools: ['request_delete_last_entry'],
      androidShortcut: 'undo',
    },
    { say: 'noMedication', action: 'medicationNotAvailable', topic: 'medication' },
  ],
} as const satisfies Record<VoiceAssistant, readonly VoiceCommandShape[]>;

export type VoiceCommand = (typeof VOICE_COMMANDS)[VoiceAssistant][number];

/** The commands of one assistant and topic, in catalog order. */
export function commandsOf(assistant: VoiceAssistant, topic: VoiceTopic): VoiceCommand[] {
  const all: readonly VoiceCommand[] = VOICE_COMMANDS[assistant];
  return all.filter((command) => command.topic === topic);
}

/** The assistant this device runs (the iPhone app: Siri, the Android app: Android), else Alexa. */
export function defaultAssistant(platform: 'ios' | 'android' | null): VoiceAssistant {
  if (platform === 'ios') return 'siri';
  if (platform === 'android') return 'android';
  return 'alexa';
}
