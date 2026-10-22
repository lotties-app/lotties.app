import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import type { Medication } from '../db/models';
import { useOnline } from '../sync/useOnline';
import type { ProductDto } from '../sync/contract';
import { Icon } from '../ui/Icon';
import { filledSurface, optionBase, palette } from '../ui/form/styles';
import { NewProductForm } from './NewProductForm';
import { isOfficial, type CatalogMatch } from './catalogApi';
import {
  AmbiguousNameWarning,
  OfficialAttribution,
  OfficialSourceLabel,
  ProductMeta,
  SameIngredientNote,
} from './ProductInfo';
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
  /**
   * `pick`: choosing a product only names it (a doctor's proposal): the buttons say "Choose", never
   * "Add", because nothing is added to the baby's list. Default `add`.
   */
  mode?: 'add' | 'pick';
}

/**
 * Matches of the shared catalog for what is typed: products matched by name first, then a
 * "Products with this ingredient" section (information only; tapping one selects it like any
 * result), each with form, strength and substances, the "same active ingredient" note, the
 * "Official list (ANVISA)" label and, when any official product is shown, the source attribution.
 * "Not listed? Add it" follows. Offline it searches only the products cached on this device.
 */
export function CatalogResults({
  query,
  medications,
  onChooseProduct,
  onChooseMedication,
  canCreate = true,
  mode = 'add',
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
  const byName = search.matches.filter((m) => m.matchedBy !== 'substance');
  const byIngredient = search.matches.filter((m) => m.matchedBy === 'substance');
  const anyOfficial = search.matches.some((m) => isOfficial(m.product));
  const renderCards = (matches: CatalogMatch[]) =>
    matches.map((match) => (
      <CatalogResultCard
        key={match.product.id}
        match={match}
        linked={medications.find((m) => m.productId === match.product.id)}
        mode={mode}
        onChoose={choose}
      />
    ));

  return (
    <Box sx={{ display: 'grid', gap: 1 }} aria-busy={search.loading || undefined}>
      <SectionTitle id="catalog-results-title">
        {search.fromCache ? t('medications.catalog.titleOffline') : t('medications.catalog.title')}
      </SectionTitle>
      {search.matches.length === 0 && !search.loading && (
        <Box sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
          {t('medications.catalog.noMatch', { query: query.trim() })}
        </Box>
      )}
      {byName.length > 0 && (
        <Box role="list" aria-labelledby="catalog-results-title" sx={{ display: 'grid', gap: 1 }}>
          {renderCards(byName)}
        </Box>
      )}
      {byIngredient.length > 0 && (
        <Box
          component="section"
          aria-labelledby="catalog-ingredient-title"
          sx={{ display: 'grid', gap: 1 }}
        >
          <SectionTitle id="catalog-ingredient-title">
            {t('medications.catalog.byIngredient')}
          </SectionTitle>
          <Box
            component="p"
            sx={(theme) => ({ m: 0, fontSize: '0.8125rem', color: palette(theme).text.secondary })}
          >
            {t('medications.catalog.byIngredientNote')}
          </Box>
          <Box
            role="list"
            aria-labelledby="catalog-ingredient-title"
            sx={{ display: 'grid', gap: 1 }}
          >
            {renderCards(byIngredient)}
          </Box>
        </Box>
      )}
      {anyOfficial && <OfficialAttribution />}
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

function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Box
      component="p"
      id={id}
      sx={(theme) => ({
        m: 0,
        fontSize: '0.75rem',
        fontWeight: 500,
        color: palette(theme).text.secondary,
      })}
    >
      {children}
    </Box>
  );
}

/** One catalog product: the choose button (name, official label, details) and the same-ingredient note. */
function CatalogResultCard({
  match: { product, siblings },
  linked,
  mode,
  onChoose,
}: {
  match: CatalogMatch;
  linked: Medication | undefined;
  mode: 'add' | 'pick';
  onChoose: (product: ProductDto) => void;
}) {
  const { t } = useTranslation();
  return (
    <Box
      role="listitem"
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
        onClick={() => onChoose(product)}
        aria-label={
          linked
            ? t('medications.catalog.useExisting', { name: linked.name })
            : t(
                mode === 'pick'
                  ? 'medications.catalog.chooseNamed'
                  : 'medications.catalog.addNamed',
                { name: product.name },
              )
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
          <OfficialSourceLabel product={product} />
        </Box>
        <Box component="span" sx={{ color: 'primary.main', fontWeight: 600, flex: 'none' }}>
          {linked
            ? t('medications.catalog.inYourList')
            : t(mode === 'pick' ? 'medications.catalog.choose' : 'medications.catalog.add')}
        </Box>
      </Box>
      <AmbiguousNameWarning product={product} />
      <SameIngredientNote product={product} siblings={siblings} />
    </Box>
  );
}
