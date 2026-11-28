import { useTranslation } from 'react-i18next';
import { Alert, Button, Paper, Stack, Typography } from '@mui/material';
import { useLocale } from '../i18n/useLocale';
import { expectationText } from './commandText';
import { AttemptView } from './AttemptView';
import { ListenControls } from './ListenControls';
import type { VoiceLab } from './useVoiceLab';

/**
 * The run: the current test phrase in large text, its expected command, the Speak button; after an
 * attempt, the result with Retry (the first attempt keeps counting) and Next.
 */
export function PhraseRunner({ lab }: { lab: VoiceLab }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { phrase, record } = lab;
  const listening = lab.speaking === 'phrase';
  const error = lab.errorFor('phrase');

  if (!phrase) {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <Typography>{t('voiceLab.phrase.done')}</Typography>
          <Button sx={{ alignSelf: 'flex-start' }} onClick={lab.restart}>
            {t('voiceLab.phrase.restart')}
          </Button>
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid="voice-lab-phrase">
      <Stack spacing={2}>
        <Stack spacing={0.5}>
          <Typography variant="body2" color="text.secondary">
            {t('voiceLab.phrase.counter', {
              n: lab.position + 1,
              total: lab.phrases.length,
              number: phrase.number,
            })}
          </Typography>
          <Typography
            variant="h4"
            component="p"
            lang={phrase.locale}
            sx={{ overflowWrap: 'anywhere' }}
          >
            {phrase.text}
          </Typography>
          <Typography color="text.secondary">
            {t('voiceLab.phrase.expected', { command: expectationText(phrase.expected, locale) })}
          </Typography>
        </Stack>
        {record && !listening ? (
          <Stack spacing={2}>
            <AttemptView attempt={record.latest} judged retries={record.retries} />
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                size="large"
                sx={{ flex: 1 }}
                disabled={lab.speaking !== null}
                onClick={() => void lab.speakPhrase()}
              >
                {t('voiceLab.retry')}
              </Button>
              <Button variant="contained" size="large" sx={{ flex: 1 }} onClick={lab.next}>
                {t('voiceLab.next')}
              </Button>
            </Stack>
          </Stack>
        ) : (
          <ListenControls
            label={t('voiceLab.speak')}
            size="large"
            listening={listening}
            state={lab.listenState}
            disabled={lab.speaking !== null}
            onSpeak={() => void lab.speakPhrase()}
            onCancel={lab.cancel}
          />
        )}
        {error && lab.speaking === null && (
          <Alert severity="info">{t(`voiceLab.errors.${error}`)}</Alert>
        )}
      </Stack>
    </Paper>
  );
}
