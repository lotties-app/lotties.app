import { useLiveQuery } from 'dexie-react-hooks';
import { cachedProduct } from '../db/catalogCache';
import { useDatabase } from '../db/DatabaseContext';
import type { ProductForm } from '../sync/contract';

/** The form of the shared product with this id (device cache), `null` when unlinked or unknown. */
export function useProductForm(productId: string | null | undefined): ProductForm | null {
  const db = useDatabase();
  const id = productId ?? null;
  const product = useLiveQuery(() => (id ? cachedProduct(db, id) : undefined), [db, id]);
  return product?.form ?? null;
}
