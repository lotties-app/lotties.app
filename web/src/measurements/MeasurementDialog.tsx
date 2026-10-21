import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import { formatNumber } from '../i18n/format';
import { useServerAction } from '../settings/useServerAction';
import type { MeasurementDto } from '../sync/contract';
import {
  emptyForm,
  formFromDto,
  MEASUREMENT_ERROR_MESSAGES,
  METRICS,
  metricLabel,
  todayLocal,
  MIN_DATE,
  validateForm,
  type FormErrors,
  type MeasurementForm,
} from './measurementModel';
import { useMeasurementActions } from './useMeasurements';

interface Props {
  babyId: string;
  /** Omit to add a new measurement. */
  measurement?: MeasurementDto;
  onClose: () => void;
}

/** Add / edit dialog. The GUID is fixed when it opens, so a retried save never duplicates. */
export function MeasurementDialog({ babyId, measurement, onClose }: Props) {
  const { t } = useTranslation();
  const actions = useMeasurementActions(babyId);
  const { run, pending, error, online } = useServerAction(MEASUREMENT_ERROR_MESSAGES);
  const [id] = useState(() => measurement?.id ?? crypto.randomUUID());
  const [form, setForm] = useState<MeasurementForm>(() =>
    measurement ? formFromDto(measurement) : emptyForm(),
  );
  const [errors, setErrors] = useState<FormErrors>({});

  const set = (key: keyof MeasurementForm) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = validateForm(form);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    if (await run(() => actions.save(id, result.request))) onClose();
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{measurement ? t('growth.edit') : t('growth.add')}</DialogTitle>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {!online && <Alert severity="warning">{t('errors.offline')}</Alert>}
            {error && <Alert severity="error">{error}</Alert>}
            {errors.values && <Alert severity="error">{errors.values}</Alert>}
            <TextField
              label={t('growth.date')}
              type="date"
              value={form.date}
              onChange={(e) => set('date')(e.target.value)}
              error={!!errors.date}
              helperText={errors.date}
              required
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { min: MIN_DATE, max: todayLocal() },
              }}
            />
            {METRICS.map((m) => (
              <TextField
                key={m.key}
                label={t('growth.metricLabel', { label: metricLabel(m), unit: m.unit })}
                value={form[m.key]}
                onChange={(e) => set(m.key)(e.target.value)}
                error={!!errors[m.key]}
                helperText={
                  errors[m.key] ??
                  t('growth.range', {
                    min: formatNumber(m.min),
                    max: formatNumber(m.max),
                    unit: m.unit,
                  })
                }
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
                autoComplete="off"
              />
            ))}
            <TextField
              label={t('common.notes')}
              value={form.notes}
              onChange={(e) => set('notes')(e.target.value)}
              error={!!errors.notes}
              helperText={errors.notes}
              multiline
              minRows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={pending || !online}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
