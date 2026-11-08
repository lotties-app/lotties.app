import { useTranslation } from 'react-i18next';
import { Box, Checkbox, FormControlLabel, Stack, Typography } from '@mui/material';

const FACTS = ['fact1', 'fact2', 'fact3', 'fact4', 'fact5', 'fact6'] as const;

/**
 * Step 4: the optional consent `byo_database` (docs/design/47-bring-your-own-database.md section
 * 10), asked before anything is sent: the server needs it before it saves or tests a database.
 * Recorded when the person presses "Save and test", never earlier.
 */
export function ConsentStep({
  provider,
  agreed,
  onAgreed,
}: {
  provider: string;
  agreed: boolean;
  onAgreed: (agreed: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2">{t('byoDatabase.consent.intro', { provider })}</Typography>
      <Box component="ul" sx={{ m: 0, pl: 3, display: 'grid', gap: 0.75 }}>
        {FACTS.map((fact) => (
          <Typography key={fact} component="li" variant="body2">
            {t(`byoDatabase.consent.${fact}`, { provider })}
          </Typography>
        ))}
      </Box>
      <FormControlLabel
        control={<Checkbox checked={agreed} onChange={(event) => onAgreed(event.target.checked)} />}
        label={t('byoDatabase.consent.agree', { provider })}
      />
    </Stack>
  );
}
