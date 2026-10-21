import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  List,
  ListItem,
  ListItemText,
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
import type {
  NapperLogsSummary,
  NapperMeasurementsSummary,
  NapperPreviewDto,
  NapperSummaryBase,
} from '../sync/contract';
import { EnrichSummary } from './EnrichSummary';
import { summaryRange } from './importModel';

const MAX_SHOWN = 100;

function SkippedRows({ summary, label }: { summary: NapperSummaryBase; label: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rows = summary.skippedRows ?? [];
  if (rows.length === 0) return null;
  const id = `skipped-${label.replace(/\s+/g, '-')}`;
  return (
    <div>
      <Button
        size="small"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        sx={{ minHeight: 40 }}
      >
        {open
          ? t('import.preview.hideSkipped', { count: rows.length, label })
          : t('import.preview.showSkipped', { count: rows.length, label })}
      </Button>
      {open && (
        <List id={id} dense aria-label={t('import.preview.skippedList', { label })}>
          {rows.slice(0, MAX_SHOWN).map((r, i) => (
            <ListItem key={`${r.row}-${i}`} disableGutters>
              <ListItemText
                primary={
                  r.category
                    ? t('import.preview.rowWithCategory', { row: r.row, category: r.category })
                    : t('import.preview.row', { row: r.row })
                }
                secondary={r.reason || r.code}
              />
            </ListItem>
          ))}
          {rows.length > MAX_SHOWN && (
            <ListItem disableGutters>
              <ListItemText
                secondary={t('import.preview.more', { count: rows.length - MAX_SHOWN })}
              />
            </ListItem>
          )}
        </List>
      )}
    </div>
  );
}

function SkippedFields({ summary }: { summary: NapperLogsSummary }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const fields = summary.skippedFields ?? [];
  if (fields.length === 0) return null;
  const id = 'skipped-fields';
  return (
    <div>
      <Button
        size="small"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        sx={{ minHeight: 40 }}
      >
        {open
          ? t('import.preview.hideSkippedFields', { count: fields.length })
          : t('import.preview.showSkippedFields', { count: fields.length })}
      </Button>
      {open && (
        <List id={id} dense aria-label={t('import.preview.skippedFieldsList')}>
          {fields.slice(0, MAX_SHOWN).map((f, i) => (
            <ListItem key={`${f.row}-${f.field}-${i}`} disableGutters>
              <ListItemText
                primary={t('import.preview.skippedField', {
                  row: f.row,
                  category: f.category,
                  field: f.field,
                })}
                secondary={f.value ? `${f.value} · ${f.reason || f.code}` : f.reason || f.code}
              />
            </ListItem>
          ))}
          {fields.length > MAX_SHOWN && (
            <ListItem disableGutters>
              <ListItemText
                secondary={t('import.preview.more', { count: fields.length - MAX_SHOWN })}
              />
            </ListItem>
          )}
        </List>
      )}
    </div>
  );
}

function Totals({ summary }: { summary: NapperSummaryBase }) {
  const { t } = useTranslation();
  const range = summaryRange(summary);
  return (
    <Typography variant="body2">
      {t('import.preview.totals', {
        total: summary.totalRows,
        create: summary.toCreate,
        existing: summary.alreadyImported,
        skipped: summary.skipped,
      })}
      {range && ` ${t('import.preview.dates', { range })}`}
    </Typography>
  );
}

function LogsSummary({ logs }: { logs: NapperLogsSummary }) {
  const { t } = useTranslation();
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle1" component="h3">
        {t('import.preview.logs')}
      </Typography>
      <Totals summary={logs} />
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" aria-label={t('import.preview.perCategory')}>
          <TableHead>
            <TableRow>
              <TableCell>{t('import.preview.category')}</TableCell>
              <TableCell align="right">{t('import.preview.toCreate')}</TableCell>
              <TableCell align="right">{t('import.preview.alreadyImported')}</TableCell>
              <TableCell align="right">{t('import.preview.skipped')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {logs.categories.map((c) => (
              <TableRow key={c.category}>
                <TableCell>{c.category}</TableCell>
                <TableCell align="right">{c.toCreate}</TableCell>
                <TableCell align="right">{c.alreadyImported}</TableCell>
                <TableCell align="right">{c.skipped}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <SkippedRows summary={logs} label={t('import.preview.labelLog')} />
      <SkippedFields summary={logs} />
    </Stack>
  );
}

function MeasurementsSummary({ summary }: { summary: NapperMeasurementsSummary }) {
  const { t } = useTranslation();
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle1" component="h3">
        {t('import.preview.measurements')}
      </Typography>
      <Totals summary={summary} />
      <SkippedRows summary={summary} label={t('import.preview.labelMeasurement')} />
    </Stack>
  );
}

interface Props {
  preview: NapperPreviewDto;
  onBack: () => void;
  onNext: () => void;
}

/** Step 2: what the files contain and what the import would do. Nothing is written yet. */
export function PreviewStep({ preview, onBack, onNext }: Props) {
  const { t } = useTranslation();
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {t('import.preview.notice')}
      </Typography>
      {preview.logs && <LogsSummary logs={preview.logs} />}
      <EnrichSummary count={preview.eventsEnriched} fields={preview.enrichedFields} done={false} />
      {preview.measurements && <MeasurementsSummary summary={preview.measurements} />}
      <Stack direction="row" spacing={1}>
        <Button onClick={onBack} sx={{ minHeight: 48 }}>
          {t('common.back')}
        </Button>
        <Button variant="contained" onClick={onNext} sx={{ minHeight: 48 }}>
          {t('common.next')}
        </Button>
      </Stack>
    </Stack>
  );
}
