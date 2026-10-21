import { cacheProducts } from '../db/catalogCache';
import { useDatabase } from '../db/DatabaseContext';
import { useMedicationCommands } from '../db/hooks';
import type { Medication } from '../db/models';
import type { ProductDto } from '../sync/contract';

/**
 * Adds a medication to the baby's catalog linked to a shared product (`productId`), and remembers
 * the product on this device as recently used. The baby's own name is the product name; it can be
 * renamed later (the link stays).
 */
export function useAddFromProduct(babyId: string) {
  const db = useDatabase();
  const commands = useMedicationCommands();
  return async (product: ProductDto): Promise<Medication> => {
    await cacheProducts(db, [product]);
    return commands.create({ babyId, name: product.name, productId: product.id });
  };
}
