import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isNativeApp } from './platform/nativeApp';
// Listens for the browser's install prompt from the first moment: the event fires once per page load.
import './pwa/installPrompt';
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
