import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import { formatList } from '../i18n/format';
import { useLocale } from '../i18n/useLocale';
import type { ProductDto, SiblingProductDto } from '../sync/contract';
import { palette } from '../ui/form/styles';
import { isCurated, isOfficial } from './catalogApi';
import { strengthText } from './productText';
import { Icon } from '../ui/Icon';

function useSubstanceNames(product: ProductDto) {
  const { locale } = useLocale();
  return product.substances.map((s) => (locale === 'pt-BR' ? s.namePtBr : s.nameEn) || s.key);
}

/**
 * Product line: form, presentation text of official names (e.g. `0,9%`), strength and substances
 * (generic names), as the catalog knows them. An official or curated product without ingredients
 * says so ("Ingredient not listed in the official data") instead of leaving the ingredient out.
 */
export function ProductMeta({ product }: { product: ProductDto }) {
  const { t } = useTranslation();
  const substances = useSubstanceNames(product);
  const imported = isOfficial(product) || isCurated(product);
  const ingredients =
    substances.length > 0
      ? formatList(substances)
      : imported
        ? t('medications.catalog.ingredientNotListed')
        : null;
  const parts = [
    t(`medications.forms.${product.form}`),
    product.presentation ?? null,
    strengthText(product),
    ingredients,
  ].filter(Boolean);
  return <>{parts.join(' · ')}</>;
}

/**
 * "Official list (ANVISA)" or "Curated list (not reviewed by a pharmacist)" on an imported product;
 * nothing otherwise.
 */
export function OfficialSourceLabel({ product }: { product: ProductDto }) {
  const { t } = useTranslation();
  if (!isOfficial(product) && !isCurated(product)) return null;
  return (
    <Box
      component="span"
      sx={(theme) => ({
        display: 'block',
        fontSize: '0.75rem',
        fontWeight: 500,
        color: palette(theme).text.secondary,
      })}
    >
      {isOfficial(product) ? t('medications.catalog.official') : t('medications.catalog.curated')}
    </Box>
  );
}

/**
 * "Different products share this name with different ingredients. Check the box." on every variant
 * of an ambiguous name (docs/design/13-anvisa-catalog.md): the parent compares the ingredients.
 */
export function AmbiguousNameWarning({ product }: { product: ProductDto }) {
  const { t } = useTranslation();
  if (!product.ambiguousName) return null;
  return (
    <Box
      role="note"
      sx={(theme) => ({
        display: 'flex',
        gap: 1,
        alignItems: 'flex-start',
        fontSize: '0.8125rem',
        color: palette(theme).text.secondary,
      })}
    >
      <Icon name="info" size={16} sx={{ mt: '2px', flex: 'none' }} />
      <span>{t('medications.catalog.ambiguousName')}</span>
    </Box>
  );
}

/**
 * Where official products come from and what they are not (docs/design/13-anvisa-catalog.md):
 * the source attribution and the "not reviewed by a pharmacist" caveat, once per list.
 */
export function OfficialAttribution() {
  const { t } = useTranslation();
  return (
    <Box
      component="p"
      sx={(theme) => ({
        m: 0,
        fontSize: '0.75rem',
        color: palette(theme).text.secondary,
      })}
    >
      {t('medications.catalog.officialAttribution')}
    </Box>
  );
}

/**
 * "Contains the same active ingredient as Luftal: simethicone. Ask your doctor or pharmacist before
 * substituting." Information only: it never picks or swaps anything.
 */
export function SameIngredientNote({
  product,
  siblings,
}: {
  product: ProductDto;
  siblings: readonly SiblingProductDto[];
}) {
  const { t } = useTranslation();
  const substances = useSubstanceNames(product);
  if (siblings.length === 0 || substances.length === 0) return null;
  return (
    <Box
      role="note"
      sx={(theme) => ({
        display: 'flex',
        gap: 1,
        alignItems: 'flex-start',
        fontSize: '0.8125rem',
        color: palette(theme).text.secondary,
      })}
    >
      <Icon name="info" size={16} sx={{ mt: '2px', flex: 'none' }} />
      <span>
        {t('medications.sameIngredient', {
          names: formatList(siblings.map((s) => s.name)),
          substances: formatList(substances),
        })}
      </span>
    </Box>
  );
}
