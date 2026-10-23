import {
  canDecideProposals,
  canPropose,
  canSeeAppointments,
  canSeeFamilyRecords,
  canWrite,
  isOwner,
} from '../baby/permissions';
import type { Baby } from '../db/models';
import type { IconName } from '../ui/icons';

/*
 * The Hub's catalogue: every place the Hub can open, in which section it sits and who sees it.
 * Pure data and rules; the page adds the live parts (badges, search, shortcuts). Titles and hints
 * live in the catalog under `hub.entries.<id>`.
 */

export const HUB_SECTIONS = ['care', 'family', 'app'] as const;
export type HubSectionId = (typeof HUB_SECTIONS)[number];

export const HUB_ENTRY_IDS = [
  'appointments',
  'providers',
  'vaccines',
  'growth',
  'medicines',
  'formulas',
  'notes',
  'fromDoctor',
  'myProposals',
  'patients',
  'members',
  'invite',
  'doctorAccess',
  'settings',
  'import',
  'updates',
  'about',
] as const;
export type HubEntryId = (typeof HUB_ENTRY_IDS)[number];

export interface HubEntry {
  id: HubEntryId;
  section: HubSectionId;
  icon: IconName;
  to: string;
}

/** In the order the sections list them. */
export const HUB_ENTRIES: readonly HubEntry[] = [
  { id: 'appointments', section: 'care', icon: 'event', to: '/appointments' },
  { id: 'providers', section: 'care', icon: 'stethoscope', to: '/hub/providers' },
  { id: 'vaccines', section: 'care', icon: 'vaccine', to: '/vaccines' },
  { id: 'growth', section: 'care', icon: 'ruler', to: '/insights#growth' },
  { id: 'medicines', section: 'care', icon: 'pill', to: '/hub/medicines' },
  { id: 'formulas', section: 'care', icon: 'flask', to: '/hub/formulas' },
  { id: 'notes', section: 'care', icon: 'note', to: '/notes' },
  { id: 'fromDoctor', section: 'care', icon: 'stethoscope', to: '/from-doctor' },
  { id: 'myProposals', section: 'care', icon: 'stethoscope', to: '/proposals' },
  { id: 'patients', section: 'care', icon: 'users', to: '/patients' },
  { id: 'members', section: 'family', icon: 'users', to: '/hub/family' },
  { id: 'invite', section: 'family', icon: 'user-plus', to: '/hub/family#invite' },
  { id: 'doctorAccess', section: 'family', icon: 'stethoscope', to: '/hub/family#doctor-access' },
  { id: 'settings', section: 'app', icon: 'settings', to: '/settings' },
  { id: 'import', section: 'app', icon: 'upload-file', to: '/hub/import' },
  { id: 'updates', section: 'app', icon: 'refresh', to: '/hub/updates' },
  { id: 'about', section: 'app', icon: 'info', to: '/hub/about' },
];

export interface HubContext {
  /** The selected baby; `undefined` for a doctor with no baby of her own, or before one exists. */
  baby: Baby | undefined;
  /** Whether the user has patients (babies shared with her as a Doctor). */
  hasPatients: boolean;
  /** Whether the baby has a doctor, or something from one (the "From your doctor" inbox). */
  hasDoctorContent: boolean;
  /** The iOS/Android app: store releases update it, so there is no update check. */
  native: boolean;
}

/** Whether the person sees the entry (role-aware: the server enforces the same rules). */
export function isEntryVisible(id: HubEntryId, ctx: HubContext): boolean {
  const { baby } = ctx;
  switch (id) {
    case 'settings':
    case 'about':
      return true;
    case 'updates':
      return !ctx.native;
    case 'patients':
      return ctx.hasPatients;
    case 'appointments':
      return !!baby && canSeeAppointments(baby);
    case 'providers':
      // The directory names the family's own doctors and clinics: never shown to the Doctor.
      return !!baby && canSeeFamilyRecords(baby);
    case 'fromDoctor':
      return !!baby && canDecideProposals(baby) && ctx.hasDoctorContent;
    case 'myProposals':
      return !!baby && canPropose(baby);
    case 'invite':
    case 'doctorAccess':
      return !!baby && isOwner(baby);
    case 'import':
      return !!baby && canWrite(baby);
    case 'vaccines':
    case 'growth':
    case 'medicines':
    case 'formulas':
    case 'notes':
    case 'members':
      return !!baby;
  }
}

export function visibleEntries(ctx: HubContext): HubEntry[] {
  return HUB_ENTRIES.filter((entry) => isEntryVisible(entry.id, ctx));
}

/** Entries that can be a shortcut: the baby's care and family places, not the app's own pages. */
export function canBeShortcut(entry: HubEntry): boolean {
  return entry.section !== 'app';
}

/**
 * Where shortcuts start before the person has used anything (a new account): the things parents
 * open most, in this order.
 */
export const DEFAULT_SHORTCUT_ORDER: readonly HubEntryId[] = [
  'vaccines',
  'appointments',
  'growth',
  'medicines',
  'notes',
  'fromDoctor',
  'patients',
  'myProposals',
  'formulas',
  'members',
  'providers',
];

export const SHORTCUT_COUNT = 4;
