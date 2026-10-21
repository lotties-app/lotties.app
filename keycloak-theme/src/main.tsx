import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { KcPage } from './kc.gen';

// The following block can be uncommented to test a specific page with `npm run dev`
// Don't forget to comment it back or your bundle size will increase
if (import.meta.env.DEV) {
  const { getKcContextMock } = await import('./login/KcContextMock');
  const params = new URLSearchParams(window.location.search);
  window.kcContext ??= getKcContextMock({
    pageId: (params.get('pageId') ?? 'login.ftl') as never,

  });
  const lang = params.get('lang');
  if (lang && window.kcContext) {
    const ctx = window.kcContext as unknown as { locale?: { currentLanguageTag: string } };
    if (ctx.locale) ctx.locale.currentLanguageTag = lang;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{!window.kcContext ? <h1>No Keycloak Context</h1> : <KcPage kcContext={window.kcContext} />}</StrictMode>,
);
