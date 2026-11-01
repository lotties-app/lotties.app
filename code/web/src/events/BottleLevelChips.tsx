import { useTranslation } from 'react-i18next';
import { formatNumber } from '../i18n/format';
import { ChipGroup } from '../ui/form';
import { levelChoices, type LevelShare } from './bottleSegments';

const SHARE_KEY = {
  full: 'feedingAmounts.level.share.full',
  threeQuarters: 'feedingAmounts.level.share.threeQuarters',
  half: 'feedingAmounts.level.share.half',
  quarter: 'feedingAmounts.level.share.quarter',
  empty: 'feedingAmounts.level.share.empty',
} as const satisfies Record<LevelShare, string>;

interface Props {
  /** Prepared amount (ml); no chips without it. */
  preparedMl: number | null;
  /** No choice above this level (where the stretch started), when known. */
  ceilingMl?: number | null;
  /** The chosen level (ml), if any. */
  value: number | null;
  onChange: (leftMl: number) => void;
  'aria-label': string;
  disabled?: boolean;
}

/**
 * "What is left in the bottle": full, 3/4, half, 1/4 and empty of the prepared amount as one
 * radio group of 44 px chips ("60 ml · half"). Renders nothing without a prepared amount.
 */
export function BottleLevelChips({
  preparedMl,
  ceilingMl = null,
  value,
  onChange,
  'aria-label': label,
  disabled = false,
}: Props) {
  const { t } = useTranslation();
  const choices = levelChoices(preparedMl, ceilingMl);
  if (choices.length === 0) return null;
  return (
    <ChipGroup
      aria-label={label}
      disabled={disabled}
      value={value === null ? null : String(value)}
      onChange={(next) => {
        if (next !== null) onChange(Number(next));
      }}
      options={choices.map((choice) => ({
        value: String(choice.ml),
        label: t('feedingAmounts.level.chip', {
          ml: formatNumber(choice.ml),
          share: t(SHARE_KEY[choice.share]),
        }),
      }))}
    />
  );
}
