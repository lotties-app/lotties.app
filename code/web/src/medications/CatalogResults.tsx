import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import type { Medication } from '../db/models';
import { useOnline } from '../sync/useOnline';
import type { ProductDto } from '../sync/contract';
import { Icon } from '../ui/Icon';
import { filledSurface, optionBase, palette } from '../ui/form/styles';
import { NewProductForm } from './NewProductForm';
import { ProductMeta, SameIngredientNote } from './ProductInfo';
import { useCatalogSearch } from './useCatalogSearch';

interface Props {
  query: string;
  /** The baby's medications: a product already linked to one is shown as that medication. */
  medications: readonly Medication[];
  /** The parent chose a catalog product (not yet in the baby's catalog). */
  onChooseProduct: (product: ProductDto) => void;
  /** The parent chose a product the baby already has: use that medication (no duplicate row). */
  onChooseMedication: (medication: Medication) => void;
  /** Hide "Not listed? Add it" (the parent shows it elsewhere). */
  canCreate?: boolean;
}

/**
 * Matches of the shared catalog for what is typed: product, form, strength and substances, the
 * "same active ingredient" note (information only) and "Not listed? Add it". Offline it searches
 * only the products cached on this device.
 */
export function CatalogResults({
  query,
  medications,
  onChooseProduct,
  onChooseMedication,
  canCreate = true,
}: Props) {
  const { t } = useTranslation();
  const online = useOnline();
  const search = useCatalogSearch(query);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (search.matches === null) return null;

  const choose = (product: ProductDto) => {
    const existing = medications.find((m) => m.productId === product.id);
    if (existing) onChooseMedication(existing);
    else onChooseProduct(product);
  };

  return (
    <Box sx={{ display: 'grid', gap: 1 }} aria-busy={search.loading || undefined}>
      <Box
        component="p"
        id="catalog-results-title"
        sx={(theme) => ({
          m: 0,
          fontSize: '0.75rem',
          fontWeight: 500,
          color: palette(theme).text.secondary,
        })}
      >
        {search.fromCache ? t('medications.catalog.titleOffline') : t('medications.catalog.title')}
      </Box>
      {search.matches.length === 0 && !search.loading && (
        <Box sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
          {t('medications.catalog.noMatch', { query: query.trim() })}
        </Box>
      )}
      <Box role="list" aria-labelledby="catalog-results-title" sx={{ display: 'grid', gap: 1 }}>
        {search.matches.map(({ product, siblings }) => {
          const linked = medications.find((m) => m.productId === product.id);
          return (
            <Box
              role="listitem"
              key={product.id}
              sx={(theme) => ({
                ...filledSurface(theme),
                borderRadius: '18px',
                display: 'grid',
                gap: 0.75,
                p: 1.25,
              })}
            >
              <Box
                component="button"
                type="button"
                onClick={() => choose(product)}
                aria-label={
                  linked
                    ? t('medications.catalog.useExisting', { name: linked.name })
                    : t('medications.catalog.addNamed', { name: product.name })
                }
                sx={(theme) => ({
                  ...optionBase(theme),
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  width: '100%',
                  minHeight: 48,
                  background: 'none',
                  textAlign: 'start',
                  color: palette(theme).text.primary,
                  p: 0,
                  borderRadius: '12px',
                })}
              >
                <Icon name="pill" size={20} sx={{ color: 'text.secondary', flex: 'none' }} />
                <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
                  <Box component="span" sx={{ display: 'block', fontWeight: 600 }}>
                    {product.name}
                  </Box>
                  <Box
                    component="span"
                    sx={{ display: 'block', fontSize: '0.8125rem', color: 'text.secondary' }}
                  >
                    <ProductMeta product={product} />
                  </Box>
                </Box>
                <Box component="span" sx={{ color: 'primary.main', fontWeight: 600, flex: 'none' }}>
                  {linked ? t('medications.catalog.inYourList') : t('medications.catalog.add')}
                </Box>
              </Box>
              <SameIngredientNote product={product} siblings={siblings} />
            </Box>
          );
        })}
      </Box>
      {notice && (
        <Box role="status" sx={{ fontSize: '0.8125rem', color: 'text.secondary' }}>
          {notice}
        </Box>
      )}
      {canCreate && !creating && (
        <Box
          component="button"
          type="button"
          disabled={!online}
          onClick={() => setCreating(true)}
          sx={(theme) => ({
            ...optionBase(theme),
            justifySelf: 'start',
            minHeight: 44,
            px: 1.5,
            borderRadius: '999px',
            background: 'none',
            color: palette(theme).primary.main,
            fontWeight: 600,
          })}
        >
          {online ? t('medications.catalog.notListed') : t('medications.catalog.notListedOffline')}
        </Box>
      )}
      {creating && (
        <NewProductForm
          initialName={query}
          onCancel={() => setCreating(false)}
          onCreated={(product, existed) => {
            setCreating(false);
            setNotice(existed ? t('medications.newProduct.existed', { name: product.name }) : null);
            choose(product);
          }}
        />
      )}
    </Box>
  );
}
