import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppThemeProvider } from './theme/AppThemeProvider';
import { readConfig, type ConfigResult } from './config/appConfig';
import { SetupMessage } from './config/SetupMessage';
import { OidcAuthProvider } from './auth/OidcAuthProvider';
import { ApiClientProvider } from './api/ApiClientProvider';
import { AppRoutes } from './AppRoutes';

const queryClient = new QueryClient();

export default function App({ configResult = readConfig() }: { configResult?: ConfigResult }) {
  return (
    <AppThemeProvider>
      {configResult.ok ? (
        <BrowserRouter>
          <OidcAuthProvider config={configResult.config.oidc}>
            <ApiClientProvider baseUrl={configResult.config.apiBaseUrl}>
              <QueryClientProvider client={queryClient}>
                <AppRoutes />
              </QueryClientProvider>
            </ApiClientProvider>
          </OidcAuthProvider>
        </BrowserRouter>
      ) : (
        <SetupMessage missing={configResult.missing} />
      )}
    </AppThemeProvider>
  );
}
