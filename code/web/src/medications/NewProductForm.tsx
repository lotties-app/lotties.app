import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button } from '@mui/material';
import { describeApiError } from '../api/errorMessages';
import { useApiClient } from '../api/ApiClientContext';
import { cacheProducts } from '../db/catalogCache';
import { useDatabase } from '../db/DatabaseContext';
import { useLocale } from '../i18n/useLocale';
import type { ProductDto, ProductForm } from '../sync/contract';
import { ChipGroup, Field, TextInput } from '../ui/form';
import { createProduct } from './catalogApi';
import { FORM_ICONS, PRODUCT_FORMS } from './doseUnits';

const COUNTRY = /^[A-Za-z]{2}$/;

interface Props {
  /** The text the parent typed: the product's name unless changed. */
  initialName: string;
  /** `existed`: the catalog already had it (409), so that one is used instead. */
  onCreated: (product: ProductDto, existed: boolean) => void;
  onCancel: () => void;
}

/**
 * "Not listed? Add it": adds a community product to the shared catalog (name, form, country). The
 * server checks for a duplicate first; when it exists that product is shown and used.
 */
export function NewProductForm({ initialName, onCreated, onCancel }: Props) {
  const { t } = useTranslation();
  const api = useApiClient();
  const db = useDatabase();
  const { locale } = useLocale();
  const [name, setName] = useState(initialName.trim());
  const [form, setForm] = useState<ProductForm | null>(null);
  const [country, setCountry] = useState(locale === 'pt-BR' ? 'BR' : 'US');
  const [errors, setErrors] = useState<{ name?: string; form?: string; country?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const next = {
      ...(name.trim().length < 2 ? { name: t('medications.newProduct.nameInvalid') } : {}),
      ...(form ? {} : { form: t('medications.newProduct.formRequired') }),
      ...(COUNTRY.test(country.trim())
        ? {}
        : { country: t('medications.newProduct.countryInvalid') }),
    };
    setErrors(next);
    setFailure(null);
    if (Object.keys(next).length > 0 || !form) return;
    setBusy(true);
    try {
      const created = await createProduct(api, {
        name: name.trim(),
        form,
        country: country.trim().toUpperCase(),
      });
      await cacheProducts(db, [created.product]);
      onCreated(created.product, created.existed);
    } catch (error) {
      setFailure(describeApiError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      role="group"
      aria-label={t('medications.newProduct.title')}
      sx={{
        display: 'grid',
        gap: 1.5,
        p: 1.5,
        borderRadius: '18px',
        border: 1,
        borderColor: 'divider',
      }}
    >
      <Box component="p" sx={{ m: 0, fontWeight: 600 }}>
        {t('medications.newProduct.title')}
      </Box>
      <Box component="p" sx={{ m: 0, fontSize: '0.8125rem', color: 'text.secondary' }}>
        {t('medications.newProduct.help')}
      </Box>
      <Field label={t('medications.newProduct.name')} required error={errors.name}>
        <TextInput value={name} onChange={setName} maxLength={100} />
      </Field>
      <Field label={t('medications.newProduct.form')} required group error={errors.form}>
        <ChipGroup
          value={form}
          onChange={setForm}
          options={PRODUCT_FORMS.map((value) => ({
            value,
            label: t(`medications.forms.${value}`),
            icon: FORM_ICONS[value],
          }))}
        />
      </Field>
      <Field
        label={t('medications.newProduct.country')}
        required
        help={t('medications.newProduct.countryHelp')}
        error={errors.country}
      >
        <TextInput value={country} onChange={setCountry} maxLength={2} />
      </Field>
      {failure && (
        <Box role="alert" sx={{ fontSize: '0.8125rem', color: 'error.main' }}>
          {failure}
        </Box>
      )}
      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
        <Button onClick={onCancel} sx={{ minHeight: 44 }}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          disabled={busy}
          onClick={() => void submit()}
          sx={{ minHeight: 44 }}
        >
          {t('medications.newProduct.add')}
        </Button>
      </Box>
    </Box>
  );
}
