import type { ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { ConsentGate } from './ConsentGate';
import { ConsentProvider } from './ConsentProvider';

/** The provider with the gate over a page that proves the app is reachable. */
export function GatedApp({ children }: { children?: ReactNode }) {
  return (
    <ConsentProvider>
      <Routes>
        <Route element={<ConsentGate />}>
          <Route path="/" element={<main>{children ?? <p>the app</p>}</main>} />
        </Route>
      </Routes>
    </ConsentProvider>
  );
}
