import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import { useMedicationCommands, useMedications } from '../../db/hooks';
import type { Medication } from '../../db/models';
import { useLocale } from '../../i18n/useLocale';
import { getOwn, withOwn, withoutOwn } from '../../util/ownProperty';
import { Icon } from '../Icon';
import { ChipGroup } from './ChipGroup';
import { Field } from './Field';
import { NumberStepper } from './NumberStepper';
import { parseLocaleNumber } from './numbers';
import { filledSurface, focusRing, optionBase, palette, selectedOption } from './styles';

/** A checked medication with its dose, kept as text while it is edited. */
export interface MedicationDose {
  name: string;
  amount: string;
  unit: string;
}

/** Checked medications by catalog id (own-property rule: use `getOwn`/`withOwn`). */
export type MedicationSelection = Record<string, MedicationDose>;

export interface MedicationPickerProps {
  babyId: string;
  selected: MedicationSelection;
  onChange: (selected: MedicationSelection) => void;
  disabled?: boolean;
}

/** Dose step by unit: drops 1, ml 0.5, mg 5 (docs/design/03 section 7). */
function stepFor(unit: string, units: Record<'drops' | 'ml' | 'mg', string>): number {
  const normalized = unit.trim().toLowerCase();
  if (normalized === units.mg.toLowerCase()) return 5;
  if (normalized === units.ml.toLowerCase()) return 0.5;
  return 1;
}

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

function selectionFor(medication: Medication): MedicationDose {
  return {
    name: medication.name,
    amount: medication.defaultDosage ? String(medication.defaultDosage.amount) : '',
    unit: medication.defaultDosage?.unit ?? '',
  };
}

/**
 * Pick the medications given: usual ones first as cards with a pill icon, a check, and when
 * checked an inline dose (stepper plus a unit choice). A search field filters the catalog; a name
 * that does not exist offers `Add "name"`, which creates the catalog entry (local write plus
 * outbox) and checks it.
 */
export function MedicationPicker({
  babyId,
  selected,
  onChange,
  disabled = false,
}: MedicationPickerProps) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const medications = useMedications(babyId);
  const commands = useMedicationCommands();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [failed, setFailed] = useState(false);
  const units = {
    drops: t('ui.units.drops'),
    ml: t('ui.units.ml'),
    mg: t('ui.units.mg'),
  };

  const all = [...(medications ?? [])].sort(
    (a, b) => Number(b.isUsual) - Number(a.isUsual) || a.name.localeCompare(b.name, locale),
  );
  const needle = normalize(query);
  const shown = all.filter(
    (m) => getOwn(selected, m.id) !== undefined || normalize(m.name).includes(needle),
  );
  const exists = all.some((m) => normalize(m.name) === needle);
  const canAdd = needle !== '' && !exists && !disabled;

  const toggle = (medication: Medication) =>
    onChange(
      getOwn(selected, medication.id)
        ? withoutOwn(selected, medication.id)
        : withOwn(selected, medication.id, selectionFor(medication)),
    );

  const add = async () => {
    setAdding(true);
    setFailed(false);
    try {
      const created = await commands.create({ babyId, name: query.trim() });
      onChange(withOwn(selected, created.id, selectionFor(created)));
      setQuery('');
    } catch {
      setFailed(true);
    } finally {
      setAdding(false);
    }
  };

  return (
    <Box sx={{ display: 'grid', gap: 1.25 }}>
      <Box
        sx={(theme) => ({
          ...filledSurface(theme),
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          px: 1.5,
          '&:focus-within': { outline: focusRing(theme), outlineOffset: 0 },
        })}
      >
        <Icon name="search" size={20} sx={{ color: 'text.secondary' }} />
        <Box
          component="input"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          aria-label={t('ui.medication.find')}
          placeholder={t('ui.medication.find')}
          value={query}
          disabled={disabled}
          onChange={(e: { target: { value: string } }) => {
            setQuery(e.target.value);
            setFailed(false);
          }}
          sx={(theme) => ({
            flex: 1,
            minWidth: 0,
            height: 44,
            border: 0,
            outline: 0,
            background: 'none',
            font: 'inherit',
            color: palette(theme).text.primary,
            '&::placeholder': { color: palette(theme).text.secondary },
          })}
        />
      </Box>

      {canAdd && (
        <Box
          component="button"
          type="button"
          disabled={adding}
          onClick={() => void add()}
          sx={(theme) => ({
            ...optionBase(theme),
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            minHeight: 48,
            px: 1.75,
            borderRadius: '999px',
            backgroundColor: palette(theme).surfaceRaised,
            color: palette(theme).primary.main,
            fontWeight: 600,
            justifySelf: 'start',
          })}
        >
          <Icon name="add" size={20} />
          <span>{t('ui.medication.add', { name: query.trim() })}</span>
        </Box>
      )}
      {failed && (
        <Box role="alert" sx={{ fontSize: '0.8125rem', color: 'error.main' }}>
          {t('ui.medication.addFailed')}
        </Box>
      )}

      {medications && shown.length === 0 && !canAdd && (
        <Box sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
          {query.trim()
            ? t('ui.medication.noMatch', { query: query.trim() })
            : t('ui.medication.noneYet')}
        </Box>
      )}

      <Box role="group" aria-label={t('events.medications')} sx={{ display: 'grid', gap: 1 }}>
        {shown.map((medication) => (
          <MedicationCard
            key={medication.id}
            medication={medication}
            dose={getOwn(selected, medication.id)}
            units={units}
            disabled={disabled}
            onToggle={() => toggle(medication)}
            onDose={(dose) => onChange(withOwn(selected, medication.id, dose))}
          />
        ))}
      </Box>
    </Box>
  );
}

interface CardProps {
  medication: Medication;
  /** The dose when the medication is checked. */
  dose: MedicationDose | undefined;
  units: Record<'drops' | 'ml' | 'mg', string>;
  disabled: boolean;
  onToggle: () => void;
  onDose: (dose: MedicationDose) => void;
}

function MedicationCard({ medication, dose, units, disabled, onToggle, onDose }: CardProps) {
  const { t } = useTranslation();
  const on = dose !== undefined;
  const unitOptions = [...new Set([dose?.unit ?? '', units.drops, units.ml, units.mg])]
    .filter((unit) => unit !== '')
    .map((unit) => ({ value: unit, label: unit }));
  const amount = dose ? parseLocaleNumber(dose.amount) : null;

  return (
    <Box
      data-selected={on || undefined}
      sx={(theme) => ({
        ...filledSurface(theme),
        borderRadius: '18px',
        overflow: 'hidden',
        ...(on && selectedOption(theme)),
      })}
    >
      <Box
        component="button"
        type="button"
        role="checkbox"
        aria-checked={on}
        disabled={disabled}
        onClick={onToggle}
        sx={(theme) => ({
          ...optionBase(theme),
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          width: '100%',
          minHeight: 60,
          px: 1.5,
          py: 1,
          background: 'none',
          color: palette(theme).text.primary,
          textAlign: 'start',
          borderRadius: '18px',
          fontSize: '0.9375rem',
        })}
      >
        <Box
          component="span"
          aria-hidden
          sx={(theme) => ({
            display: 'grid',
            placeItems: 'center',
            flex: 'none',
            width: 28,
            height: 28,
            borderRadius: '50%',
            border: `2px solid ${on ? palette(theme).primary.main : palette(theme).text.secondary}`,
            backgroundColor: on ? palette(theme).primary.main : 'transparent',
            color: palette(theme).primary.contrastText,
          })}
        >
          {on && <Icon name="check" size={16} />}
        </Box>
        <Icon name="pill" size={20} sx={{ color: 'text.secondary' }} />
        <Box component="span" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
          {medication.name}
        </Box>
        {medication.isUsual && (
          <Box
            component="span"
            sx={(theme) => ({
              flex: 'none',
              px: 1,
              py: 0.25,
              borderRadius: '999px',
              fontSize: '0.75rem',
              fontWeight: 600,
              backgroundColor: palette(theme).category.care.bg,
              color: palette(theme).category.care.fg,
            })}
          >
            {t('ui.medication.usual')}
          </Box>
        )}
      </Box>
      {dose && (
        <Box sx={{ display: 'grid', gap: 1.5, px: 1.5, pb: 1.5 }}>
          <Field label={t('ui.medication.dose', { name: medication.name })}>
            <NumberStepper
              value={amount}
              onChange={(next) => onDose({ ...dose, amount: next === null ? '' : String(next) })}
              step={stepFor(dose.unit, units)}
              min={0}
              max={10000}
              disabled={disabled}
            />
          </Field>
          <Field label={t('ui.medication.unit')} group>
            <ChipGroup
              value={dose.unit || null}
              options={unitOptions}
              onChange={(unit) => onDose({ ...dose, unit: unit ?? '' })}
              disabled={disabled}
            />
          </Field>
        </Box>
      )}
    </Box>
  );
}
