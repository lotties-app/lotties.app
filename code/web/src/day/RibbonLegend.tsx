import { useTranslation } from 'react-i18next';
import { Box, ButtonBase, Typography } from '@mui/material';
import { CATEGORY_NAMES, RADIUS, type CategoryName } from '../theme/tokens';
import { Illustration } from '../ui/illustrations';
import { focusRing, palette } from '../ui/form/styles';
import { isCategoryShown } from './dayModel';

/** The illustration that stands for each category in the legend. */
const LEGEND_ART: Readonly<Record<CategoryName, string>> = {
  sleep: 'nap',
  feeding: 'bottle',
  diaper: 'diaper',
  health: 'medication',
  care: 'bath',
  activity: 'tummy_time',
  nightWaking: 'night_waking',
  custom: 'custom',
};

interface Props {
  /** Categories drawn on the ribbon (filtered or not). */
  present: ReadonlySet<CategoryName>;
  /** Categories the filter knows (the baby's types); only these can be toggled. */
  filterable: readonly CategoryName[];
  /** The Day filter selection (empty = everything). */
  selected: ReadonlySet<CategoryName>;
  onToggle: (category: CategoryName) => void;
}

/**
 * What the colours of the ribbon mean, as toggles: each chip shows or hides its category on the
 * ribbon and in the rows (the same selection as the filter sheet). Night waking is part of sleep,
 * so it is a key, not a toggle.
 */
export function RibbonLegend({ present, filterable, selected, onToggle }: Props) {
  const { t } = useTranslation();
  const shown = CATEGORY_NAMES.filter((name) => present.has(name));
  if (shown.length === 0) return null;
  return (
    <Box sx={{ display: 'grid', gap: 0.5 }}>
      <Box
        component="ul"
        aria-label={t('day.ribbon.legend')}
        sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '8px 6px' }}
      >
        {shown.map((name) =>
          filterable.includes(name) ? (
            <Box component="li" key={name}>
              <LegendChip
                category={name}
                on={isCategoryShown(selected, name)}
                onToggle={() => onToggle(name)}
              />
            </Box>
          ) : (
            <Box
              component="li"
              key={name}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                px: 0.5,
                minHeight: 36,
              }}
            >
              <Illustration name={LEGEND_ART[name]} size={24} />
              <Typography variant="caption" color="text.secondary">
                {t(`day.category.${name}`)}
              </Typography>
            </Box>
          ),
        )}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ opacity: 0.85 }}>
        {t('day.ribbon.legendHint')}
      </Typography>
    </Box>
  );
}

function LegendChip({
  category,
  on,
  onToggle,
}: {
  category: CategoryName;
  on: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ButtonBase
      aria-pressed={on}
      onClick={onToggle}
      sx={(theme) => ({
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        minHeight: 36,
        pl: 0.5,
        pr: 1.25,
        borderRadius: `${RADIUS.pill}px`,
        font: 'inherit',
        fontSize: '0.8125rem',
        backgroundColor: on ? palette(theme).surfaceRaised : 'transparent',
        color: on ? palette(theme).text.primary : palette(theme).text.secondary,
        boxShadow: on ? 'none' : `inset 0 0 0 1px ${palette(theme).hairline}`,
        textDecoration: on ? 'none' : 'line-through',
        textDecorationColor: palette(theme).text.secondary,
        // A 44px tall touch target around the 36px chip.
        '&::after': { content: '""', position: 'absolute', inset: '-4px 0' },
        '&:focus-visible': { outline: focusRing(theme), outlineOffset: 2 },
        '& svg[data-illustration]': { opacity: on ? 1 : 0.4 },
        '@media (forced-colors: active)': { border: '1px solid ButtonText' },
      })}
    >
      <Illustration name={LEGEND_ART[category]} size={24} />
      {t(`day.category.${category}`)}
    </ButtonBase>
  );
}
