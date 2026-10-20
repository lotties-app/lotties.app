import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SelectedBabyProvider } from '../baby/SelectedBabyProvider';
import type { BabyRoutineDb } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';

export function renderWithDb(db: BabyRoutineDb, ui: ReactNode) {
  return render(
    <DatabaseProvider db={db}>
      <SelectedBabyProvider>{ui}</SelectedBabyProvider>
    </DatabaseProvider>,
  );
}
