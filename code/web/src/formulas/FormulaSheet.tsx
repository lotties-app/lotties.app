import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Stack } from '@mui/material';
import { useFormulaCommands } from '../db/hooks';
import type { Formula } from '../db/models';
import { formulaTermsOf, type FormulaTerms } from '../db/formulaCommands';
import { SheetFrame } from '../now/ui/SheetFrame';
import { CategoryIcon } from '../ui/CategoryIcon';
import { DateField, Field, SwitchRow, TextInput } from '../ui/form';
import { FORMULA_LIMITS, shouldBecomeCurrent } from './formulaModel';
import { FormulaNameField } from './FormulaNameField';

interface Props {
  babyId: string;
  /** Every formula of the baby (the default of "Current formula", names not suggested again). */
  formulas: readonly Formula[];
  /** Omit to add a new formula. */
  formula?: Formula;
  /** The tiny sheet of the bottle: the name only (the rest can be filled in Settings). */
  compact?: boolean;
  onClose: () => void;
  onSaved?: (formula: Formula) => void;
}

function blankTerms(formulas: readonly Formula[]): FormulaTerms {
  return {
    name: '',
    brand: null,
    stage: null,
    notes: null,
    startedOn: null,
    isCurrent: shouldBecomeCurrent(formulas),
    archived: false,
  };
}

/**
 * Add or edit a formula of the baby: name (with suggestions while typing), brand, stage, the date
 * it was started, notes and "Current formula" (new bottles of formula preselect it). The first
 * formula of a baby starts as the current one. Saved locally and queued for sync.
 */
export function FormulaSheet({
  babyId,
  formulas,
  formula,
  compact = false,
  onClose,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const commands = useFormulaCommands();
  const [terms, setTerms] = useState<FormulaTerms>(() =>
    formula ? formulaTermsOf(formula) : blankTerms(formulas),
  );
  const [nameError, setNameError] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const change = (patch: Partial<FormulaTerms>) =>
    setTerms((current) => ({ ...current, ...patch }));
  const taken = formulas.filter((f) => f.id !== formula?.id).map((f) => f.name);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const name = terms.name.trim();
    if (!name || name.length > FORMULA_LIMITS.name) {
      setNameError(t('formulas.nameRequired'));
      return;
    }
    setSaving(true);
    setFailed(false);
    try {
      const saved = formula
        ? await commands.update(formula.id, terms)
        : await commands.create(babyId, terms);
      onSaved?.(saved);
      onClose();
    } catch {
      setFailed(true);
      setSaving(false);
    }
  };

  return (
    <SheetFrame
      open
      onClose={onClose}
      title={formula ? t('formulas.edit') : t('formulas.add')}
      leading={<CategoryIcon name="bottle" category="feeding" size={24} />}
    >
      <Box
        component="form"
        noValidate
        onSubmit={(e: FormEvent) => void submit(e)}
        sx={{ display: 'grid', gap: 2.5 }}
      >
        <FormulaNameField
          value={terms.name}
          onChange={(name) => {
            change({ name });
            setNameError(undefined);
          }}
          taken={taken}
          error={nameError}
        />
        {!compact && (
          <>
            <Stack direction="row" spacing={1.5}>
              <Field label={t('formulas.brand')} optional sx={{ flex: 2 }}>
                <TextInput
                  value={terms.brand ?? ''}
                  onChange={(brand) => change({ brand })}
                  maxLength={FORMULA_LIMITS.brand}
                />
              </Field>
              <Field label={t('formulas.stage')} optional sx={{ flex: 1 }}>
                <TextInput
                  value={terms.stage ?? ''}
                  onChange={(stage) => change({ stage })}
                  maxLength={FORMULA_LIMITS.stage}
                  placeholder={t('formulas.stageHelp')}
                />
              </Field>
            </Stack>
            <Field label={t('formulas.startedOn')} optional>
              <DateField
                value={terms.startedOn ?? ''}
                onChange={(startedOn) => change({ startedOn: startedOn || null })}
                min="2000-01-01"
              />
            </Field>
            <Field label={t('formulas.notes')} optional>
              <TextInput
                value={terms.notes ?? ''}
                onChange={(notes) => change({ notes })}
                maxLength={FORMULA_LIMITS.notes}
              />
            </Field>
            {!terms.archived && (
              <SwitchRow
                checked={terms.isCurrent}
                onChange={(isCurrent) => change({ isCurrent })}
                label={t('formulas.current')}
                description={t('formulas.currentHelp')}
                icon="star"
              />
            )}
          </>
        )}
        {failed && (
          <Box role="alert" sx={{ fontSize: '0.875rem', color: 'error.main' }}>
            {t('formulas.saveFailed')}
          </Box>
        )}
        <Button
          type="submit"
          variant="contained"
          disabled={saving}
          sx={{ minHeight: 52, borderRadius: '999px' }}
        >
          {t('common.save')}
        </Button>
      </Box>
    </SheetFrame>
  );
}
