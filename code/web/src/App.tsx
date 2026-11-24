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
import { LocalAuthProvider } from './auth/local/LocalAuthProvider';
import { ApiClientProvider } from './api/ApiClientProvider';
import { ConsentProvider } from './consent/ConsentProvider';
import { AccountDataProvider } from './session/AccountDataProvider';
import { UnitsProvider } from './units/UnitsProvider';
import { TimeBottlesSync } from './presets/FeedingSettingsSync';
import { AppRoutes } from './AppRoutes';
import { ReloadPrompt } from './pwa/ReloadPrompt';

const queryClient = new QueryClient();

/** Whether the app is running in unauthenticated local/self-hosted mode (no OIDC required). */
const IS_LOCAL_MODE = import.meta.env.VITE_LOCAL_MODE === 'true';

/**
 * Selects the auth provider: LocalAuthProvider for self-hosted mode, DemoAuthProvider for demo
 * sessions, or OidcAuthProvider for standard authenticated deployments. The choice is made once
 * per page load since switching modes requires a full reload.
 */
function AuthSwitch({ oidc, children }: { oidc: AppConfig['oidc'] | null; children: ReactNode }) {
  const [demo] = useState(() => readDemoSession());
  if (IS_LOCAL_MODE) return <LocalAuthProvider>{children}</LocalAuthProvider>;
  if (demo) return <DemoAuthProvider session={demo}>{children}</DemoAuthProvider>;
  if (!oidc) throw new Error('OIDC config is required when not in local mode');
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
