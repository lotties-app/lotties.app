import { TextField } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { isLocalePreference, LOCALES } from '../i18n/config';
import { useLocale } from '../i18n/useLocale';

/** Language setting: system default or one of the supported languages, each in its own name. */
export function LanguageSection() {
  const { t } = useTranslation();
  const { preference, setPreference } = useLocale();
  return (
    <TextField
      select
      label={t('settings.language.label')}
      value={preference}
      onChange={(e) => {
        if (isLocalePreference(e.target.value)) setPreference(e.target.value);
      }}
      slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
    >
      <option value="system">{t('settings.language.system')}</option>
      {LOCALES.map((locale) => (
        <option key={locale.code} value={locale.code} lang={locale.code}>
          {locale.nativeName}
        </option>
      ))}
    </TextField>
  );
}
