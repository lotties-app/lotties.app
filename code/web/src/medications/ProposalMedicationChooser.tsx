import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button } from '@mui/material';
import { cacheProducts, productKey } from '../db/catalogCache';
import { useDatabase } from '../db/DatabaseContext';
import { useMedications } from '../db/hooks';
import type { Medication } from '../db/models';
import { PROPOSAL_NAME_MAX } from '../proposals/proposalModel';
import type { ProductDto } from '../sync/contract';
import { Icon } from '../ui/Icon';
import { filledSurface, optionBase, palette, selectedOption } from '../ui/form/styles';
import { CatalogResults } from './CatalogResults';
import { ChooserSearch } from './ChooserSearch';
import { LinkedProduct } from './LinkedProduct';

/** What a proposal names: a medication of the baby's list, a catalog product, or just a name. */
export interface MedicationRef {
  medicationId: string | null;
  productId: string | null;
  name: string;
}

interface Props {
  babyId: string;
  value: MedicationRef | null;
  onChange: (ref: MedicationRef) => void;
}

/**
 * Picks the medicine a doctor's proposal is for: the baby's own list first (the parents' accept then
 * uses that medicine), then the shared catalog and ingredient search, or a plain name ("Use "X""). It
 * only names the medicine: nothing is added to the baby's list, the parents decide that when they
 * accept (docs/design/16-doctor-access.md section 10.5).
 */
export function ProposalMedicationChooser({ babyId, value, onChange }: Props) {
  const { t } = useTranslation();
  const db = useDatabase();
  const medications = useMedications(babyId) ?? [];
  const [query, setQuery] = useState('');
  const [changing, setChanging] = useState(false);
  const needle = productKey(query);
  const shown = medications.filter((m) => needle === '' || productKey(m.name).includes(needle));
  const exists = medications.some((m) => productKey(m.name) === needle);
  const typed = query.trim().slice(0, PROPOSAL_NAME_MAX);

  const pick = (ref: MedicationRef) => {
    onChange(ref);
    setQuery('');
    setChanging(false);
  };
  const pickMedication = (m: Medication) =>
    pick({ medicationId: m.id, productId: m.productId ?? null, name: m.name });
  const pickProduct = (product: ProductDto) => {
    // Cached, so the dose unit chips follow the product's form even offline.
    void cacheProducts(db, [product]);
    pick({ medicationId: null, productId: product.id, name: product.name });
  };

  if (value && !changing) {
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
            {value.name}
          </Box>
          <Box
            component="span"
            sx={{ display: 'block', fontSize: '0.8125rem', color: 'text.secondary' }}
          >
            <LinkedProduct medication={{ productId: value.productId }} />
          </Box>
        </Box>
        <Button onClick={() => setChanging(true)} sx={{ minHeight: 44 }}>
          {t('medications.editor.change')}
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'grid', gap: 1.25 }}>
      <ChooserSearch value={query} onChange={setQuery} />
      {shown.length > 0 && (
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
              onClick={() => pickMedication(medication)}
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
      )}
      {typed !== '' && !exists && (
        <Box
          component="button"
          type="button"
          onClick={() => pick({ medicationId: null, productId: null, name: typed })}
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
          <span>{t('proposals.chooser.useName', { name: typed })}</span>
        </Box>
      )}
      <CatalogResults
        query={query}
        medications={medications}
        mode="pick"
        canCreate={false}
        onChooseMedication={pickMedication}
        onChooseProduct={pickProduct}
      />
      {medications.length === 0 && query.trim() === '' && (
        <Box sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
          {t('proposals.chooser.noneYet')}
        </Box>
      )}
    </Box>
  );
}
