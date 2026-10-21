import { useTranslation } from 'react-i18next';
import { Box, Button, ButtonBase } from '@mui/material';
import { SheetFrame } from '../now/ui/SheetFrame';
import { RADIUS, type CategoryName } from '../theme/tokens';
import { CategoryIcon } from '../ui/CategoryIcon';
import { Icon } from '../ui/Icon';
import { palette } from '../ui/form/styles';
import { CATEGORY_ICON } from './categoryIcons';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Categories the baby's event types have. */
  categories: readonly CategoryName[];
  selected: ReadonlySet<CategoryName>;
  onChange: (selected: ReadonlySet<CategoryName>) => void;
}

/**
 * The filter sheet: one checkable row per category (icon and name), several at once, with Clear
 * and Done. No chips to scroll sideways. An empty selection shows every category.
 */
export function DayFilterSheet({ open, onClose, categories, selected, onChange }: Props) {
  const { t } = useTranslation();
  const toggle = (category: CategoryName) => {
    const next = new Set(selected);
    if (!next.delete(category)) next.add(category);
    onChange(next);
  };
  return (
    <SheetFrame open={open} onClose={onClose} title={t('day.filterTitle')}>
      <Box role="group" aria-label={t('day.filterTitle')} sx={{ display: 'grid', gap: 1 }}>
        {categories.map((category) => {
          const checked = selected.has(category);
          return (
            <ButtonBase
              key={category}
              role="checkbox"
              aria-checked={checked}
              onClick={() => toggle(category)}
              sx={(theme) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                minHeight: 56,
                px: 1.5,
                borderRadius: `${RADIUS.input}px`,
                justifyContent: 'flex-start',
                textAlign: 'start',
                backgroundColor: palette(theme).surfaceRaised,
                boxShadow: checked ? `inset 0 0 0 1.5px ${palette(theme).primary.main}` : 'none',
                fontWeight: checked ? 600 : 400,
                font: 'inherit',
              })}
            >
              <CategoryIcon name={CATEGORY_ICON[category]} category={category} size={20} />
              <Box component="span" sx={{ flexGrow: 1, minWidth: 0 }}>
                {t(`day.category.${category}`)}
              </Box>
              {checked && <Icon name="check" size={20} />}
            </ButtonBase>
          );
        })}
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button
          variant="outlined"
          disabled={selected.size === 0}
          onClick={() => onChange(new Set())}
          sx={{ flex: '1 1 0', minHeight: 48, borderRadius: '999px' }}
        >
          {t('day.clear')}
        </Button>
        <Button
          variant="contained"
          onClick={onClose}
          sx={{ flex: '1 1 0', minHeight: 48, borderRadius: '999px' }}
        >
          {t('common.done')}
        </Button>
      </Box>
    </SheetFrame>
  );
}
