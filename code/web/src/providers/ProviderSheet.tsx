import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button } from '@mui/material';
import { useCareProviderCommands } from '../db/hooks';
import type { CareProvider } from '../db/models';
import { SheetFrame } from '../now/ui/SheetFrame';
import { CategoryIcon } from '../ui/CategoryIcon';
import { ChipGroup, Field, NotesRow, SwitchRow, TextInput } from '../ui/form';
import { AddressFinder } from './AddressFinder';
import {
  PROVIDER_LIMITS,
  SPECIALTY_CODES,
  careProviderTermsOf,
  specialtyCodeOf,
  type CareProviderTerms,
  type SpecialtyCode,
} from './providerModel';
import { useSpecialtyLabel } from './useSpecialtyLabel';

interface Props {
  babyId: string;
  /** Omit to add a new provider. */
  provider?: CareProvider;
  /** Typed in the appointment's picker: the name a new provider starts with. */
  initialName?: string;
  onClose: () => void;
  onSaved?: (provider: CareProvider) => void;
}

const blank = (name: string): CareProviderTerms => ({
  name,
  specialty: null,
  registrationCouncil: null,
  registrationNumber: null,
  registrationRegion: null,
  clinicName: null,
  address: null,
  phone: null,
  whatsapp: null,
  email: null,
  website: null,
  notes: null,
  favorite: false,
  deleted: false,
});

/**
 * Add or edit a care provider of the baby: name (required), specialty (free text with suggested
 * ones), the professional registration (council, number, region), clinic, address, phone, WhatsApp,
 * e-mail, website, notes and "Favorite". Saved on the device and queued for sync. Contact details
 * only: the notes are not the place for the baby's health information.
 */
export function ProviderSheet({ babyId, provider, initialName = '', onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const commands = useCareProviderCommands();
  const { labelOf, codeOfLabel } = useSpecialtyLabel();
  const [terms, setTerms] = useState<CareProviderTerms>(() =>
    provider ? careProviderTermsOf(provider) : blank(initialName),
  );
  // The specialty field shows a suggested one by its translated label and stores it by code.
  const [specialtyText, setSpecialtyText] = useState(() => labelOf(terms.specialty) ?? '');
  const [nameError, setNameError] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const change = (patch: Partial<CareProviderTerms>) => {
    setTerms((current) => ({ ...current, ...patch }));
    setFailed(false);
  };
  const text = (key: keyof CareProviderTerms) => (terms[key] as string | null) ?? '';
  const selectedCode = specialtyCodeOf(codeOfLabel(specialtyText) ?? specialtyText);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // The sheet can open inside another form (the appointment's): a React submit bubbles through the portal.
    event.stopPropagation();
    const name = terms.name.trim();
    if (!name || name.length > PROVIDER_LIMITS.name) {
      setNameError(true);
      return;
    }
    setSaving(true);
    setFailed(false);
    const specialty = codeOfLabel(specialtyText) ?? specialtyText;
    try {
      const saved = provider
        ? await commands.update(provider.id, { ...terms, specialty })
        : await commands.create(babyId, { ...terms, specialty });
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
      title={provider ? t('providers.sheet.editTitle') : t('providers.sheet.newTitle')}
      leading={<CategoryIcon name="stethoscope" category="health" size={24} />}
    >
      <Box
        component="form"
        noValidate
        onSubmit={(e: FormEvent) => void submit(e)}
        sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2.5 }}
      >
        <Field
          label={t('providers.sheet.name')}
          required
          error={nameError ? t('providers.sheet.nameRequired') : undefined}
        >
          <TextInput
            value={terms.name}
            onChange={(name) => {
              change({ name });
              setNameError(false);
            }}
            maxLength={PROVIDER_LIMITS.name}
            placeholder={t('providers.sheet.namePlaceholder')}
          />
        </Field>
        <Field label={t('providers.sheet.specialty')} optional>
          <TextInput
            value={specialtyText}
            onChange={setSpecialtyText}
            maxLength={PROVIDER_LIMITS.specialty}
          />
        </Field>
        <Field label={t('providers.sheet.specialtySuggestions')} group>
          <ChipGroup<SpecialtyCode>
            clearable
            value={selectedCode}
            onChange={(code) => setSpecialtyText(code ? (labelOf(code) ?? '') : '')}
            options={SPECIALTY_CODES.map((code) => ({
              value: code,
              label: t(`providers.specialties.${code}`),
            }))}
          />
        </Field>
        <Box
          sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 1.5 }}
        >
          <Field label={t('providers.sheet.registrationCouncil')} optional>
            <TextInput
              value={text('registrationCouncil')}
              onChange={(registrationCouncil) => change({ registrationCouncil })}
              maxLength={PROVIDER_LIMITS.registrationCouncil}
              placeholder={t('providers.sheet.registrationCouncilPlaceholder')}
            />
          </Field>
          <Field label={t('providers.sheet.registrationRegion')} optional>
            <TextInput
              value={text('registrationRegion')}
              onChange={(registrationRegion) => change({ registrationRegion })}
              maxLength={PROVIDER_LIMITS.registrationRegion}
              placeholder={t('providers.sheet.registrationRegionPlaceholder')}
            />
          </Field>
        </Box>
        <Field label={t('providers.sheet.registrationNumber')} optional>
          <TextInput
            value={text('registrationNumber')}
            onChange={(registrationNumber) => change({ registrationNumber })}
            maxLength={PROVIDER_LIMITS.registrationNumber}
          />
        </Field>
        <Field label={t('providers.sheet.clinicName')} optional icon="hospital">
          <TextInput
            value={text('clinicName')}
            onChange={(clinicName) => change({ clinicName })}
            maxLength={PROVIDER_LIMITS.clinicName}
          />
        </Field>
        <AddressFinder address={text('address')} onAddress={(address) => change({ address })} />
        <Field label={t('providers.sheet.address')} optional icon="map-pin">
          <NotesRow
            value={text('address')}
            onChange={(address) => change({ address })}
            maxLength={PROVIDER_LIMITS.address}
            counterFrom={300}
          />
        </Field>
        <Field label={t('providers.sheet.phone')} optional icon="phone">
          <TextInput
            value={text('phone')}
            onChange={(phone) => change({ phone })}
            maxLength={PROVIDER_LIMITS.phone}
          />
        </Field>
        <Field
          label={t('providers.sheet.whatsapp')}
          optional
          icon="whatsapp"
          help={t('providers.sheet.whatsappHelp')}
        >
          <TextInput
            value={text('whatsapp')}
            onChange={(whatsapp) => change({ whatsapp })}
            maxLength={PROVIDER_LIMITS.whatsapp}
          />
        </Field>
        <Field label={t('providers.sheet.email')} optional icon="mail">
          <TextInput
            value={text('email')}
            onChange={(email) => change({ email })}
            maxLength={PROVIDER_LIMITS.email}
          />
        </Field>
        <Field label={t('providers.sheet.website')} optional icon="world">
          <TextInput
            value={text('website')}
            onChange={(website) => change({ website })}
            maxLength={PROVIDER_LIMITS.website}
            placeholder={t('providers.sheet.websitePlaceholder')}
          />
        </Field>
        <Field label={t('providers.sheet.notes')} optional help={t('providers.sheet.notesHelp')}>
          <NotesRow
            value={text('notes')}
            onChange={(notes) => change({ notes })}
            maxLength={PROVIDER_LIMITS.notes}
            counterFrom={800}
          />
        </Field>
        <SwitchRow
          checked={terms.favorite}
          onChange={(favorite) => change({ favorite })}
          label={t('providers.sheet.favorite')}
          description={t('providers.sheet.favoriteHelp')}
          icon="star"
        />
        {failed && (
          <Box role="alert" sx={{ fontSize: '0.875rem', color: 'error.main' }}>
            {t('providers.sheet.saveFailed')}
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
