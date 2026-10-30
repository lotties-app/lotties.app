import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Box } from '@mui/material';
import { formatList } from '../i18n/format';
import { useLocale } from '../i18n/useLocale';
import type { ProductDto, SiblingProductDto } from '../sync/contract';
import { palette } from '../ui/form/styles';
import { ALTERNATIVE_LEVELS, alternativeLevel, isCurated, isOfficial } from './catalogApi';
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
  const shownStrength =
    product.strengthText && !(product.presentation ?? '').includes(product.strengthText)
      ? product.strengthText
      : null;
  const parts = [
    t(`medications.forms.${product.form}`),
    product.presentation ?? null,
    shownStrength,
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
 * The other products with the same active ingredient, in labelled groups (docs/design/13-anvisa-catalog.md
 * section 12): "same ingredient, strength and form" first, then "same strength, other form", "strength
 * not known" and "different strength". Only the first group says the products match; none is a
 * substitution advice and nothing here picks or swaps a medicine. Alternatives without a level (an
 * older server, the offline list) read as "strength not known".
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
  const groups = ALTERNATIVE_LEVELS.map((level) => ({
    level,
    items: siblings.filter((sibling) => alternativeLevel(sibling) === level),
  })).filter((group) => group.items.length > 0);
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
      <Box sx={{ display: 'grid', gap: 0.5, minWidth: 0, overflowWrap: 'anywhere' }}>
        <p style={{ margin: 0 }}>
          {t('medications.alternatives.intro', { substances: formatList(substances) })}
        </p>
        {groups.map((group) => (
          <p key={group.level} style={{ margin: 0 }} data-level={group.level}>
            <strong>{t(`medications.alternatives.${group.level}`)}: </strong>
            {formatList(group.items.map((item) => alternativeItem(item, t)))}
          </p>
        ))}
        <p style={{ margin: 0 }}>{t('medications.alternatives.footer')}</p>
      </Box>
    </Box>
  );
}

function alternativeItem(sibling: SiblingProductDto, t: TFunction): string {
  const details = [sibling.strengthText ?? null, t(`medications.forms.${sibling.form}`)].filter(
    Boolean,
  );
  return t('medications.alternatives.item', { name: sibling.name, details: details.join(', ') });
}
