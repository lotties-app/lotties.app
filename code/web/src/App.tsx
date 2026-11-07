import { useState, type ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from './i18n/I18nProvider';
import { AppThemeProvider } from './theme/AppThemeProvider';
import { readConfig, type AppConfig, type ConfigResult } from './config/appConfig';
import { SetupMessage } from './config/SetupMessage';
import { OidcAuthProvider } from './auth/OidcAuthProvider';
import { DemoAuthProvider } from './auth/demo/DemoAuthProvider';
import { readDemoSession } from './auth/demo/demoSession';
import { ApiClientProvider } from './api/ApiClientProvider';
import { ConsentProvider } from './consent/ConsentProvider';
import { AccountDataProvider } from './session/AccountDataProvider';
import { UnitsProvider } from './units/UnitsProvider';
import { TimeBottlesSync } from './presets/FeedingSettingsSync';
import { AppRoutes } from './AppRoutes';
import { ReloadPrompt } from './pwa/ReloadPrompt';

const queryClient = new QueryClient();

/**
 * A valid stored demo session (docs/design/45-try-it-demo.md) replaces the identity provider for
 * the whole page load; starting or ending a demo is a full page load, so this is read once.
 */
function AuthSwitch({ oidc, children }: { oidc: AppConfig['oidc']; children: ReactNode }) {
  const [demo] = useState(() => readDemoSession());
  if (demo) return <DemoAuthProvider session={demo}>{children}</DemoAuthProvider>;
  return <OidcAuthProvider config={oidc}>{children}</OidcAuthProvider>;
}

export default function App({ configResult = readConfig() }: { configResult?: ConfigResult }) {
  return (
    <I18nProvider>
      <AppThemeProvider>
        {configResult.ok ? (
          <BrowserRouter>
            <AuthSwitch oidc={configResult.config.oidc}>
              <ApiClientProvider baseUrl={configResult.config.apiBaseUrl}>
                <ConsentProvider>
                  <AccountDataProvider>
                    <UnitsProvider>
                      <TimeBottlesSync />
                      <QueryClientProvider client={queryClient}>
                        <AppRoutes />
                      </QueryClientProvider>
                    </UnitsProvider>
                  </AccountDataProvider>
                </ConsentProvider>
              </ApiClientProvider>
            </AuthSwitch>
          </BrowserRouter>
        ) : (
          <SetupMessage missing={configResult.missing} />
        )}
        <ReloadPrompt />
      </AppThemeProvider>
    </I18nProvider>
  );
}
