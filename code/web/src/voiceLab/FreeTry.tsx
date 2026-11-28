import { useTranslation } from 'react-i18next';
import { Divider, Paper, Stack, Typography } from '@mui/material';
import { AttemptView } from './AttemptView';
import { ListenControls } from './ListenControls';
import type { VoiceLab } from './useVoiceLab';

/** Free try: say anything, see the n-best texts and the parse. Not counted, never exported. */
export function FreeTry({ lab }: { lab: VoiceLab }) {
  const { t } = useTranslation();
  const listening = lab.speaking === 'free';
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid="voice-lab-free">
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" component="h2">
          {t('voiceLab.freeTry.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('voiceLab.freeTry.hint')}
        </Typography>
        <ListenControls
          label={t('voiceLab.freeTry.speak')}
          size="normal"
          listening={listening}
          state={lab.listenState}
          disabled={!lab.ready || lab.speaking !== null}
          onSpeak={() => void lab.speakFree()}
          onCancel={lab.cancel}
        />
        {lab.freeTries.map((attempt, index) => (
          <Stack key={attempt.at} spacing={1.5}>
            {index > 0 && <Divider />}
            <AttemptView attempt={attempt} judged={false} />
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}
