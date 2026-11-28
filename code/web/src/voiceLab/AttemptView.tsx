import { useTranslation } from 'react-i18next';
import { Box, Chip, Stack, Typography } from '@mui/material';
import { useLocale } from '../i18n/useLocale';
import { formatNumber } from '../i18n/format';
import { resultText, secondsText } from './commandText';
import type { Attempt } from './labModel';

interface Props {
  attempt: Attempt;
  /** Pass/fail against the expected command; a free try has none. */
  judged: boolean;
  retries?: number;
}

const confidenceOf = (attempt: Attempt, index: number) => attempt.confidences[index] ?? null;

/** One attempt: the n-best texts, the parsed command, pass or fail, the latency. */
export function AttemptView({ attempt, judged, retries = 0 }: Props) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  return (
    <Stack spacing={1} data-testid="voice-lab-attempt">
      {judged && (
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Chip
            color={attempt.pass ? 'success' : 'error'}
            label={t(attempt.pass ? 'voiceLab.result.pass' : 'voiceLab.result.fail')}
          />
          {attempt.wrongAction && (
            <Chip color="error" variant="outlined" label={t('voiceLab.result.wrongAction')} />
          )}
          {attempt.wrongAmount && (
            <Chip color="error" variant="outlined" label={t('voiceLab.result.wrongAmount')} />
          )}
        </Stack>
      )}
      <Typography variant="body2" color="text.secondary">
        {t('voiceLab.result.heard')}
      </Typography>
      {attempt.alternatives.length === 0 ? (
        <Typography>{t('voiceLab.result.noText')}</Typography>
      ) : (
        <Box component="ol" sx={{ m: 0, pl: 3 }}>
          {attempt.alternatives.map((text, index) => (
            <Typography
              component="li"
              key={`${index}-${text}`}
              sx={{ fontWeight: index === attempt.matchedIndex ? 600 : undefined }}
            >
              {confidenceOf(attempt, index) === null
                ? text
                : t('voiceLab.result.alternative', {
                    text,
                    confidence: formatNumber(
                      confidenceOf(attempt, index) as number,
                      { maximumFractionDigits: 2 },
                      locale,
                    ),
                  })}
            </Typography>
          ))}
        </Box>
      )}
      <Typography>
        {t('voiceLab.result.parsed', { result: resultText(attempt.result, locale) })}
      </Typography>
      {attempt.matchedIndex !== null && attempt.alternatives.length > 1 && (
        <Typography variant="body2" color="text.secondary">
          {t('voiceLab.result.matched', { n: attempt.matchedIndex + 1 })}
        </Typography>
      )}
      {attempt.error && (
        <Typography variant="body2" color="text.secondary">
          {t('voiceLab.result.error', { error: t(`voiceLab.errors.${attempt.error}`) })}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary">
        {attempt.latencyMs === null
          ? t('voiceLab.result.noLatency')
          : t('voiceLab.result.latency', { value: secondsText(attempt.latencyMs, locale) })}
      </Typography>
      {retries > 0 && (
        <Typography variant="body2" color="text.secondary">
          {t('voiceLab.result.retries', { count: retries })}
        </Typography>
      )}
    </Stack>
  );
}
