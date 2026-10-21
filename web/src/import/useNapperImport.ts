import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import { OFFLINE_MESSAGE } from '../api/errorMessages';
import { previewNapperImport, runNapperImport } from '../api/measurementsApi';
import type { Baby } from '../db/models';
import { measurementsKey } from '../measurements/useMeasurements';
import type { NapperImportResultDto, NapperPreviewDto } from '../sync/contract';
import { useSyncEngine } from '../sync/SyncEngineContext';
import { useOnline } from '../sync/useOnline';
import {
  buildRequest,
  checkFileSize,
  choiceProblems,
  describeImportError,
  isMappingError,
  mappingsKey,
  mergeChoices,
  type Choices,
  type FileKind,
  type PickedFiles,
} from './importModel';

export const STEP_LABELS = ['Choose files', 'Review', 'Medications', 'Import', 'Done'] as const;
export const STEP = { files: 0, review: 1, medications: 2, confirm: 3, done: 4 } as const;

interface Wizard {
  step: number;
  files: PickedFiles;
  preview: NapperPreviewDto | null;
  choices: Choices;
  /** Key of the mappings the current preview was checked with. */
  checkedKey: string | null;
  result: NapperImportResultDto | null;
}

const INITIAL: Wizard = {
  step: STEP.files,
  files: {},
  preview: null,
  choices: {},
  checkedKey: null,
  result: null,
};

type Outcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** State machine of the Napper import wizard; all server calls are online-only. */
export function useNapperImport(baby: Baby) {
  const api = useApiClient();
  const engine = useSyncEngine();
  const queryClient = useQueryClient();
  const online = useOnline();
  const [wizard, setWizard] = useState<Wizard>(INITIAL);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const patch = (changes: Partial<Wizard>) => setWizard((w) => ({ ...w, ...changes }));

  /** Single-flight guard: a second call while one runs is ignored (no double submit). */
  const call = async <T>(action: () => Promise<T>): Promise<Outcome<T> | null> => {
    if (busy.current) return null;
    if (!online) {
      setError(OFFLINE_MESSAGE);
      return null;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      return { ok: true, value: await action() };
    } catch (e) {
      setError(describeImportError(e));
      return { ok: false, error: e };
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const pickFile = async (kind: FileKind, file: File) => {
    const tooBig = checkFileSize(file);
    if (tooBig) return setError(tooBig);
    try {
      const text = await file.text();
      setError(null);
      // A different file invalidates everything derived from the previous ones.
      setWizard((w) => ({
        ...INITIAL,
        files: { ...w.files, [kind]: { name: file.name, size: file.size, text } },
      }));
    } catch {
      setError(`Could not read ${file.name}.`);
    }
  };

  const removeFile = (kind: FileKind) =>
    setWizard((w) => {
      const files = { ...w.files };
      delete files[kind];
      return { ...INITIAL, files };
    });

  const startPreview = async () => {
    const outcome = await call(() =>
      previewNapperImport(api, baby.id, buildRequest(wizard.files, {})),
    );
    if (!outcome?.ok) return;
    const preview = outcome.value;
    const suggestions = preview.medicationSuggestions ?? [];
    patch({
      preview,
      choices: mergeChoices({}, suggestions),
      checkedKey: null,
      step: STEP.review,
    });
  };

  const recheck = async () => {
    const sent = wizard.choices;
    const outcome = await call(() =>
      previewNapperImport(api, baby.id, buildRequest(wizard.files, sent)),
    );
    if (!outcome?.ok) return;
    const preview = outcome.value;
    setWizard((w) => ({
      ...w,
      preview,
      choices: mergeChoices(w.choices, preview.medicationSuggestions ?? []),
      checkedKey: mappingsKey(sent),
    }));
  };

  const runImport = async () => {
    const outcome = await call(() =>
      runNapperImport(api, baby.id, buildRequest(wizard.files, wizard.choices)),
    );
    if (!outcome) return;
    if (!outcome.ok) {
      if (isMappingError(outcome.error)) patch({ step: STEP.medications, checkedKey: null });
      return;
    }
    patch({ result: outcome.value, step: STEP.done });
    void queryClient.invalidateQueries({ queryKey: measurementsKey(baby.id) });
    void engine.syncNow();
  };

  const suggestions = wizard.preview?.medicationSuggestions ?? [];
  const problems = choiceProblems(wizard.choices);
  const needsMapping = suggestions.length > 0;
  const checked = !needsMapping || wizard.checkedKey === mappingsKey(wizard.choices);
  const unmapped = checked
    ? (wizard.preview?.unmappedTokens ?? [])
    : suggestions.map((s) => s.token);

  return {
    ...wizard,
    online,
    pending,
    error,
    suggestions,
    problems,
    unmapped,
    canContinueFromMedications: checked && unmapped.length === 0,
    hasProblems: Object.keys(problems).length > 0,
    clearError: () => setError(null),
    goTo: (step: number) => patch({ step }),
    setChoice: (token: string, choice: Choices[string]) =>
      setWizard((w) => ({ ...w, choices: { ...w.choices, [token]: choice } })),
    pickFile,
    removeFile,
    startPreview,
    recheck,
    runImport,
    reset: () => {
      setError(null);
      setWizard(INITIAL);
    },
  };
}

export type NapperImport = ReturnType<typeof useNapperImport>;
