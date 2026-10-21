import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button, Snackbar } from '@mui/material';
import { describeApiError } from '../api/errorMessages';
import { useDatabase } from '../db/DatabaseContext';
import type { BabyEvent, EventType } from '../db/models';
import { EventSheet } from '../events/EventSheet';
import type { FormPrefill } from '../events/formModel';
import { quickStartPayload, readLastUsed } from '../events/lastUsedValues';
import { useStopTimer } from '../events/useStopTimer';
import { runPreset, sheetPrefill, undoPreset, type UndoToken } from './actions';
import { presetLabel } from './presetLabel';
import type { Preset } from './types';

/** How long the Undo snackbar stays (docs/DESIGN.md section 5). */
export const UNDO_SNACKBAR_MS = 5_000;

interface Undoable {
  token: UndoToken;
  message: string;
}

export interface PresetActions {
  /** Runs a preset tap; `running` is the preset's own running timer (the tap then stops it). */
  run: (preset: Preset, running?: BabyEvent) => Promise<void>;
  /** Stops a running timer, asking for missing required fields first. */
  stop: (event: BabyEvent) => Promise<void>;
  /** Sheets, the Undo snackbar and the error snackbar; render them. */
  elements: ReactNode;
}

/**
 * Preset taps for one baby: `timer`/`instant` presets run at once (with an Undo snackbar),
 * `sheet` presets open the prefilled event sheet, `link` presets navigate. A tap on a running
 * timer's preset stops it (also undoable). Stops never send a timer without its required fields.
 */
export function usePresetActions(babyId: string, types: EventType[]): PresetActions {
  const { t } = useTranslation();
  const db = useDatabase();
  const navigate = useNavigate();
  const stopper = useStopTimer(babyId, types);
  const [prefill, setPrefill] = useState<FormPrefill | null>(null);
  const [undoable, setUndoable] = useState<Undoable | null>(null);
  const [error, setError] = useState<string | null>(null);

  const attempt = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(describeApiError(e));
    }
  };

  const stopTimer = async (event: BabyEvent, name?: string) => {
    const stopped = await stopper.stop(event);
    if (!stopped?.endedAt || !name) return;
    setUndoable({
      token: { babyId, createdIds: [], stopped: [{ id: stopped.id, endedAt: stopped.endedAt }] },
      message: t('presets.undo.stopped', { name }),
    });
  };

  const start = async (preset: Preset) => {
    const type = types.find((candidate) => candidate.id === preset.typeId);
    const payload =
      preset.mode === 'timer' && type
        ? quickStartPayload(type, preset.payloadDefaults, readLastUsed(babyId, type.id))
        : undefined;
    const token = await runPreset(db, preset, { babyId, payload });
    const name = presetLabel(preset);
    setUndoable({
      token,
      message:
        preset.mode === 'timer'
          ? t('presets.undo.started', { name })
          : t('presets.undo.logged', { name }),
    });
  };

  const run = (preset: Preset, running?: BabyEvent) =>
    attempt(async () => {
      if (preset.mode === 'link') {
        if (preset.href) navigate(preset.href);
        return;
      }
      if (preset.mode === 'sheet') {
        setPrefill(sheetPrefill(preset));
        return;
      }
      if (running) return stopTimer(running, presetLabel(preset));
      await start(preset);
    });

  const undo = async () => {
    const current = undoable;
    setUndoable(null);
    if (current) await attempt(() => undoPreset(db, current.token));
  };

  const elements = (
    <>
      {stopper.sheet}
      {prefill && (
        <EventSheet
          babyId={babyId}
          types={types}
          prefill={prefill}
          onDone={() => setPrefill(null)}
        />
      )}
      <Snackbar
        open={error !== null}
        autoHideDuration={UNDO_SNACKBAR_MS}
        onClose={(_, reason) => reason !== 'clickaway' && setError(null)}
        message={error}
      />
      <Snackbar
        open={undoable !== null}
        autoHideDuration={UNDO_SNACKBAR_MS}
        onClose={(_, reason) => reason !== 'clickaway' && setUndoable(null)}
        message={undoable?.message}
        action={
          <Button color="inherit" size="small" onClick={() => void undo()}>
            {t('presets.undo.action')}
          </Button>
        }
      />
    </>
  );

  return { run, stop: (event) => attempt(() => stopTimer(event)), elements };
}
