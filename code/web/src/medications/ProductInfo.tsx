import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import { formatList } from '../i18n/format';
import { useLocale } from '../i18n/useLocale';
import type { ProductDto, SiblingProductDto } from '../sync/contract';
import { palette } from '../ui/form/styles';
import { strengthText } from './productText';
import { Icon } from '../ui/Icon';

function useSubstanceNames(product: ProductDto) {
  const { locale } = useLocale();
  return product.substances.map((s) => (locale === 'pt-BR' ? s.namePtBr : s.nameEn) || s.key);
}

/** Product line: name, form, strength and substances (generic names), as the catalog knows them. */
export function ProductMeta({ product }: { product: ProductDto }) {
  const { t } = useTranslation();
  const substances = useSubstanceNames(product);
  const parts = [
    t(`medications.forms.${product.form}`),
    strengthText(product),
    substances.length > 0 ? formatList(substances) : null,
  ].filter(Boolean);
  return <>{parts.join(' · ')}</>;
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
