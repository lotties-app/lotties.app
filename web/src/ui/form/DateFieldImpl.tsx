import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, useTheme } from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import type { PickerValidDate } from '@mui/x-date-pickers/models';
import { ptBR as pickersPtBR } from '@mui/x-date-pickers/locales';
import { enUS } from 'date-fns/locale/en-US';
import { ptBR } from 'date-fns/locale/pt-BR';
import { useLocale } from '../../i18n/useLocale';
import type { Locale } from '../../i18n/config';
import { RADIUS } from '../../theme/tokens';
import { Icon } from '../Icon';
import { dateFromIso, isoFromDate } from './dateValue';
import { useControlAttributes, useFieldContext } from './fieldContext';
import { palette } from './styles';
import type { DateFieldProps } from './DateField';

const DATE_FNS_LOCALES = { en: enUS, 'pt-BR': ptBR } as const satisfies Record<Locale, object>;

/** From this width up the calendar opens as a popover; below it as a full dialog (touch friendly). */
const DESKTOP_QUERY = '@media (min-width: 600px) and (pointer: fine)';

type DatePickerSlots = NonNullable<React.ComponentProps<typeof DatePicker>['slots']>;

const SLOTS: DatePickerSlots = {
  openPickerIcon: ({ className }: { className?: string }) => (
    <Icon name="calendar" size={20} className={className} />
  ),
  leftArrowIcon: ({ className }: { className?: string }) => (
    <Icon name="chevron-left" size={20} className={className} />
  ),
  rightArrowIcon: ({ className }: { className?: string }) => (
    <Icon name="chevron-right" size={20} className={className} />
  ),
  switchViewIcon: ({ className }: { className?: string }) => (
    <Icon name="expand" size={20} className={className} />
  ),
};

/**
 * The themed, localized date control (MUI X `DatePicker` + date-fns). Loaded on demand by
 * `DateField`, so the pickers stay out of the main chunk. The label is the surrounding `Field`'s.
 */
export default function DateFieldImpl({
  value,
  onChange,
  min,
  max,
  disabled: disabledProp = false,
  'aria-label': ariaLabel,
}: DateFieldProps) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const theme = useTheme();
  const { disabled: fieldDisabled, ...control } = useControlAttributes();
  const labelId = useFieldContext()?.labelId;
  const disabled = disabledProp || fieldDisabled;
  /** Only a date that is not a date reports here; limits are the form's to explain. */
  const [validation, setValidation] = useState<string | null>(null);
  const minDate = min ? dateFromIso(min) : null;
  const maxDate = max ? dateFromIso(max) : null;
  const localeText = useMemo(
    () =>
      locale === 'pt-BR'
        ? pickersPtBR.components.MuiLocalizationProvider.defaultProps.localeText
        : undefined,
    [locale],
  );
  const messageId = `${control.id ?? 'date'}-problem`;
  const invalid = validation !== null || !!control['aria-invalid'];

  return (
    <Box
      role="group"
      aria-labelledby={labelId}
      aria-label={labelId ? undefined : ariaLabel}
      aria-describedby={
        [control['aria-describedby'], validation ? messageId : null].filter(Boolean).join(' ') ||
        undefined
      }
    >
      <LocalizationProvider
        dateAdapter={AdapterDateFns}
        adapterLocale={DATE_FNS_LOCALES[locale]}
        localeText={localeText}
      >
        <DatePicker
          value={dateFromIso(value) as PickerValidDate | null}
          onChange={(next) => onChange(isoFromDate(next))}
          onError={(kind) => setValidation(kind === 'invalidDate' ? kind : null)}
          minDate={(minDate ?? undefined) as PickerValidDate | undefined}
          maxDate={(maxDate ?? undefined) as PickerValidDate | undefined}
          disabled={disabled}
          desktopModeMediaQuery={DESKTOP_QUERY}
          slots={SLOTS}
          slotProps={{
            textField: {
              id: control.id,
              variant: 'filled',
              hiddenLabel: true,
              fullWidth: true,
              error: invalid,
              sx: {
                '& .MuiPickersInputBase-root, & .MuiPickersFilledInput-root': {
                  minHeight: 48,
                  borderRadius: `${RADIUS.input}px`,
                  backgroundColor: palette(theme).surfaceRaised,
                  '&::before, &::after': { display: 'none' },
                  boxShadow: invalid ? `0 0 0 2px ${palette(theme).error.main}` : 'none',
                },
                '& .Mui-focused': { boxShadow: `0 0 0 2px ${palette(theme).primary.main}` },
              },
            },
            dialog: { sx: { '& .MuiDialog-paper': { maxWidth: 360 } } },
          }}
        />
        {validation && (
          <Box
            id={messageId}
            role="status"
            sx={{ mt: 0.75, fontSize: '0.8125rem', color: palette(theme).error.main }}
          >
            {t('ui.date.invalid')}
          </Box>
        )}
      </LocalizationProvider>
    </Box>
  );
}
