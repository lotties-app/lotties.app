import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isNativeApp } from './platform/nativeApp';
import './theme/fonts.css';

// The iOS/Android app (code/mobile): native start-up in its own chunk, never loaded by the PWA.
if (isNativeApp()) {
  void import('./platform/startNativeShell').then(({ startNativeShell }) => startNativeShell());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
