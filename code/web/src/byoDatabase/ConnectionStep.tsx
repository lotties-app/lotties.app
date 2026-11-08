import { useTranslation } from 'react-i18next';
import { Stack, TextField, Typography } from '@mui/material';
import type { ConnectionField, ConnectionForm } from './connectionForm';

const APP_FIELDS: readonly ConnectionField[] = [
  'appHost',
  'appPort',
  'appDatabase',
  'appUsername',
  'appPassword',
];
const MIGRATOR_FIELDS: readonly ConnectionField[] = [
  'migratorHost',
  'migratorPort',
  'migratorUsername',
  'migratorPassword',
];

/** One text field of the connection step; passwords are never prefilled and never autofilled. */
function Field({
  name,
  form,
  onChange,
  showErrors,
  invalid,
}: {
  name: ConnectionField;
  form: ConnectionForm;
  onChange: (form: ConnectionForm) => void;
  showErrors: boolean;
  invalid: readonly ConnectionField[];
}) {
  const { t } = useTranslation();
  const secret = name === 'appPassword' || name === 'migratorPassword';
  const port = name === 'appPort' || name === 'migratorPort';
  const error = showErrors && invalid.includes(name);
  return (
    <TextField
      label={t(`byoDatabase.connection.fields.${name}`)}
      value={form[name]}
      onChange={(event) => onChange({ ...form, [name]: event.target.value })}
      type={secret ? 'password' : 'text'}
      required
      error={error}
      helperText={
        error
          ? t('byoDatabase.connection.required')
          : port
            ? t('byoDatabase.connection.portHint')
            : undefined
      }
      autoComplete={secret ? 'new-password' : 'off'}
      slotProps={{
        htmlInput: {
          autoCapitalize: 'none',
          spellCheck: false,
          ...(port ? { inputMode: 'numeric' as const } : {}),
        },
      }}
      fullWidth
    />
  );
}

/**
 * Step 3: the connection details the provider shows, as separate fields (never a connection
 * string). The app role may use the provider's pooler; the migrator needs the direct or
 * session-mode endpoint. TLS is always verified; a CA is pasted only for a private one.
 */
export function ConnectionStep({
  form,
  onChange,
  showErrors,
  invalid,
}: {
  form: ConnectionForm;
  onChange: (form: ConnectionForm) => void;
  showErrors: boolean;
  invalid: readonly ConnectionField[];
}) {
  const { t } = useTranslation();
  const field = (name: ConnectionField) => (
    <Field
      key={name}
      name={name}
      form={form}
      onChange={onChange}
      showErrors={showErrors}
      invalid={invalid}
    />
  );
  return (
    <Stack spacing={2}>
      <Typography variant="body2">{t('byoDatabase.connection.intro')}</Typography>
      <Typography variant="subtitle1" component="h4">
        {t('byoDatabase.connection.appTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('byoDatabase.connection.appHint')}
      </Typography>
      {APP_FIELDS.map(field)}
      <Typography variant="subtitle1" component="h4">
        {t('byoDatabase.connection.migratorTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('byoDatabase.connection.migratorHint')}
      </Typography>
      {MIGRATOR_FIELDS.map(field)}
      <Typography variant="subtitle1" component="h4">
        {t('byoDatabase.connection.tlsTitle')}
      </Typography>
      <Typography variant="body2">{t('byoDatabase.connection.tlsMode')}</Typography>
      <TextField
        label={t('byoDatabase.connection.fields.caPem')}
        helperText={t('byoDatabase.connection.caHint')}
        value={form.caPem}
        onChange={(event) => onChange({ ...form, caPem: event.target.value })}
        multiline
        minRows={3}
        slotProps={{ htmlInput: { spellCheck: false, maxLength: 32768 } }}
        fullWidth
      />
    </Stack>
  );
}
