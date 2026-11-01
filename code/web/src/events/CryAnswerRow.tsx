import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Typography } from '@mui/material';

/*
 * "Detected by the cry monitor. Was she crying?" with "Yes, crying" / "Not crying"
 * (docs/design/35-cry-engine.md section 8): a quiet row in the fussy spell's detail and in the
 * monitor's recent detections. The answer sets `cry_confirmed` and can be changed later; "Not crying"
 * keeps the entry (it can be deleted as usual) and leaves it out of patterns and statistics. Without
 * `onAnswer` (who may not change the entry) it only says what is known.
 */
export function CryAnswerRow({
  answer,
  onAnswer,
  question,
}: {
  answer: boolean | null;
  onAnswer?: (crying: boolean) => void;
  /** Overrides the question (the recent detections name the time). */
  question?: string;
}) {
  const { t } = useTranslation();
  const labelId = useId();
  if (!onAnswer) {
    const text =
      answer === true
        ? t('cryMonitor.answer.answeredYes')
        : answer === false
          ? t('cryMonitor.answer.answeredNo')
          : t('cryMonitor.answer.readOnly');
    return (
      <Typography variant="body2" color="text.secondary" data-testid="cry-answer">
        {text}
      </Typography>
    );
  }
  const choice = (crying: boolean, label: string) => (
    <Button
      variant={answer === crying ? 'contained' : 'outlined'}
      aria-pressed={answer === crying}
      onClick={() => onAnswer(crying)}
      sx={{ minHeight: 44, flex: '1 1 120px', borderRadius: '999px' }}
    >
      {label}
    </Button>
  );
  return (
    <Box
      role="group"
      aria-labelledby={labelId}
      data-testid="cry-answer"
      sx={{ display: 'grid', gap: 1 }}
    >
      <Typography id={labelId} variant="body2" color="text.secondary">
        {question ?? t('cryMonitor.answer.detected')}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {choice(true, t('cryMonitor.answer.yes'))}
        {choice(false, t('cryMonitor.answer.no'))}
      </Box>
    </Box>
  );
}
