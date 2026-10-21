import { formatNumber } from '../i18n/format';
import type { ProductDto } from '../sync/contract';

/** `75 mg/1 mL`-style strength of the first substance that has one, localized; `null` if none. */
export function strengthText(product: ProductDto): string | null {
  const strength = product.substances.find((s) => s.strength)?.strength;
  if (!strength) return null;
  const per =
    strength.perUnit && strength.perAmount
      ? `/${formatNumber(strength.perAmount)} ${strength.perUnit}`
      : '';
  return `${formatNumber(strength.amount)} ${strength.unit}${per}`;
}
