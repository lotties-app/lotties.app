import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import { filledSurface } from './styles';

export interface DateFieldProps {
  /** `yyyy-mm-dd`, or `''` for no date. */
  value: string;
  onChange: (value: string) => void;
  /** Earliest / latest accepted date (`yyyy-mm-dd`). */
  min?: string;
  max?: string;
  /** Accessible name when the control is used without a `Field`. */
  'aria-label'?: string;
  disabled?: boolean;
}

/** The pickers (MUI X, date-fns, locales) load on first use: they are not in the main chunk. */
const DateFieldImpl = lazy(() => import('./DateFieldImpl'));

function DateFieldPlaceholder() {
  const { t } = useTranslation();
  return (
    <Box
      role="status"
      aria-label={t('ui.date.loading')}
      sx={(theme) => ({ ...filledSurface(theme), opacity: 0.6 })}
    />
  );
}

/**
 * A pure date (birth date, measurement date) in the app's language, in the theme, with a dialog
 * on small screens: use it instead of the browser's native date input, which ignores the app
 * locale. Values are `yyyy-mm-dd` strings, so no time zone ever shifts them.
 */
export function DateField(props: DateFieldProps) {
  return (
    <Suspense fallback={<DateFieldPlaceholder />}>
      <DateFieldImpl {...props} />
    </Suspense>
  );
}
