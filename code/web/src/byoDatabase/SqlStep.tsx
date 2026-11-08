import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import { copyText } from '../util/copyText';
import { buildSetupSql, isValidRoleName, rolesValid, type SetupRoles } from './setupSql';

const ROLE_KEYS = ['appRole', 'migratorRole'] as const;

/**
 * Step 2: the SQL to run in the provider's SQL editor, built in the browser from the role names
 * (nothing is sent). The passwords are random, shown only here, and can be regenerated.
 */
export function SqlStep({
  roles,
  onRoles,
  onRegenerate,
}: {
  roles: SetupRoles;
  onRoles: (roles: SetupRoles) => void;
  onRegenerate: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<boolean | null>(null);
  // The passwords are forgotten once the server saved them: "Regenerate" makes new ones.
  const hasPasswords = !!roles.appPassword && !!roles.migratorPassword;
  const valid = rolesValid(roles) && hasPasswords;
  const sql = valid ? buildSetupSql(roles) : '';
  const roleField = (key: (typeof ROLE_KEYS)[number]) => (
    <TextField
      key={key}
      label={t(`byoDatabase.sql.${key}`)}
      value={roles[key]}
      onChange={(event) => {
        setCopied(null);
        onRoles({ ...roles, [key]: event.target.value.trim().toLowerCase() });
      }}
      error={!isValidRoleName(roles[key])}
      helperText={isValidRoleName(roles[key]) ? undefined : t('byoDatabase.sql.roleInvalid')}
      slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
      fullWidth
    />
  );
  return (
    <Stack spacing={2}>
      <Typography variant="body2">{t('byoDatabase.sql.intro')}</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        {ROLE_KEYS.map(roleField)}
      </Stack>
      {valid ? (
        <Box
          component="pre"
          aria-label={t('byoDatabase.sql.label')}
          tabIndex={0}
          sx={{
            m: 0,
            p: 1.5,
            maxHeight: 320,
            maxWidth: '100%',
            overflow: 'auto',
            bgcolor: 'action.hover',
            borderRadius: 1,
            fontSize: 12,
            whiteSpace: 'pre',
          }}
        >
          {sql}
        </Box>
      ) : (
        <Typography variant="body2" color={hasPasswords ? 'error' : 'text.secondary'}>
          {t(hasPasswords ? 'byoDatabase.sql.rolesDiffer' : 'byoDatabase.sql.passwordsCleared')}
        </Typography>
      )}
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          disabled={!valid}
          onClick={async () => setCopied(await copyText(sql))}
          sx={{ minHeight: 44 }}
        >
          {t('byoDatabase.sql.copy')}
        </Button>
        <Button
          onClick={() => {
            setCopied(null);
            onRegenerate();
          }}
          sx={{ minHeight: 44 }}
        >
          {t('byoDatabase.sql.regenerate')}
        </Button>
      </Stack>
      {copied !== null && (
        <Typography variant="body2" role="status" color={copied ? 'success.main' : 'error'}>
          {t(copied ? 'byoDatabase.sql.copied' : 'byoDatabase.sql.copyFailed')}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary">
        {t('byoDatabase.sql.passwordsNote')}
      </Typography>
    </Stack>
  );
}
