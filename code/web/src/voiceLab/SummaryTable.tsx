import { useTranslation } from 'react-i18next';
import {
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useLocale } from '../i18n/useLocale';
import { formatNumber } from '../i18n/format';
import { percentText, secondsText } from './commandText';
import { summary, THRESHOLDS, type PhraseRecord, type SummaryRow } from './labModel';

interface Cell {
  text: string;
  /** Below the section 7.4 target. */
  miss: boolean;
}

function useCells() {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const missing = t('voiceLab.summary.missing');
  const count = (n: number) => formatNumber(n, undefined, locale);
  const seconds = (ms: number | null, limit: number): Cell =>
    ms === null
      ? { text: missing, miss: false }
      : { text: secondsText(ms, locale), miss: ms > limit };
  return (row: SummaryRow): Cell[] => {
    const target = row.condition === 'all' ? undefined : THRESHOLDS.accuracy[row.condition];
    const rate = row.wrongActionRate;
    return [
      { text: t(`voiceLab.setup.engines.${row.engine}`), miss: false },
      { text: t(`voiceLab.setup.languages.${row.locale}`), miss: false },
      {
        text: row.condition === 'all' ? t('voiceLab.summary.all') : row.condition,
        miss: false,
      },
      { text: count(row.attempts), miss: false },
      {
        text: row.accuracy === null ? missing : percentText(row.accuracy, locale),
        miss: target !== undefined && row.accuracy !== null && row.accuracy < target,
      },
      {
        text:
          rate === null
            ? count(row.wrongActions)
            : t('voiceLab.summary.wrongValue', {
                value: count(row.wrongActions),
                rate: percentText(rate, locale),
              }),
        miss: rate !== null && rate > THRESHOLDS.wrongActionRate,
      },
      { text: count(row.wrongAmounts), miss: row.condition === 'C1' && row.wrongAmounts > 0 },
      { text: count(row.noneLogged), miss: row.noneLogged > 0 },
      seconds(row.latencyMedianMs, THRESHOLDS.latencyMedianMs),
      seconds(row.latencyP90Ms, THRESHOLDS.latencyP90Ms),
      {
        text: count(row.producedText),
        miss: row.condition === 'C4' && row.producedText < row.attempts,
      },
      { text: count(row.retries), miss: false },
    ];
  };
}

const HEADERS = [
  'engine',
  'language',
  'condition',
  'attempts',
  'accuracy',
  'wrong',
  'wrongAmounts',
  'noneLogged',
  'median',
  'p90',
  'text',
  'retries',
] as const;

/** The section 7.4 measures per engine, language and condition; values below target are marked. */
export function SummaryTable({ records }: { records: readonly PhraseRecord[] }) {
  const { t } = useTranslation();
  const cells = useCells();
  const rows = summary(records);
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid="voice-lab-summary">
      <Stack spacing={1}>
        <Typography variant="subtitle1" component="h2">
          {t('voiceLab.summary.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('voiceLab.summary.hint')}
        </Typography>
        {rows.length === 0 ? (
          <Typography variant="body2">{t('voiceLab.summary.empty')}</Typography>
        ) : (
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  {HEADERS.map((key) => (
                    <TableCell key={key} sx={{ whiteSpace: 'nowrap' }}>
                      {t(`voiceLab.summary.${key}`)}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${row.engine}|${row.locale}|${row.condition}`}>
                    {cells(row).map((cell, index) => (
                      <TableCell
                        key={HEADERS[index]}
                        sx={{ whiteSpace: 'nowrap', color: cell.miss ? 'error.main' : undefined }}
                      >
                        {cell.miss
                          ? t('voiceLab.summary.belowTarget', { value: cell.text })
                          : cell.text}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Stack>
    </Paper>
  );
}
