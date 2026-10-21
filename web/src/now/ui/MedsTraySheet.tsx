import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Typography } from '@mui/material';
import { Link } from 'react-router-dom';
import { formatList } from '../../i18n/format';
import { Illustration } from '../../ui/illustrations';
import { ChipGroup } from '../../ui/form';
import { medicationPayloadEntries, type MedicationEntry, type MedsTray } from '../quickLog';
import { SheetFrame } from './SheetFrame';

interface Props {
  open: boolean;
  onClose: () => void;
  tray: MedsTray;
  disabled: boolean;
  onChoose: (medications: MedicationEntry[]) => void;
}

/**
 * The Meds tray: the baby's usual medications as chips (multi-select), then Log. "Same as last
 * time" repeats the previous entry in one tap. The catalogue is edited in Settings.
 */
export function MedsTraySheet({ open, onClose, tray, disabled, onChoose }: Props) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>([]);
  const all = [...tray.usual, ...tray.others];

  return (
    <SheetFrame
      open={open}
      onClose={onClose}
      title={t('now.medsTray.title')}
      leading={<Illustration name="medication" size={48} />}
    >
      {tray.same && (
        <Button
          variant="outlined"
          color="inherit"
          fullWidth
          disabled={disabled}
          onClick={() => onChoose(tray.same?.medications ?? [])}
          sx={{ minHeight: 56, justifyContent: 'flex-start' }}
        >
          {t('now.medsTray.same', {
            names: formatList(tray.same.medications.map((m) => m.name)),
          })}
        </Button>
      )}
      {all.length === 0 ? (
        <Typography color="text.secondary">
          {t('now.medsTray.none')}{' '}
          <Link to="/settings#medications" onClick={onClose}>
            {t('now.medsTray.open')}
          </Link>
        </Typography>
      ) : (
        <>
          <Typography variant="overline" component="p" color="text.secondary">
            {t('now.medsTray.choose')}
          </Typography>
          <ChipGroup
            multiple
            aria-label={t('now.medsTray.choose')}
            value={selected}
            onChange={setSelected}
            options={all.map((m) => ({ value: m.id, label: m.name }))}
          />
          <Button
            variant="contained"
            size="large"
            fullWidth
            disabled={disabled || selected.length === 0}
            onClick={() => onChoose(medicationPayloadEntries(selected, all))}
            sx={{ minHeight: 56 }}
          >
            {selected.length === 0
              ? t('now.medsTray.pick')
              : t('now.medsTray.log', { count: selected.length })}
          </Button>
        </>
      )}
    </SheetFrame>
  );
}
