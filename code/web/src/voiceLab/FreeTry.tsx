import { useTranslation } from 'react-i18next';
import { Alert, Divider, Paper, Stack, Typography } from '@mui/material';
import { useLocale } from '../i18n/useLocale';
import { wouldDoText } from './commandText';
import { LanguageField } from './LabSetup';
import type { Attempt } from './labModel';
import { ListenControls } from './ListenControls';
import type { VoiceLab } from './useVoiceLab';

/** One free try in plain words: what the phone heard and what Lotties would do with it. */
function TryResult({ attempt, spoken }: { attempt: Attempt; spoken: string }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const heard = attempt.alternatives[attempt.matchedIndex ?? 0]?.trim() ?? '';
  return (
    <Stack spacing={0.5} data-testid="voice-lab-attempt">
      <Typography variant="body2" color="text.secondary">
        {t('voiceLab.tryIt.heard')}
      </Typography>
      {heard ? (
        <Typography variant="h6" component="p" lang={spoken} sx={{ overflowWrap: 'anywhere' }}>
          {t('voiceLab.tryIt.quoted', { text: heard })}
        </Typography>
      ) : (
        <Typography>
          {attempt.error ? t(`voiceLab.errors.${attempt.error}`) : t('voiceLab.result.noText')}
        </Typography>
      )}
      <Typography sx={{ fontWeight: 600 }}>{wouldDoText(attempt.result, locale)}</Typography>
    </Stack>
  );
}

/**
 * "Try it", the voice test's first mode: say anything, see what the phone heard and what Lotties
 * would do with it. Nothing is logged; the last tries stay on this screen only (never exported).
 */
export function FreeTry({ lab }: { lab: VoiceLab }) {
  const { t } = useTranslation();
  const listening = lab.speaking === 'free';
  const error = lab.errorFor('free');
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid="voice-lab-free">
      <Stack spacing={2}>
        <Typography variant="body2">{t('voiceLab.tryIt.hint')}</Typography>
        <LanguageField lab={lab} />
        <ListenControls
          label={t('voiceLab.tryIt.speak')}
          size="large"
          listening={listening}
          state={lab.listenState}
          disabled={lab.speaking !== null}
          onSpeak={() => void lab.speakFree()}
          onCancel={lab.cancel}
        />
        {error && lab.speaking === null && (
          <Alert severity="info">{t(`voiceLab.errors.${error}`)}</Alert>
        )}
        {lab.freeTries.map(({ id, attempt }, index) => (
          <Stack key={id} spacing={2}>
            {index > 0 && <Divider />}
            <TryResult attempt={attempt} spoken={lab.settings.locale} />
          </Stack>
        ))}
        {lab.freeTries.length > 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('voiceLab.tryIt.kept')}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}
