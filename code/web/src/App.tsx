import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from './i18n/I18nProvider';
import { AppThemeProvider } from './theme/AppThemeProvider';
import { readConfig, type ConfigResult } from './config/appConfig';
import { SetupMessage } from './config/SetupMessage';
import { OidcAuthProvider } from './auth/OidcAuthProvider';
import { ApiClientProvider } from './api/ApiClientProvider';
import { ConsentProvider } from './consent/ConsentProvider';
import { AccountDataProvider } from './session/AccountDataProvider';
import { UnitsProvider } from './units/UnitsProvider';
import { AppRoutes } from './AppRoutes';
import { ReloadPrompt } from './pwa/ReloadPrompt';

const queryClient = new QueryClient();

export default function App({ configResult = readConfig() }: { configResult?: ConfigResult }) {
  return (
    <I18nProvider>
      <AppThemeProvider>
        {configResult.ok ? (
          <BrowserRouter>
            <OidcAuthProvider config={configResult.config.oidc}>
              <ApiClientProvider baseUrl={configResult.config.apiBaseUrl}>
                <ConsentProvider>
                  <AccountDataProvider>
                    <UnitsProvider>
                      <QueryClientProvider client={queryClient}>
                        <AppRoutes />
                      </QueryClientProvider>
                    </UnitsProvider>
                  </AccountDataProvider>
                </ConsentProvider>
              </ApiClientProvider>
            </OidcAuthProvider>
          </BrowserRouter>
        ) : (
          <SetupMessage missing={configResult.missing} />
        )}
        <ReloadPrompt />
      </AppThemeProvider>
    </I18nProvider>
  );
}
