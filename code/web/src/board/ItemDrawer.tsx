import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  IconButton,
  Menu,
  MenuItem,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useApiClient } from '../api/ApiClientContext';
import { ApiError } from '../api/ApiError';
import { describeApiError } from '../api/errorMessages';
import { formatDate, formatDateTime } from '../i18n/format';
import { visuallyHidden } from '../insights/charts/chartStyle';
import { Icon } from '../ui/Icon';
import {
  addComment,
  BOARD_STATUSES,
  isVersionConflict,
  patchItem,
  restoreItem,
  type BoardItem,
  type BoardItemPatch,
  type BoardMe,
  type BoardStatus,
  type BoardTopic,
} from './boardApi';
import { useBoardItem, useBoardRefresh } from './boardData';
import { STATUS_COLORS, TYPE_ICONS } from './boardLook';
import { boardErrorOverrides } from './boardErrors';
import { ItemForm } from './ItemForm';
import {
  formOf,
  patchBody,
  validateForm,
  type FormErrors,
  type ItemFormState,
} from './itemFormModel';
import { ItemHistory } from './ItemHistory';
import { MarkdownView } from './MarkdownView';
import { safeHref } from './markdown';
import { isTypingTarget } from './keyboard';

interface DrawerProps {
  itemId: string;
  me: BoardMe;
  topics: readonly BoardTopic[];
  /** Inline panel beside the list (wide screens) or a full-screen dialog (phones). */
  inline: boolean;
  onClose: () => void;
  /** Says something in the page's polite live region. */
  announce: (message: string) => void;
  /** A writer deleted the item: the page closes the drawer and offers Undo. */
  onDelete: (item: BoardItem) => void;
}

/**
 * The item drawer (route `/hub/board/<id>`): every field, the Markdown body, the history and a
 * comment box; writers edit (with the item's version, so a concurrent change is a 412 and a
 * reload, never an overwrite), change the status in one tap and delete; admins restore.
 */
export function ItemDrawer({ inline, onClose, ...props }: DrawerProps) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The inline panel takes focus when an item opens in it (the dialog moves focus by itself).
  useEffect(() => {
    if (inline) headingRef.current?.focus();
  }, [inline, props.itemId]);

  const body = (
    <ItemDetail {...props} titleId={titleId} headingRef={headingRef} onClose={onClose} />
  );
  if (!inline) {
    return (
      <Dialog open fullScreen onClose={onClose} aria-labelledby={titleId} scroll="paper">
        <Box sx={{ p: 2, pt: 'max(16px, env(safe-area-inset-top))', overflowY: 'auto' }}>
          {body}
        </Box>
      </Dialog>
    );
  }
  return (
    <Box
      component="section"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      sx={{
        position: 'sticky',
        top: 8,
        maxHeight: 'calc(100dvh - 16px)',
        overflowY: 'auto',
        p: 2,
        borderRadius: '20px',
        bgcolor: 'background.paper',
        boxShadow: (theme) => (theme.vars ?? theme).palette.cardShadow,
      }}
    >
      {body}
    </Box>
  );
}

interface DetailProps extends Omit<DrawerProps, 'inline'> {
  titleId: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <Typography component="dt" variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </>
  );
}

function ItemDetail({
  itemId,
  me,
  topics,
  onClose,
  announce,
  onDelete,
  titleId,
  headingRef,
}: DetailProps) {
  const { t } = useTranslation();
  const api = useApiClient();
  const refresh = useBoardRefresh();
  const detail = useBoardItem(itemId);
  const [editing, setEditing] = useState<ItemFormState | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverField, setServerField] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [statusAnchor, setStatusAnchor] = useState<HTMLElement | null>(null);
  const [comment, setComment] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const item = detail.data?.item;
  const canEdit = me.canWrite && !!item && !item.deletedAt;

  // `e` edits the open item (desktop keyboard; never while typing).
  useEffect(() => {
    if (!canEdit || editing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'e' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      if (item) setEditing(formOf(item));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [canEdit, editing, item]);

  const fail = (error: unknown) => {
    if (isVersionConflict(error)) {
      setConflict(true);
      setFailure(null);
      return;
    }
    setServerField(error instanceof ApiError ? (error.problem?.field ?? null) : null);
    setFailure(describeApiError(error, boardErrorOverrides()));
  };

  const write = async (patch: BoardItemPatch, done: string) => {
    if (!item) return;
    setBusy(true);
    setFailure(null);
    try {
      await patchItem(api, item.id, item.version, patch);
      setEditing(null);
      refresh.lists(item.id);
      announce(done);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!item || !editing) return;
    const found = validateForm(editing);
    setErrors(found);
    setServerField(null);
    if (Object.keys(found).length > 0) return;
    const patch = patchBody(editing, item);
    if (Object.keys(patch).length === 0) {
      setEditing(null);
      return;
    }
    await write(patch, t('board.drawer.saved'));
  };

  const reload = async () => {
    setConflict(false);
    setEditing(null);
    setFailure(null);
    await detail.refetch();
    refresh.lists();
    announce(t('board.drawer.reloaded'));
  };

  const sendComment = async () => {
    if (!item || !comment.trim()) return;
    setBusy(true);
    setFailure(null);
    try {
      await addComment(api, item.id, comment.trim());
      setComment('');
      await refresh.item(item.id);
      refresh.lists();
      announce(t('board.drawer.commented'));
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!item) return;
    setBusy(true);
    try {
      await restoreItem(api, item.id);
      refresh.lists(item.id);
      announce(t('board.drawer.restored'));
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!item) return;
    // Only an admin can restore: a writer without the role confirms first instead of an Undo.
    if (me.canAdmin) onDelete(item);
    else setConfirmDelete(true);
  };

  const closeButton = (
    <IconButton
      aria-label={t('board.drawer.close')}
      onClick={onClose}
      sx={{ width: 44, height: 44, flexShrink: 0 }}
    >
      <Icon name="close" size={20} />
    </IconButton>
  );

  if (detail.isPending) {
    return (
      <Stack spacing={1.5} aria-busy="true">
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography
            component="h2"
            variant="h6"
            id={titleId}
            ref={headingRef}
            tabIndex={-1}
            sx={{ outline: 'none' }}
          >
            {t('board.drawer.loading')}
          </Typography>
          {closeButton}
        </Stack>
        <Skeleton variant="rounded" height={28} />
        <Skeleton variant="rounded" height={96} />
        <Skeleton variant="rounded" height={160} />
      </Stack>
    );
  }

  if (!item) {
    const missing = detail.error instanceof ApiError && detail.error.status === 404;
    return (
      <Stack spacing={1.5}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography
            component="h2"
            variant="h6"
            id={titleId}
            ref={headingRef}
            tabIndex={-1}
            sx={{ outline: 'none' }}
          >
            {t('board.drawer.unavailableTitle')}
          </Typography>
          {closeButton}
        </Stack>
        <Alert severity={missing ? 'info' : 'error'}>
          {missing
            ? t('board.drawer.notFound')
            : describeApiError(detail.error, boardErrorOverrides())}
        </Alert>
        {!missing && (
          <Button
            onClick={() => void detail.refetch()}
            sx={{ alignSelf: 'flex-start', minHeight: 44 }}
          >
            {t('board.retry')}
          </Button>
        )}
      </Stack>
    );
  }

  const topicName = topics.find((topic) => topic.key === item.topic)?.name ?? item.topic;
  const history = detail.data?.history ?? [];

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ pt: '6px', color: 'text.secondary', display: 'flex' }}>
          <Icon name={TYPE_ICONS[item.type]} size={24} />
        </Box>
        <Typography
          component="h2"
          variant="h6"
          id={titleId}
          ref={headingRef}
          tabIndex={-1}
          sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', outline: 'none' }}
        >
          <Box component="span" sx={visuallyHidden}>
            {`${t(`board.types.${item.type}`)}: `}
          </Box>
          {item.title}
        </Typography>
        {closeButton}
      </Stack>

      {item.deletedAt && (
        <Alert
          severity="warning"
          action={
            me.canAdmin ? (
              <Button color="inherit" onClick={() => void restore()} disabled={busy}>
                {t('board.drawer.restore')}
              </Button>
            ) : undefined
          }
        >
          {t('board.drawer.deletedAt', { date: formatDateTime(item.deletedAt) })}
        </Alert>
      )}

      {conflict && (
        <Alert
          severity="warning"
          role="alert"
          action={
            <Button color="inherit" onClick={() => void reload()} sx={{ minHeight: 44 }}>
              {t('board.drawer.reload')}
            </Button>
          }
        >
          {t('board.drawer.conflict')}
        </Alert>
      )}
      {failure && (
        <Alert severity="error" role="alert">
          {failure}
        </Alert>
      )}

      {canEdit && !editing && (
        <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button
            variant="outlined"
            onClick={(e) => setStatusAnchor(e.currentTarget)}
            aria-haspopup="menu"
            aria-expanded={!!statusAnchor}
            endIcon={<Icon name="expand" size={20} />}
            disabled={busy || conflict}
            sx={{ minHeight: 44 }}
          >
            {t('board.drawer.statusButton', { status: t(`board.statuses.${item.status}`) })}
          </Button>
          <Menu anchorEl={statusAnchor} open={!!statusAnchor} onClose={() => setStatusAnchor(null)}>
            {BOARD_STATUSES.map((status: BoardStatus) => (
              <MenuItem
                key={status}
                selected={status === item.status}
                sx={{ minHeight: 44 }}
                onClick={() => {
                  setStatusAnchor(null);
                  if (status !== item.status) {
                    void write(
                      { status },
                      t('board.drawer.statusChanged', { status: t(`board.statuses.${status}`) }),
                    );
                  }
                }}
              >
                {t(`board.statuses.${status}`)}
              </MenuItem>
            ))}
          </Menu>
          <Button
            variant="outlined"
            startIcon={<Icon name="edit" size={20} />}
            onClick={() => setEditing(formOf(item))}
            disabled={busy || conflict}
            sx={{ minHeight: 44 }}
          >
            {t('board.drawer.edit')}
          </Button>
          <Button
            color="error"
            startIcon={<Icon name="delete" size={20} />}
            onClick={remove}
            disabled={busy}
            sx={{ minHeight: 44 }}
          >
            {t('board.drawer.delete')}
          </Button>
        </Stack>
      )}

      {editing ? (
        <Box
          component="form"
          noValidate
          aria-label={t('board.drawer.editLabel')}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <ItemForm
            value={editing}
            onChange={setEditing}
            topics={topics}
            errors={errors}
            serverField={serverField}
          />
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button
              type="submit"
              variant="contained"
              disabled={busy || conflict}
              sx={{ minHeight: 44 }}
            >
              {t('board.drawer.save')}
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setErrors({});
                setFailure(null);
              }}
              sx={{ minHeight: 44 }}
            >
              {t('board.drawer.cancel')}
            </Button>
          </Stack>
        </Box>
      ) : (
        <>
          <Box
            component="dl"
            sx={{
              m: 0,
              display: 'grid',
              gridTemplateColumns: 'minmax(96px, auto) minmax(0, 1fr)',
              columnGap: 2,
              rowGap: 1,
              alignItems: 'baseline',
            }}
          >
            <Meta label={t('board.fields.type')}>{t(`board.types.${item.type}`)}</Meta>
            <Meta label={t('board.fields.topic')}>{topicName}</Meta>
            <Meta label={t('board.fields.status')}>
              <Chip
                component="span"
                size="small"
                color={STATUS_COLORS[item.status]}
                label={t(`board.statuses.${item.status}`)}
              />
            </Meta>
            <Meta label={t('board.fields.side')}>{t(`board.sides.${item.side}`)}</Meta>
            <Meta label={t('board.fields.priority')}>{t(`board.priorities.${item.priority}`)}</Meta>
            {item.dueDate && (
              <Meta label={t('board.fields.dueDate')}>{formatDate(item.dueDate)}</Meta>
            )}
            {item.labels.length > 0 && (
              <Meta label={t('board.fields.labels')}>
                <Box component="span" sx={{ display: 'inline-flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {item.labels.map((label) => (
                    <Chip
                      key={label}
                      component="span"
                      size="small"
                      variant="outlined"
                      label={label}
                    />
                  ))}
                </Box>
              </Meta>
            )}
            {(item.type === 'note' || item.type === 'memory') && (
              <Meta label={t('board.fields.pinned')}>
                {item.pinned ? t('board.drawer.yes') : t('board.drawer.no')}
              </Meta>
            )}
            {item.source && <Meta label={t('board.fields.source')}>{item.source}</Meta>}
            <Meta label={t('board.drawer.created')}>
              {t('board.drawer.byOn', {
                name:
                  item.createdBy.kind === 'api_key'
                    ? t('board.history.keyActor', { name: item.createdBy.name })
                    : item.createdBy.name,
                date: formatDateTime(item.createdAt),
              })}
            </Meta>
            <Meta label={t('board.drawer.updated')}>{formatDateTime(item.updatedAt)}</Meta>
            {item.closedAt && (
              <Meta label={t('board.drawer.closed')}>{formatDateTime(item.closedAt)}</Meta>
            )}
          </Box>

          {item.decision && (item.decision.summary || item.decision.rationale) && (
            <Box component="section" aria-labelledby={`${titleId}-decision`}>
              <Typography component="h3" variant="subtitle1" id={`${titleId}-decision`}>
                {t('board.drawer.decision')}
              </Typography>
              {item.decision.summary && (
                <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {item.decision.summary}
                </Typography>
              )}
              {item.decision.rationale && (
                <Typography
                  color="text.secondary"
                  sx={{ mt: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                >
                  {item.decision.rationale}
                </Typography>
              )}
              {item.decision.decidedAt && (
                <Typography variant="caption" color="text.secondary">
                  {t('board.drawer.decidedAt', { date: formatDateTime(item.decision.decidedAt) })}
                </Typography>
              )}
            </Box>
          )}

          {item.links.length > 0 && (
            <Box component="section" aria-labelledby={`${titleId}-links`}>
              <Typography component="h3" variant="subtitle1" id={`${titleId}-links`}>
                {t('board.fields.links')}
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {item.links.map((link, index) => (
                  <li key={`${link.url}-${index}`}>
                    <SafeLink href={link.url}>{link.label}</SafeLink>
                  </li>
                ))}
              </Box>
            </Box>
          )}

          <Box component="section" aria-labelledby={`${titleId}-body`}>
            <Typography component="h3" variant="subtitle1" id={`${titleId}-body`}>
              {t('board.fields.body')}
            </Typography>
            {item.body?.trim() ? (
              <MarkdownView source={item.body} />
            ) : (
              <Typography color="text.secondary">{t('board.drawer.noBody')}</Typography>
            )}
          </Box>
        </>
      )}

      <Box component="section" aria-labelledby={`${titleId}-history`}>
        <Typography component="h3" variant="subtitle1" id={`${titleId}-history`} sx={{ mb: 1 }}>
          {t('board.drawer.history')}
        </Typography>
        <ItemHistory history={history} />
      </Box>

      {canEdit && !editing && (
        <Box
          component="form"
          aria-label={t('board.drawer.commentLabel')}
          onSubmit={(e) => {
            e.preventDefault();
            void sendComment();
          }}
        >
          <TextField
            label={t('board.drawer.commentLabel')}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            multiline
            minRows={2}
            fullWidth
            slotProps={{ htmlInput: { maxLength: 4000 } }}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={busy || !comment.trim()}
            startIcon={<Icon name="comment" size={20} />}
            sx={{ mt: 1, minHeight: 44 }}
          >
            {t('board.drawer.comment')}
          </Button>
        </Box>
      )}

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        aria-labelledby={`${titleId}-confirm`}
      >
        <Box sx={{ p: 3 }}>
          <Typography component="h2" variant="h6" id={`${titleId}-confirm`}>
            {t('board.drawer.confirmDeleteTitle')}
          </Typography>
          <Typography sx={{ mt: 1 }}>{t('board.drawer.confirmDeleteText')}</Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 2, justifyContent: 'flex-end' }}>
            <Button onClick={() => setConfirmDelete(false)} sx={{ minHeight: 44 }}>
              {t('board.drawer.cancel')}
            </Button>
            <Button
              color="error"
              variant="contained"
              onClick={() => {
                setConfirmDelete(false);
                onDelete(item);
              }}
              sx={{ minHeight: 44 }}
            >
              {t('board.drawer.delete')}
            </Button>
          </Stack>
        </Box>
      </Dialog>
    </Stack>
  );
}

/** A stored link: only absolute http(s) addresses are links (the API checks it too). */
function SafeLink({ href, children }: { href: string; children: ReactNode }) {
  const { t } = useTranslation();
  const safe = safeHref(href);
  if (!safe) return <>{children}</>;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer nofollow">
      {children}
      <Box component="span" sx={visuallyHidden}>
        {` ${t('board.markdown.newWindow')}`}
      </Box>
    </a>
  );
}
