import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiClientContext } from '../api/ApiClientContext';
import { AuthContext } from '../auth/AuthContext';
import { I18nProvider } from '../i18n/I18nProvider';
import { AppThemeProvider } from '../theme/AppThemeProvider';
import { nightPeriodKey } from '../theme/nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../theme/nightFeedStorage';
import { THEME_STORAGE_KEY } from '../theme/themeStorage';
import { fakeApi, networkError } from '../test/fakeApi';
import { fakeAuth } from '../test/fakeAuth';
import { useTestLocale } from '../test/locale';
import { LocationProbe } from '../test/LocationProbe';
import { testQueryClient } from '../test/renderApp';
import BoardPage from './BoardPage';
import {
  BOARD_NOW,
  boardItem,
  fakeBoardServer,
  NEW_SECRET,
  ROLE_ME,
  type FakeBoardOptions,
} from './boardTestKit';

const TASK = '11111111-0000-4000-8000-000000000001';

interface Setup extends FakeBoardOptions {
  route?: string;
}

function renderBoard({ route = '/hub/board', ...options }: Setup = {}) {
  const server = fakeBoardServer(options);
  const fake = fakeApi(server.handler);
  const queries: QueryClient = testQueryClient();
  const view = render(
    <I18nProvider>
      <AppThemeProvider>
        <AuthContext value={fakeAuth()}>
          <ApiClientContext value={fake.api}>
            <QueryClientProvider client={queries}>
              <MemoryRouter initialEntries={[route]}>
                <Routes>
                  <Route path="/hub/board/:itemId?" element={<BoardPage />} />
                  <Route path="/hub" element={<p>Hub page</p>} />
                </Routes>
                <LocationProbe />
              </MemoryRouter>
            </QueryClientProvider>
          </ApiClientContext>
        </AuthContext>
      </AppThemeProvider>
    </I18nProvider>,
  );
  return { server, fake, queries, view };
}

const location = () => screen.getByTestId('location').textContent ?? '';
const listCalls = (fake: ReturnType<typeof fakeApi>) =>
  fake.calls.filter((c) => c.method === 'GET' && c.path.startsWith('/api/v1/board/items?'));
const lastList = (fake: ReturnType<typeof fakeApi>) => listCalls(fake).at(-1)?.path ?? '';
const live = () => screen.getByTestId('board-live').textContent;

/** The board's list has loaded (its heading exists, even under an open dialog, and no skeleton). */
async function boardReady() {
  await screen.findByRole('heading', { name: /^(Items|Itens):/, level: 2, hidden: true });
  await waitFor(() => expect(screen.queryByTestId('board-skeleton')).toBeNull());
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
});

describe('access from GET /board/me', () => {
  it.each([
    ['without a board role (403)', 'forbidden'],
    ['while the board is disabled (404)', 'disabled'],
  ] as const)('says it is not available %s and lists nothing', async (_, access) => {
    const { fake } = renderBoard({ access });
    expect(
      await screen.findByText('The project board is not available for your account.'),
    ).toBeTruthy();
    expect(listCalls(fake)).toHaveLength(0);
    // The 401 login redirect is never triggered by the access question.
    expect(fake.calls[0].skipUnauthorizedHandler).toBe(true);
  });

  it('lets a reader read: no quick add, no writer or admin controls', async () => {
    renderBoard({ access: ROLE_ME.reader, route: `/hub/board/${TASK}` });
    await boardReady();
    const drawer = await screen.findByRole('dialog', { name: /Turn the board on/ });
    expect(screen.queryByRole('textbox', { name: 'New item', hidden: true })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: /^Status:/ })).toBeNull();
    expect(within(drawer).queryByRole('textbox', { name: 'Add a comment' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'API keys and topics', hidden: true })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Show deleted', hidden: true })).toBeNull();
  });

  it('gives a writer quick add and editing, but neither deleted items nor API keys', async () => {
    renderBoard({ access: ROLE_ME.writer, route: `/hub/board/${TASK}` });
    await boardReady();
    const drawer = await screen.findByRole('dialog', { name: /Turn the board on/ });
    expect(screen.getByRole('textbox', { name: 'New item', hidden: true })).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Status: Open' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'API keys and topics', hidden: true })).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Show deleted', hidden: true })).toBeNull();
  });

  it('gives an admin deleted items and the settings (API keys, topics)', async () => {
    const { fake } = renderBoard();
    await boardReady();
    fireEvent.click(screen.getByRole('switch', { name: 'Show deleted' }));
    await waitFor(() => expect(lastList(fake)).toContain('includeDeleted=true'));
    expect(location()).toContain('deleted=1');
    expect(screen.getByRole('button', { name: 'API keys and topics' })).toBeTruthy();
  });

  it('needs a connection: nothing is asked or shown offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { fake } = renderBoard();
    expect(await screen.findByText('Needs a connection')).toBeTruthy();
    expect(fake.calls).toHaveLength(0);
  });

  it('offers a retry when the access question fails', async () => {
    const server = fakeBoardServer();
    let fail = true;
    const fake = fakeApi((call) => {
      if (fail) throw networkError();
      return server.handler(call);
    });
    render(
      <I18nProvider>
        <AuthContext value={fakeAuth()}>
          <ApiClientContext value={fake.api}>
            <QueryClientProvider client={testQueryClient()}>
              <MemoryRouter initialEntries={['/hub/board']}>
                <Routes>
                  <Route path="/hub/board/:itemId?" element={<BoardPage />} />
                </Routes>
              </MemoryRouter>
            </QueryClientProvider>
          </ApiClientContext>
        </AuthContext>
      </I18nProvider>,
    );
    await screen.findByText(/Couldn't reach the project board/);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('radio', { name: 'Topics' })).toBeTruthy();
  });

  it('is not in the native app: back to the Hub', async () => {
    (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    const { fake } = renderBoard();
    expect(await screen.findByText('Hub page')).toBeTruthy();
    expect(fake.calls).toHaveLength(0);
  });
});

describe('views, filters and the URL', () => {
  it('lists the topics with their counts and open items', async () => {
    const { fake } = renderBoard();
    await boardReady();
    expect(lastList(fake)).toBe('/api/v1/board/items?open=true&sort=updated&limit=50');
    const infra = screen.getByRole('heading', { level: 2, name: /Infrastructure and deploy/ });
    expect(infra.textContent).toContain('Open 2');
    expect(screen.getByText('Turn the board on in the home lab')).toBeTruthy();
    // Done items are hidden by default.
    expect(screen.queryByText('Translate the install guide screenshots')).toBeNull();
    expect(screen.getByText('8 items')).toBeTruthy();
  });

  it('maps each view to its API query and writes it to the URL', async () => {
    const { fake } = renderBoard();
    await boardReady();
    const cases: [string, string, string][] = [
      ['Mine', 'view=mine', 'side=owner&open=true&sort=priority'],
      ['Claude', 'view=assistant', 'side=assistant&open=true&sort=priority'],
      ['Decisions', 'view=decisions', 'type=decision&sort=decided'],
      ['Gaps', 'view=gaps', 'type=gap&open=true&sort=priority'],
      ['Notes and memories', 'view=notes', 'type=note%2Cmemory&sort=updated'],
    ];
    for (const [name, url, api] of cases) {
      fireEvent.click(screen.getByRole('radio', { name }));
      await waitFor(() => expect(location()).toContain(url));
      await waitFor(() => expect(lastList(fake)).toContain(api));
    }
    // Notes and memories: the pinned memory first.
    await screen.findByText('Deploy order');
    const links = screen.getAllByRole('link').map((link) => link.textContent);
    expect(links.indexOf('Deploy order')).toBeLessThan(
      links.indexOf('Ideas for the summary strip'),
    );
  });

  it('shows decisions as a log with the rationale on demand and a link to the topic', async () => {
    renderBoard({ route: '/hub/board?view=decisions' });
    await boardReady();
    expect(screen.getByText('Board__Enabled is false until the owner turns it on.')).toBeTruthy();
    const toggle = screen.getAllByRole('button', { name: 'Rationale' })[0];
    const rationale = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(rationale.hidden).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(rationale.hidden).toBe(false);
    fireEvent.click(screen.getAllByRole('button', { name: 'Show the topic Process' })[0]);
    await waitFor(() => expect(location()).toBe('/hub/board?topic=process-meta'));
  });

  it('applies filters, the done toggle and the order, and keeps them in the URL', async () => {
    const { fake } = renderBoard();
    await boardReady();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Status' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Blocked' }));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    await waitFor(() => expect(location()).toContain('status=blocked'));
    await waitFor(() => expect(lastList(fake)).toContain('status=blocked&open=true'));
    expect(await screen.findByText('Store listing screenshots need the new icon')).toBeTruthy();

    fireEvent.click(screen.getByRole('switch', { name: 'Hide done and dropped' }));
    await waitFor(() => expect(location()).toContain('closed=show'));
    await waitFor(() => expect(lastList(fake)).not.toContain('open=true'));
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(location()).toBe('/hub/board?closed=show'));
  });

  it('reads the filters of a link', async () => {
    const { fake } = renderBoard({ route: '/hub/board?view=mine&priority=high&label=deploy' });
    await boardReady();
    expect(listCalls(fake)[0].path).toBe(
      '/api/v1/board/items?side=owner&priority=high&label=deploy&open=true&sort=priority&limit=50',
    );
    expect(screen.getByText('Turn the board on in the home lab')).toBeTruthy();
  });

  it('searches 300 ms after the last key, aborting nothing it still needs', async () => {
    const { fake } = renderBoard();
    await boardReady();
    const box = screen.getByRole('searchbox', { name: 'Search the board' });
    fireEvent.change(box, { target: { value: 'dep' } });
    fireEvent.change(box, { target: { value: 'deploy' } });
    expect(location()).toBe('/hub/board');
    await waitFor(() => expect(location()).toBe('/hub/board?q=deploy'));
    await waitFor(() => expect(lastList(fake)).toContain('q=deploy'));
    // Only the final text was asked for.
    expect(listCalls(fake).some((c) => c.path.includes('q=dep&'))).toBe(false);
  });

  it('loads the next page with the cursor', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      ...fakeBoardServer().items.get(TASK)!,
      id: `33333333-0000-4000-8000-${String(i).padStart(12, '0')}`,
      title: `Task ${i}`,
      updatedAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
    }));
    const { fake } = renderBoard({ items: many });
    await boardReady();
    expect(screen.getByText('50 items shown, more to load')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getByText('60 items')).toBeTruthy());
    expect(lastList(fake)).toContain('cursor=50');
  });
});

describe('the summary strip', () => {
  it('shows the totals and applies each one as a filter, pressed while applied', async () => {
    const { fake } = renderBoard();
    await boardReady();
    const owner = await screen.findByTestId('board-summary-waitingOnOwner');
    await waitFor(() => expect(owner.textContent).toContain('5'));
    expect(owner.textContent).toContain('Waiting on you');
    expect(screen.getByTestId('board-summary-blocked').textContent).toContain('1');
    expect(screen.getByTestId('board-summary-dueSoon').textContent).toContain('Due soon');

    fireEvent.click(screen.getByTestId('board-summary-waitingOnAssistant'));
    await waitFor(() => expect(location()).toBe('/hub/board?side=assistant%2Cboth'));
    await waitFor(() => expect(lastList(fake)).toContain('side=assistant%2Cboth&open=true'));
    expect(
      screen.getByTestId('board-summary-waitingOnAssistant').getAttribute('aria-pressed'),
    ).toBe('true');

    fireEvent.click(screen.getByTestId('board-summary-dueSoon'));
    await waitFor(() => expect(location()).toBe('/hub/board?due=soon&sort=due'));
    // Filters the due dates (today through the next 7 days, UTC) instead of only sorting.
    await waitFor(() => expect(lastList(fake)).toMatch(/dueAfter=\d{4}-\d{2}-\d{2}&dueBefore=/));
    expect(lastList(fake)).toContain('sort=due');
    expect(screen.getByTestId('board-summary-dueSoon').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByTestId('board-summary-dueSoon'));
    await waitFor(() => expect(location()).toBe('/hub/board'));
  });

  it('counts the items due soon from the summary', async () => {
    const day = (offset: number) =>
      new Date(BOARD_NOW + offset * 86_400_000).toISOString().slice(0, 10);
    renderBoard({
      items: [
        boardItem({ id: 'a', title: 'Due in two days', dueDate: day(2) }),
        boardItem({ id: 'b', title: 'Due in a week', dueDate: day(7) }),
        boardItem({ id: 'c', title: 'Due later', dueDate: day(8) }),
        boardItem({ id: 'd', title: 'Late', dueDate: day(-1) }),
      ],
    });
    await boardReady();
    await waitFor(() =>
      expect(screen.getByTestId('board-summary-dueSoon').textContent).toContain('2'),
    );
  });
});

describe('the item drawer', () => {
  it('opens from a row (an addressable route) and shows the fields, the body and the history', async () => {
    renderBoard();
    await boardReady();
    fireEvent.click(screen.getByText('Turn the board on in the home lab'));
    await waitFor(() => expect(location()).toBe(`/hub/board/${TASK}`));
    const drawer = await screen.findByRole('dialog', { name: /Turn the board on/ });
    await within(drawer).findByRole('heading', { name: 'Steps', level: 4 });
    expect(within(drawer).getByText('deploy')).toBeTruthy();
    expect(
      within(drawer)
        .getByRole('link', { name: /the guide/ })
        .getAttribute('href'),
    ).toBe('https://github.com/lotties-app/lotties.app');
    expect(within(drawer).getByText('Vini created it')).toBeTruthy();

    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(location()).toBe('/hub/board'));
  });

  it('saves an edit with the item version, and on a 412 asks to reload without overwriting', async () => {
    const { fake, server } = renderBoard({ route: `/hub/board/${TASK}` });
    await boardReady();
    const drawer = await screen.findByRole('dialog', { name: /Turn the board on/ });
    fireEvent.click(await within(drawer).findByRole('button', { name: 'Edit' }));
    fireEvent.change(within(drawer).getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Turn the board on' },
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(live()).toBe('Saved'));
    const patch = fake.calls.find((c) => c.method === 'PATCH')!;
    expect(patch.headers).toEqual({ 'If-Match': '"1"' });
    expect(patch.body).toEqual({ title: 'Turn the board on' });
    await within(drawer).findByRole('heading', { name: /Turn the board on$/, level: 2 });

    // Someone else changes it meanwhile: the stale write is refused.
    fireEvent.click(within(drawer).getByRole('button', { name: 'Edit' }));
    server.touch(TASK);
    fireEvent.change(within(drawer).getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Mine wins?' },
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save' }));
    const alert = await within(drawer).findByText(/Someone changed this item/);
    expect(alert).toBeTruthy();
    expect(server.items.get(TASK)!.title).toBe('Turn the board on (edited)');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Reload' }));
    await within(drawer).findByRole('heading', { name: /\(edited\)$/, level: 2 });
    expect(within(drawer).queryByText(/Someone changed this item/)).toBeNull();
    expect(within(drawer).queryByRole('textbox', { name: 'Title' })).toBeNull();
    await waitFor(() => expect(live()).toBe('Reloaded the latest version'));
  });

  it('changes the status in one tap from the menu', async () => {
    const { fake } = renderBoard({ route: `/hub/board/${TASK}` });
    await boardReady();
    const drawer = await screen.findByRole('dialog', { name: /Turn the board on/ });
    fireEvent.click(await within(drawer).findByRole('button', { name: 'Status: Open' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Done' }));
    await waitFor(() => expect(live()).toBe('Status changed to Done'));
    const patch = fake.calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body).toEqual({ status: 'done' });
    expect(patch.headers).toEqual({ 'If-Match': '"1"' });
  });

  it('adds a comment to the history', async () => {
    const { fake } = renderBoard({ route: `/hub/board/${TASK}` });
    await boardReady();
    const drawer = await screen.findByRole('dialog', { name: /Turn the board on/ });
    fireEvent.change(await within(drawer).findByRole('textbox', { name: 'Add a comment' }), {
      target: { value: 'Waiting for the backup first' },
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Comment' }));
    await waitFor(() => expect(live()).toBe('Comment added'));
    expect(fake.calls.find((c) => c.path.endsWith('/comments'))?.body).toEqual({
      comment: 'Waiting for the backup first',
    });
    expect(await within(drawer).findByText('Waiting for the backup first')).toBeTruthy();
    expect(within(drawer).getByText('Vini commented')).toBeTruthy();
  });

  it('soft deletes with Undo for an admin (restore)', async () => {
    const { fake, server } = renderBoard({ route: `/hub/board/${TASK}` });
    await boardReady();
    const drawer = await screen.findByRole('dialog', { name: /Turn the board on/ });
    fireEvent.click(await within(drawer).findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(location()).toBe('/hub/board'));
    expect(fake.calls.some((c) => c.method === 'DELETE' && c.path.endsWith(TASK))).toBe(true);
    expect(server.items.get(TASK)!.deletedAt).not.toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(server.items.get(TASK)!.deletedAt).toBeNull());
    expect(fake.calls.some((c) => c.path.endsWith(`${TASK}/restore`))).toBe(true);
    await waitFor(() => expect(live()).toBe('Item restored'));
  });

  it('asks a writer to confirm, since only an admin can restore', async () => {
    const { server } = renderBoard({ access: ROLE_ME.writer, route: `/hub/board/${TASK}` });
    await boardReady();
    const drawer = await screen.findByRole('dialog', { name: /Turn the board on/ });
    fireEvent.click(await within(drawer).findByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete this item?' });
    expect(server.items.get(TASK)!.deletedAt).toBeNull();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(server.items.get(TASK)!.deletedAt).not.toBeNull());
    expect(await screen.findByText('Deleted “Turn the board on in the home lab”')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});

describe('adding items', () => {
  it('adds with Enter in the view’s type and side, into the chosen topic', async () => {
    const { fake, server } = renderBoard({ route: '/hub/board?view=gaps' });
    await boardReady();
    const box = screen.getByRole('textbox', { name: 'New item' });
    fireEvent.change(box, { target: { value: 'Seed script has no dry run' } });
    fireEvent.submit(box.closest('form')!);
    await waitFor(() => expect(live()).toBe('Added “Seed script has no dry run”'));
    const post = fake.calls.find((c) => c.method === 'POST' && c.path === '/api/v1/board/items')!;
    expect(post.body).toMatchObject({
      title: 'Seed script has no dry run',
      type: 'gap',
      side: 'both',
      topic: 'product',
    });
    expect((post.body as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/);
    expect([...server.items.values()].some((i) => i.title === 'Seed script has no dry run')).toBe(
      true,
    );
    expect((box as HTMLInputElement).value).toBe('');
  });

  it('opens the full form with what was typed and creates the item', async () => {
    const { fake } = renderBoard({ route: '/hub/board?view=notes' });
    await boardReady();
    fireEvent.change(screen.getByRole('textbox', { name: 'New item' }), {
      target: { value: 'Release checklist' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'More fields' }));
    const dialog = await screen.findByRole('dialog', { name: 'New item' });
    expect((within(dialog).getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe(
      'Release checklist',
    );
    fireEvent.click(within(dialog).getByRole('switch', { name: /Pinned/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add item' }));
    await waitFor(() => expect(location()).toMatch(/^\/hub\/board\/[0-9a-f-]{36}\?view=notes$/));
    const post = fake.calls.find((c) => c.method === 'POST' && c.path === '/api/v1/board/items')!;
    expect(post.body).toMatchObject({ title: 'Release checklist', type: 'note', pinned: true });
  });
});

describe('API keys (admins)', () => {
  it('lists keys with their prefix, scope, state, topics, expiry and last use', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(BOARD_NOW);
    renderBoard({ route: '/hub/board?panel=keys' });
    const dialog = await screen.findByRole('dialog', { name: 'Board settings' });
    expect(await within(dialog).findByText('Claude Code (dev machine)')).toBeTruthy();
    expect(within(dialog).getByText('lbk_AbCdEfGh…')).toBeTruthy();
    expect(within(dialog).getAllByText('Read and write').length).toBeGreaterThanOrEqual(2);
    expect(within(dialog).getAllByText('Revoked')).toHaveLength(2);
    expect(within(dialog).getByText('Active')).toBeTruthy();
    expect(within(dialog).getByText('All topics')).toBeTruthy();
    expect(within(dialog).getByText('Process')).toBeTruthy();
    expect(within(dialog).getByText('20 minutes ago · used in 42 different minutes')).toBeTruthy();
    // How to use: the curl line and the Claude Code MCP line (when enabled), never a secret.
    const commands = [...dialog.querySelectorAll('pre code')].map((code) => code.textContent);
    expect(commands[0]).toMatch(
      /^curl -s .*\/api\/v1\/board\/summary -H "X-Board-Key: \$LOTTIES_BOARD_KEY"$/,
    );
    expect(commands[1]).toMatch(
      /^claude mcp add --transport http lotties-board https?:\/\/.+\/api\/v1\/board\/mcp --header "Authorization: Bearer <key>"$/,
    );
    expect(within(dialog).getByText(/docs\/KEYCLOAK-BOARD\.md/)).toBeTruthy();
  });

  it('shows a new key’s secret once, then forgets it', async () => {
    const { fake, queries } = renderBoard({ route: '/hub/board?panel=keys' });
    const dialog = await screen.findByRole('dialog', { name: 'Board settings' });
    await within(dialog).findByText('Claude Code (dev machine)');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Seed script' },
    });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Read and write' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));

    const secretDialog = await screen.findByRole('dialog', { name: 'Your new key: Seed script' });
    expect(within(secretDialog).getByText(/You will not see it again/)).toBeTruthy();
    expect(
      (within(secretDialog).getByTestId('board-key-secret') as HTMLTextAreaElement).value,
    ).toBe(NEW_SECRET);
    expect(fake.calls.find((c) => c.method === 'POST' && c.path.endsWith('/keys'))?.body).toEqual({
      name: 'Seed script',
      scope: 'write',
    });
    // Escape does not dismiss it by accident.
    fireEvent.keyDown(secretDialog, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Your new key: Seed script' })).toBeTruthy();

    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(within(secretDialog).getByRole('button', { name: 'Copy' }));
    await within(secretDialog).findByText('Copied');
    expect(writeText).toHaveBeenCalledWith(NEW_SECRET);

    fireEvent.click(within(secretDialog).getByRole('button', { name: 'Done, I stored it' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Your new key: Seed script' })).toBeNull(),
    );
    expect(document.body.innerHTML).not.toContain(NEW_SECRET);
    // Not kept in any query or mutation cache either.
    const cached = JSON.stringify([
      queries
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
      queries
        .getMutationCache()
        .getAll()
        .map((mutation) => mutation.state.data),
    ]);
    expect(cached).not.toContain(NEW_SECRET);
    // The list shows the new key by its prefix only.
    expect(await within(dialog).findByText('Seed script')).toBeTruthy();
    expect(within(dialog).getByText(`${NEW_SECRET.slice(0, 12)}…`)).toBeTruthy();
  });

  it('revokes a key after a confirmation', async () => {
    const { fake } = renderBoard({ route: '/hub/board?panel=keys' });
    const dialog = await screen.findByRole('dialog', { name: 'Board settings' });
    fireEvent.click(
      await within(dialog).findByRole('button', { name: 'Revoke Claude Code (dev machine)' }),
    );
    const confirm = await screen.findByRole('dialog', { name: 'Revoke this key?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(fake.calls.some((c) => c.method === 'DELETE' && c.path.includes('/keys/'))).toBe(true),
    );
    await waitFor(() => expect(within(dialog).getAllByText('Revoked')).toHaveLength(4));
    await waitFor(() => expect(live()).toBe('Revoked “Claude Code (dev machine)”'));
  });

  it('is not offered to a writer even with the panel in the URL', async () => {
    renderBoard({ access: ROLE_ME.writer, route: '/hub/board?panel=keys' });
    await boardReady();
    expect(screen.queryByRole('dialog', { name: 'Board settings' })).toBeNull();
  });
});

describe('keyboard', () => {
  it('moves between rows with j and k, and / goes to the search', async () => {
    renderBoard();
    await boardReady();
    const rows = [...document.querySelectorAll<HTMLElement>('[data-board-row]')];
    act(() => {
      fireEvent.keyDown(document.body, { key: 'j' });
    });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0], { key: 'j' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(rows[1], { key: 'k' });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(rows[0], { key: '/' });
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
    // Typing in a field never triggers a shortcut.
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'j' });
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  });
});

describe('in Portuguese', () => {
  it('names the views, the summary and the controls', async () => {
    await useTestLocale('pt-BR');
    renderBoard();
    await boardReady();
    expect(screen.getByRole('radio', { name: 'Temas' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Notas e memórias' })).toBeTruthy();
    expect(screen.getByTestId('board-summary-waitingOnOwner').textContent).toContain(
      'Aguardando você',
    );
    expect(screen.getByRole('textbox', { name: 'Novo item' })).toBeTruthy();
    expect(screen.getByTestId('board-summary-dueSoon').textContent).toContain('Vencem em breve');
  });

  it('writes the quick-add caption with the article and lower-case words', async () => {
    await useTestLocale('pt-BR');
    renderBoard({ route: '/hub/board?view=gaps' });
    await boardReady();
    expect(
      screen.getByText('Adiciona uma lacuna para ambos. Abra Mais campos para o resto.'),
    ).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Novo item' }).getAttribute('placeholder')).toBe(
      'Adicione uma lacuna e tecle Enter',
    );
  });
});

describe('the quick-add caption', () => {
  it('names the type and the side in lower case, in a sentence', async () => {
    renderBoard();
    await boardReady();
    expect(screen.getByText('Adds a task for both. Open More fields for the rest.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'New item' }).getAttribute('placeholder')).toBe(
      'Add a task, press Enter',
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Mine' }));
    await waitFor(() =>
      expect(
        screen.getByText('Adds a task for the owner. Open More fields for the rest.'),
      ).toBeTruthy(),
    );
  });
});

function chooseScheme(scheme: 'light' | 'dark' | 'night') {
  if (scheme === 'night') {
    window.localStorage.setItem(
      NIGHT_FEED_STATE_STORAGE_KEY,
      JSON.stringify({ override: { on: true, key: nightPeriodKey(new Date()) } }),
    );
  } else {
    window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
  }
}

async function axeViolations() {
  const result = await axe.run(document.body, {
    runOnly: ['wcag2a', 'wcag2aa'],
    rules: { 'color-contrast': { enabled: false } }, // checked by tokens.test.ts
  });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' | ')}`);
}

describe.each(['light', 'dark', 'night'] as const)('accessibility in the %s scheme', (scheme) => {
  it.each(['en', 'pt-BR'] as const)('has no violations in %s (list and drawer)', async (locale) => {
    chooseScheme(scheme);
    if (locale === 'pt-BR') await useTestLocale('pt-BR');
    const { view } = renderBoard();
    await boardReady();
    expect(await axeViolations()).toEqual([]);
    view.unmount();
    renderBoard({ route: `/hub/board/${TASK}` });
    await boardReady();
    await screen.findByRole('dialog');
    await screen.findAllByText('Vini', { exact: false });
    expect(await axeViolations()).toEqual([]);
  });

  it('has no violations in the API keys panel', async () => {
    chooseScheme(scheme);
    renderBoard({ route: '/hub/board?panel=keys' });
    const dialog = await screen.findByRole('dialog', { name: 'Board settings' });
    await within(dialog).findByText('Claude Code (dev machine)');
    expect(await axeViolations()).toEqual([]);
  });
});
