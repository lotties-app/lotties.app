import { useLiveQuery } from 'dexie-react-hooks';
import { cachedProduct } from '../db/catalogCache';
import { useDatabase } from '../db/DatabaseContext';
import type { Medication } from '../db/models';
import { ProductMeta } from './ProductInfo';

/** Form, strength and substances of the shared product a medication is linked to (device cache). */
export function LinkedProduct({ medication }: { medication: Pick<Medication, 'productId'> }) {
  const db = useDatabase();
  const productId = medication.productId ?? null;
  const product = useLiveQuery(
    () => (productId ? cachedProduct(db, productId) : undefined),
    [db, productId],
  );
  return product ? <ProductMeta product={product} /> : null;
}
