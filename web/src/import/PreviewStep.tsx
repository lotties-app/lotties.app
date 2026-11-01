import { useState } from 'react';
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
import { summaryRange } from './importModel';

const MAX_SHOWN = 100;

function SkippedRows({ summary, label }: { summary: NapperSummaryBase; label: string }) {
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
        {open ? 'Hide' : 'Show'} {rows.length} skipped {label} row{rows.length === 1 ? '' : 's'}
      </Button>
      {open && (
        <List id={id} dense aria-label={`Skipped ${label} rows`}>
          {rows.slice(0, MAX_SHOWN).map((r, i) => (
            <ListItem key={`${r.row}-${i}`} disableGutters>
              <ListItemText
                primary={`Row ${r.row}${r.category ? ` (${r.category})` : ''}`}
                secondary={r.reason || r.code}
              />
            </ListItem>
          ))}
          {rows.length > MAX_SHOWN && (
            <ListItem disableGutters>
              <ListItemText secondary={`And ${rows.length - MAX_SHOWN} more.`} />
            </ListItem>
          )}
        </List>
      )}
    </div>
  );
}

function Totals({ summary }: { summary: NapperSummaryBase }) {
  const range = summaryRange(summary);
  return (
    <Typography variant="body2">
      {summary.totalRows} rows: {summary.toCreate} to create, {summary.alreadyImported} already
      imported, {summary.skipped} skipped.
      {range && ` Dates: ${range}.`}
    </Typography>
  );
}

function LogsSummary({ logs }: { logs: NapperLogsSummary }) {
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle1" component="h3">
        Logs
      </Typography>
      <Totals summary={logs} />
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" aria-label="Logs per category">
          <TableHead>
            <TableRow>
              <TableCell>Category</TableCell>
              <TableCell align="right">To create</TableCell>
              <TableCell align="right">Already imported</TableCell>
              <TableCell align="right">Skipped</TableCell>
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
      <SkippedRows summary={logs} label="log" />
    </Stack>
  );
}

function MeasurementsSummary({ summary }: { summary: NapperMeasurementsSummary }) {
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle1" component="h3">
        Measurements
      </Typography>
      <Totals summary={summary} />
      <SkippedRows summary={summary} label="measurement" />
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
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        This is a preview: nothing has been saved yet.
      </Typography>
      {preview.logs && <LogsSummary logs={preview.logs} />}
      {preview.measurements && <MeasurementsSummary summary={preview.measurements} />}
      <Stack direction="row" spacing={1}>
        <Button onClick={onBack} sx={{ minHeight: 48 }}>
          Back
        </Button>
        <Button variant="contained" onClick={onNext} sx={{ minHeight: 48 }}>
          Next
        </Button>
      </Stack>
    </Stack>
  );
}
