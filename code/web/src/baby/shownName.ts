import { t as translate } from '../i18n/i18n';

/*
 * Names are optional (docs/design/45-privacy-first-onboarding.md): a baby or a person shows the
 * real name when there is one, else a label. Presets are stored as codes and localized here; any
 * other text is a custom label shown as typed.
 */

export const BABY_LABEL_PRESETS = ['baby', 'girl', 'boy'] as const;
export const ROLE_LABEL_PRESETS = [
  'mother',
  'father',
  'stepMother',
  'stepFather',
  'sister',
  'brother',
  'grandmother',
  'grandfather',
  'friend',
] as const;

export const LABEL_MAX_LENGTH = 100;

type BabyPreset = (typeof BABY_LABEL_PRESETS)[number];
type RolePreset = (typeof ROLE_LABEL_PRESETS)[number];

/** `true` when `label` is one of the preset codes (else it is a custom text). */
export const isBabyLabelPreset = (label: string): label is BabyPreset =>
  (BABY_LABEL_PRESETS as readonly string[]).includes(label);
export const isRoleLabelPreset = (label: string): label is RolePreset =>
  (ROLE_LABEL_PRESETS as readonly string[]).includes(label);

/** The text of a baby label: a preset localized, a custom text as typed, nothing = Baby. */
export function babyLabelText(label: string | null | undefined): string {
  const value = label?.trim() ?? '';
  if (!value) return translate('baby.labels.baby');
  return isBabyLabelPreset(value) ? translate(`baby.labels.${value}`) : value;
}

/** The text of a person's role label; `''` when none. */
export function roleLabelText(label: string | null | undefined): string {
  const value = label?.trim() ?? '';
  if (!value) return '';
  return isRoleLabelPreset(value) ? translate(`profile.roleLabels.${value}`) : value;
}

/** What screens show for a baby: the name, else the label. Never empty. */
export function babyShownName(baby: { name: string; label?: string | null }): string {
  return baby.name.trim() || babyLabelText(baby.label);
}

/**
 * What screens show for a person: the name, else the role label, else `fallback`. A doctor who does
 * not share her name is shown by her specialty (`specialty`).
 */
export function personShownName(
  person: { displayName?: string | null; roleLabel?: string | null },
  fallback = '',
  specialty?: string | null,
): string {
  return (
    person.displayName?.trim() ||
    roleLabelText(person.roleLabel) ||
    specialty?.trim() ||
    fallback
  );
}
