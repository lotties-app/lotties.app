import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Stack,
  Typography,
} from '@mui/material';
import { useLocale } from '../i18n/useLocale';
import { useServerAction } from '../settings/useServerAction';
import { ConfirmDialog } from '../settings/ConfirmDialog';
import { Field, NumberStepper, TextInput } from '../ui/form';
import { NativeTimeInput } from '../ui/form/NativeTimeInput';
import { MAX_MINUTES, MAX_WORK_WINDOWS, MIN_MINUTES, type RestSettings } from './restApi';
import { validateRestSettings, type RestSettingsError } from './restModel';
import { useRestActions } from './useRest';

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** Weekday names in the UI language: 26 Oct 2026 is a Monday (ISO day 1). */
function weekdayName(day: number, locale: string, style: 'short' | 'long') {
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, 9, 25 + day)),
  );
}

const ERROR_KEYS = {
  timeZone: 'rest.settings.errors.timeZone',
  tooManyWindows: 'rest.settings.errors.tooManyWindows',
  windowDays: 'rest.settings.errors.windowDays',
  windowTimes: 'rest.settings.errors.windowTimes',
  windowSame: 'rest.settings.errors.windowSame',
  nightTimes: 'rest.settings.errors.nightTimes',
  nightSame: 'rest.settings.errors.nightSame',
  fallAsleep: 'rest.settings.errors.minutes',
  wakeLead: 'rest.settings.errors.minutes',
} as const satisfies Record<RestSettingsError, string>;

const touch = { minHeight: 44 } as const;

/**
 * The person's own rest settings: work windows, night window, the two minute values and the time
 * zone. Saving sends the full state (`PUT /me/rest-settings`); "Turn off and delete" removes it.
 */
export function RestSettingsEditor({ settings }: { settings: RestSettings }) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { saveSettings, deleteSettings } = useRestActions();
  const save = useServerAction();
  const remove = useServerAction();
  const SHORT = Object.fromEntries(DAYS.map((d) => [d, weekdayName(d, locale, 'short')]));
  const LONG = Object.fromEntries(DAYS.map((d) => [d, weekdayName(d, locale, 'long')]));
  const [draft, setDraft] = useState<RestSettings>(settings);
  const [errors, setErrors] = useState<RestSettingsError[]>([]);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const change = (patch: Partial<RestSettings>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };
  const changeWindow = (index: number, patch: Partial<RestSettings['workWindows'][number]>) =>
    change({
      workWindows: draft.workWindows.map((w, i) => (i === index ? { ...w, ...patch } : w)),
    });
  const toggleDay = (index: number, day: number) => {
    const days = draft.workWindows[index].days;
    changeWindow(index, {
      days: days.includes(day) ? days.filter((d) => d !== day) : [...days, day],
    });
  };

  const submit = async () => {
    const found = validateRestSettings(draft);
    setErrors(found);
    if (found.length > 0) return;
    setSaved(await save.run(() => saveSettings({ ...draft, enabled: true })));
  };
  const has = (e: RestSettingsError) => errors.includes(e);
  const errorList = [...new Set(errors.map((e) => t(ERROR_KEYS[e])))];

  return (
    <Card component="section" aria-labelledby="rest-settings-title" sx={{ p: 2.5 }}>
      <Typography id="rest-settings-title" variant="h6" component="h2">
        {t('rest.settings.title')}
      </Typography>
      <Stack spacing={2.5} sx={{ mt: 1.5 }}>
        <Stack spacing={1.5} role="group" aria-labelledby="rest-work-title">
          <Typography id="rest-work-title" variant="subtitle1" component="h3">
            {t('rest.settings.work.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('rest.settings.work.hint')}
          </Typography>
          {draft.workWindows.map((window, index) => (
            <Stack
              key={index}
              spacing={1}
              role="group"
              aria-label={t('rest.settings.work.window', { n: index + 1 })}
              sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5 }}
            >
              <FormGroup row aria-label={t('rest.settings.work.days')}>
                {DAYS.map((day) => (
                  <FormControlLabel
                    key={day}
                    label={SHORT[day]}
                    control={
                      <Checkbox
                        checked={window.days.includes(day)}
                        onChange={() => toggleDay(index, day)}
                        slotProps={{ input: { 'aria-label': LONG[day] } }}
                        sx={{ p: '10px' }}
                      />
                    }
                  />
                ))}
              </FormGroup>
              <Stack direction="row" spacing={1.5}>
                <Field label={t('rest.settings.work.start')}>
                  <NativeTimeInput
                    size="field"
                    value={window.start}
                    onChange={(start) => changeWindow(index, { start })}
                    invalid={false}
                    aria-label={t('rest.settings.work.start')}
                  />
                </Field>
                <Field label={t('rest.settings.work.end')}>
                  <NativeTimeInput
                    size="field"
                    value={window.end}
                    onChange={(end) => changeWindow(index, { end })}
                    invalid={false}
                    aria-label={t('rest.settings.work.end')}
                  />
                </Field>
              </Stack>
              <Button
                color="error"
                onClick={() =>
                  change({ workWindows: draft.workWindows.filter((_, i) => i !== index) })
                }
                sx={{ ...touch, alignSelf: 'flex-start' }}
              >
                {t('rest.settings.work.remove', { n: index + 1 })}
              </Button>
            </Stack>
          ))}
          <Button
            variant="outlined"
            disabled={draft.workWindows.length >= MAX_WORK_WINDOWS}
            onClick={() =>
              change({
                workWindows: [
                  ...draft.workWindows,
                  { days: [1, 2, 3, 4, 5], start: '08:00', end: '17:00' },
                ],
              })
            }
            sx={{ ...touch, alignSelf: 'flex-start' }}
          >
            {t('rest.settings.work.add')}
          </Button>
        </Stack>

        <Stack spacing={1.5} role="group" aria-labelledby="rest-night-title">
          <Typography id="rest-night-title" variant="subtitle1" component="h3">
            {t('rest.settings.night.title')}
          </Typography>
          <Stack direction="row" spacing={1.5}>
            <Field label={t('rest.settings.night.start')}>
              <NativeTimeInput
                size="field"
                value={draft.nightStart}
                onChange={(nightStart) => change({ nightStart })}
                invalid={has('nightTimes') || has('nightSame')}
                aria-label={t('rest.settings.night.start')}
              />
            </Field>
            <Field label={t('rest.settings.night.end')}>
              <NativeTimeInput
                size="field"
                value={draft.nightEnd}
                onChange={(nightEnd) => change({ nightEnd })}
                invalid={has('nightTimes') || has('nightSame')}
                aria-label={t('rest.settings.night.end')}
              />
            </Field>
          </Stack>
        </Stack>

        <Field
          label={t('rest.settings.fallAsleep.label')}
          help={t('rest.settings.fallAsleep.help')}
        >
          <NumberStepper
            value={draft.fallAsleepMinutes}
            onChange={(v) => change({ fallAsleepMinutes: v ?? MIN_MINUTES })}
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            step={5}
            unit={t('rest.settings.minutes')}
          />
        </Field>
        <Field label={t('rest.settings.wakeLead.label')} help={t('rest.settings.wakeLead.help')}>
          <NumberStepper
            value={draft.wakeLeadMinutes}
            onChange={(v) => change({ wakeLeadMinutes: v ?? MIN_MINUTES })}
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            step={5}
            unit={t('rest.settings.minutes')}
          />
        </Field>
        <Field label={t('rest.settings.timeZone.label')} help={t('rest.settings.timeZone.help')}>
          <TextInput value={draft.timeZone} onChange={(timeZone) => change({ timeZone })} />
        </Field>

        {errorList.length > 0 && (
          <Alert severity="error">
            {errorList.map((message) => (
              <div key={message}>{message}</div>
            ))}
          </Alert>
        )}
        {save.error && <Alert severity="error">{save.error}</Alert>}
        {saved && <Alert severity="success">{t('rest.settings.saved')}</Alert>}
        <Button
          variant="contained"
          disabled={save.pending}
          onClick={() => void submit()}
          sx={touch}
        >
          {t('rest.settings.save')}
        </Button>
        <Button color="error" onClick={() => setConfirming(true)} sx={touch}>
          {t('rest.settings.turnOff.action')}
        </Button>
      </Stack>
      {confirming && (
        <ConfirmDialog
          title={t('rest.settings.turnOff.title')}
          body={t('rest.settings.turnOff.body')}
          confirmLabel={t('rest.settings.turnOff.confirm')}
          pending={remove.pending}
          error={remove.error}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void remove.run(deleteSettings).then((ok) => ok && setConfirming(false))}
        />
      )}
    </Card>
  );
}
