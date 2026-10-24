import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Skeleton,
  Snackbar,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useApiClient } from '../api/ApiClientContext';
import { describeApiError } from '../api/errorMessages';
import { visuallyHidden } from '../insights/charts/chartStyle';
import { AdminDialog } from './AdminDialog';
import { deleteItem, restoreItem, type BoardItem, type BoardMe } from './boardApi';
import { useBoardItems, useBoardRefresh, useBoardSummary, useBoardTopics } from './boardData';
import { boardErrorOverrides } from './boardErrors';
import { BoardFilterBar } from './BoardFilterBar';
import { BoardSearch, QuickAdd } from './BoardHeader';
import {
  activeFilterCount,
  ADMIN_PANELS,
  DEFAULT_FILTERS,
  type AdminPanel,
  listQuery,
  parseFilters,
  quickAddDefaults,
  writeFilters,
  type BoardFilters,
  type BoardView,
} from './boardQuery';
import {
  DecisionsView,
  GapsView,
  NotesView,
  SideView,
  TopicsView,
  type ViewProps,
} from './BoardViews';
import { CreateItemDialog } from './CreateItemDialog';
import { ItemDrawer } from './ItemDrawer';
import { emptyForm, type ItemFormState } from './itemFormModel';
import { focusRow, isTypingTarget } from './keyboard';
import { SummaryStrip } from './SummaryStrip';
import { useBoardLinks } from './useBoardLinks';

const VIEW_COMPONENTS: Record<BoardView, (props: ViewProps) => React.ReactNode> = {
  topics: TopicsView,
  mine: SideView,
  assistant: SideView,
  decisions: DecisionsView,
  gaps: GapsView,
  notes: NotesView,
};

/** The polite live region of the page: saves, comments, deletions are read aloud. */
function useAnnouncer() {
  const [message, setMessage] = useState<{ text: string; n: number }>({ text: '', n: 0 });
  const announce = useCallback(
    (text: string) => setMessage((current) => ({ text, n: current.n + 1 })),
    [],
  );
  const region = (
    <Box role="status" aria-live="polite" sx={visuallyHidden} data-testid="board-live">
      <span key={message.n}>{message.text}</span>
    </Box>
  );
  return { announce, region };
}

interface Props {
  me: BoardMe;
}

/**
 * The project board (docs/design/36-project-board.md section 10): summary strip, search, quick
 * add, views and filters (all in the URL), the list, and the item drawer beside it (wide screens)
 * or over it (phones). Controls follow `GET /board/me`: readers read, writers edit, admins also
 * restore, see deleted items and manage topics and API keys.
 */
export function BoardScreen({ me }: Props) {
  const { t } = useTranslation();
  const api = useApiClient();
  const theme = useTheme();
  const wide = useMediaQuery(theme.breakpoints.up('md'));
  const navigate = useNavigate();
  const links = useBoardLinks();
  const { itemId } = useParams();
  const [params, setParams] = useSearchParams();
  const filters = parseFilters(params);
  const refresh = useBoardRefresh();
  const { announce, region } = useAnnouncer();
  const [now] = useState(() => Date.now());
  const [lastTopic, setLastTopic] = useState<string | null>(null);
  const [creating, setCreating] = useState<ItemFormState | null>(null);
  const [deleted, setDeleted] = useState<BoardItem | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const topicsQuery = useBoardTopics(true);
  const topics = topicsQuery.data ?? [];
  const summary = useBoardSummary();
  const items = useBoardItems(listQuery(filters, me.canAdmin));
  const loaded = items.data?.pages.flatMap((page) => page.items) ?? [];
  const requestedPanel = params.get('panel');
  const panel = me.canAdmin ? (ADMIN_PANELS.find((name) => name === requestedPanel) ?? null) : null;

  const setFilters = (next: BoardFilters) =>
    setParams(writeFilters(next, params), { replace: false });
  const setPanel = (next: AdminPanel | null) => {
    const copy = new URLSearchParams(params);
    if (next) copy.set('panel', next);
    else copy.delete('panel');
    setParams(copy);
  };
  const defaults = quickAddDefaults(filters, topics, lastTopic);

  const closeDrawer = () => {
    const id = itemId;
    navigate(links.list());
    if (id && wide) {
      window.requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`[data-board-row="${CSS.escape(id)}"]`)?.focus(),
      );
    }
  };

  const remove = async (item: BoardItem) => {
    setFailure(null);
    try {
      await deleteItem(api, item.id);
      navigate(links.list());
      refresh.lists(item.id);
      announce(t('board.drawer.deleted', { title: item.title }));
      setDeleted(item);
    } catch (error) {
      setFailure(describeApiError(error, boardErrorOverrides()));
    }
  };

  const undoDelete = async (item: BoardItem) => {
    setDeleted(null);
    try {
      await restoreItem(api, item.id);
      refresh.lists(item.id);
      announce(t('board.drawer.restored'));
    } catch (error) {
      setFailure(describeApiError(error, boardErrorOverrides()));
    }
  };

  // Desktop keys: j/k move between rows, / searches, c adds (never while typing or in a dialog).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"]')) return;
      const focus = (id: string) => document.getElementById(id)?.focus();
      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault();
        focusRow(event.key === 'j' ? 1 : -1);
      } else if (event.key === '/') {
        event.preventDefault();
        focus('board-search');
      } else if (event.key === 'c' && me.canWrite) {
        event.preventDefault();
        focus('board-quick-add');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [me.canWrite]);

  const View = VIEW_COMPONENTS[filters.view];
  const filtered = activeFilterCount(filters) > 0 || !!filters.q.trim();

  let list: React.ReactNode;
  if (items.isPending) {
    list = (
      <Stack spacing={1} aria-busy="true" data-testid="board-skeleton">
        {[0, 1, 2, 3].map((n) => (
          <Skeleton key={n} variant="rounded" height={56} />
        ))}
      </Stack>
    );
  } else if (items.isError) {
    list = (
      <Alert
        severity="error"
        action={
          <Button color="inherit" onClick={() => void items.refetch()} sx={{ minHeight: 44 }}>
            {t('board.retry')}
          </Button>
        }
      >
        {describeApiError(items.error, boardErrorOverrides())}
      </Alert>
    );
  } else if (loaded.length === 0) {
    list = (
      <Stack spacing={1} sx={{ py: 3, alignItems: 'flex-start' }}>
        <Typography>{filtered ? t('board.list.noMatch') : t('board.list.empty')}</Typography>
        {filtered ? (
          <Button
            onClick={() => setFilters({ ...DEFAULT_FILTERS, view: filters.view })}
            sx={{ minHeight: 44 }}
          >
            {t('board.filters.clear')}
          </Button>
        ) : (
          me.canWrite && (
            <Typography color="text.secondary">{t('board.list.emptyWriter')}</Typography>
          )
        )}
      </Stack>
    );
  } else {
    list = (
      <>
        <View
          items={loaded}
          topics={topics}
          counts={summary.data?.counts ?? []}
          filters={filters}
          selectedId={itemId}
          now={now}
          onTopic={(key) => setFilters({ ...DEFAULT_FILTERS, topic: [key] })}
        />
        {items.hasNextPage && (
          <Button
            variant="outlined"
            onClick={() => void items.fetchNextPage()}
            disabled={items.isFetchingNextPage}
            sx={{ mt: 2, minHeight: 44, alignSelf: 'center' }}
          >
            {items.isFetchingNextPage ? t('board.list.loadingMore') : t('board.list.loadMore')}
          </Button>
        )}
      </>
    );
  }

  return (
    <Stack spacing={2.5}>
      {region}
      {me.canAdmin && (
        <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: -1 }}>
          <Button onClick={() => setPanel('keys')} aria-haspopup="dialog" sx={{ minHeight: 44 }}>
            {t('board.admin.open')}
          </Button>
        </Stack>
      )}
      <SummaryStrip totals={summary.data?.totals} filters={filters} onApply={setFilters} />
      <BoardSearch q={filters.q} onSearch={(q) => setFilters({ ...filters, q })} />
      {me.canWrite && (
        <QuickAdd
          defaults={defaults}
          topics={topics}
          onTopic={setLastTopic}
          onAdded={(title) => {
            refresh.lists();
            announce(t('board.quickAdd.added', { title }));
          }}
          onMore={(title) =>
            setCreating(
              emptyForm({
                title,
                type: defaults.type,
                side: defaults.side,
                topic: defaults.topic ?? '',
              }),
            )
          }
        />
      )}
      <BoardFilterBar
        filters={filters}
        topics={topics}
        canAdmin={me.canAdmin}
        onChange={setFilters}
      />
      {failure && (
        <Alert severity="error" role="alert" onClose={() => setFailure(null)}>
          {failure}
        </Alert>
      )}
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          alignItems: 'start',
          gridTemplateColumns:
            wide && itemId ? 'minmax(0, 1fr) minmax(360px, 440px)' : 'minmax(0, 1fr)',
        }}
      >
        <Box
          component="section"
          aria-labelledby="board-list-title"
          sx={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}
        >
          <Typography component="h2" id="board-list-title" sx={visuallyHidden}>
            {t('board.list.title', { view: t(`board.views.${filters.view}`) })}
          </Typography>
          {!items.isPending && !items.isError && loaded.length > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {items.hasNextPage
                ? t('board.list.countMore', { count: loaded.length })
                : t('board.list.count', { count: loaded.length })}
            </Typography>
          )}
          {list}
        </Box>
        {itemId && (
          <ItemDrawer
            key={itemId}
            itemId={itemId}
            me={me}
            topics={topics}
            inline={wide}
            onClose={closeDrawer}
            announce={announce}
            onDelete={(item) => void remove(item)}
          />
        )}
      </Box>

      {creating && (
        <CreateItemDialog
          initial={creating}
          topics={topics}
          onClose={() => setCreating(null)}
          onCreated={(item) => {
            setCreating(null);
            setLastTopic(item.topic);
            refresh.lists();
            announce(t('board.quickAdd.added', { title: item.title }));
            navigate(links.item(item.id));
          }}
        />
      )}

      {panel && (
        <AdminDialog
          panel={panel}
          onPanel={setPanel}
          onClose={() => setPanel(null)}
          topics={topics}
          announce={announce}
          now={now}
        />
      )}

      <Snackbar
        open={!!deleted}
        autoHideDuration={8000}
        onClose={(_, reason) => reason !== 'clickaway' && setDeleted(null)}
        message={deleted ? t('board.drawer.deleted', { title: deleted.title }) : ''}
        action={
          deleted && me.canAdmin ? (
            <Button color="inherit" onClick={() => void undoDelete(deleted)} sx={{ minHeight: 44 }}>
              {t('board.drawer.undo')}
            </Button>
          ) : undefined
        }
      />
    </Stack>
  );
}
