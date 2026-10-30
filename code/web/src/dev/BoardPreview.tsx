import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ApiClientContext } from '../api/ApiClientContext';
import { BoardFrame } from '../board/BoardPage';
import { BoardScreen } from '../board/BoardScreen';
import { fakeBoardServer, ROLE_ME } from '../board/boardTestKit';
import { BoardBaseContext } from '../board/useBoardLinks';
import { fakeApi } from '../test/fakeApi';
import { PreviewToolbar } from './PreviewToolbar';

/*
 * Developer-only (route `/dev/board`, never in production builds): the project board
 * (docs/design/36-project-board.md) over an in-memory board API with synthetic items. `?state=`
 * admin (everything, API keys), writer, reader, empty (no items yet), none (no board role).
 * Drawer links stay under `/dev/board/<id>`; `?panel=keys` opens the admin settings.
 * No sign-in, no server.
 */

const SCENARIOS = ['admin', 'writer', 'reader', 'empty', 'none'] as const;
type Scenario = (typeof SCENARIOS)[number];

function Scenario({ scenario }: { scenario: Scenario }) {
  const { t } = useTranslation();
  const [setup] = useState(() => {
    const server = fakeBoardServer({
      access:
        scenario === 'reader'
          ? ROLE_ME.reader
          : scenario === 'writer'
            ? ROLE_ME.writer
            : ROLE_ME.admin,
      items: scenario === 'empty' ? [] : undefined,
    });
    return {
      api: fakeApi(server.handler).api,
      queries: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    };
  });
  const me =
    scenario === 'reader' ? ROLE_ME.reader : scenario === 'writer' ? ROLE_ME.writer : ROLE_ME.admin;
  return (
    <ApiClientContext value={setup.api}>
      <QueryClientProvider client={setup.queries}>
        <BoardFrame>
          {scenario === 'none' ? (
            <Alert severity="info">{t('board.access.none')}</Alert>
          ) : (
            <BoardScreen me={me} />
          )}
        </BoardFrame>
      </QueryClientProvider>
    </ApiClientContext>
  );
}

/** Developer-only: the board with fixture data (route `/dev/board?state=admin`). */
export default function BoardPreview() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'admin';
  return (
    <BoardBaseContext value="/dev/board">
      <Scenario key={scenario} scenario={scenario} />
      <Box sx={{ maxWidth: 480, mx: 'auto', px: 2, pb: 2 }}>
        <PreviewToolbar
          scenarios={SCENARIOS}
          scenario={scenario}
          onScenario={(next) => setParams({ state: next }, { replace: true })}
        />
      </Box>
    </BoardBaseContext>
  );
}
