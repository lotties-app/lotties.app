import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button } from '@mui/material';
import { useMedicationCommands, useMedications } from '../db/hooks';
import type { Medication } from '../db/models';
import { productKey } from '../db/catalogCache';
import { Icon } from '../ui/Icon';
import { filledSurface, focusRing, optionBase, palette, selectedOption } from '../ui/form/styles';
import { CatalogResults } from './CatalogResults';
import { LinkedProduct } from './LinkedProduct';
import { useAddFromProduct } from './useAddFromProduct';

interface Props {
  babyId: string;
  value: string | null;
  onChange: (medication: Medication) => void;
  disabled?: boolean;
}

/**
 * Picks the one medication a prescription is for: the baby's own list first, then the shared
 * catalog (choosing a product adds it to the baby's list, linked, without duplicates), or a plain
 * local name. Offline it searches only the products cached on this device.
 */
export function MedicationChooser({ babyId, value, onChange, disabled = false }: Props) {
  const { t } = useTranslation();
  const medications = useMedications(babyId) ?? [];
  const commands = useMedicationCommands();
  const addFromProduct = useAddFromProduct(babyId);
  const [query, setQuery] = useState('');
  const [changing, setChanging] = useState(false);
  const [failed, setFailed] = useState(false);
  const chosen = medications.find((m) => m.id === value);
  const needle = productKey(query);
  const shown = medications.filter((m) => needle === '' || productKey(m.name).includes(needle));
  const exists = medications.some((m) => productKey(m.name) === needle);

  const pick = (medication: Medication) => {
    onChange(medication);
    setQuery('');
    setChanging(false);
    setFailed(false);
  };
  const run = (create: () => Promise<Medication>) => {
    create()
      .then(pick)
      .catch(() => setFailed(true));
  };

  if (chosen && !changing) {
    return (
      <Box
        sx={(theme) => ({
          ...filledSurface(theme),
          ...selectedOption(theme),
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          p: 1.25,
          borderRadius: '18px',
        })}
      >
        <Icon name="pill" size={20} sx={{ flex: 'none' }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box
            component="span"
            sx={{ display: 'block', fontWeight: 600, overflowWrap: 'anywhere' }}
          >
            {chosen.name}
          </Box>
          <Box
            component="span"
            sx={{ display: 'block', fontSize: '0.8125rem', color: 'text.secondary' }}
          >
            <LinkedProduct medication={chosen} />
          </Box>
        </Box>
        <Button disabled={disabled} onClick={() => setChanging(true)} sx={{ minHeight: 44 }}>
          {t('medications.editor.change')}
        </Button>
      </Box>
    );
  }

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
      <Box
        role="group"
        aria-label={t('medications.editor.yourMedications')}
        sx={{ display: 'grid', gap: 1 }}
      >
        {shown.map((medication) => (
          <Box
            key={medication.id}
            component="button"
            type="button"
            disabled={disabled}
            onClick={() => pick(medication)}
            sx={(theme) => ({
              ...optionBase(theme),
              ...filledSurface(theme),
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              minHeight: 52,
              px: 1.5,
              borderRadius: '18px',
              textAlign: 'start',
              color: palette(theme).text.primary,
            })}
          >
            <Icon name="pill" size={20} sx={{ color: 'text.secondary' }} />
            <span>{medication.name}</span>
          </Box>
        ))}
      </Box>
      {needle !== '' && !exists && !disabled && (
        <Box
          component="button"
          type="button"
          onClick={() => run(() => commands.create({ babyId, name: query.trim() }))}
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
      {!disabled && (
        <CatalogResults
          query={query}
          medications={medications}
          onChooseMedication={pick}
          onChooseProduct={(product) => run(() => addFromProduct(product))}
        />
      )}
      {medications.length === 0 && query.trim() === '' && (
        <Box sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
          {t('ui.medication.noneYet')}
        </Box>
      )}
    </Box>
  );
}
