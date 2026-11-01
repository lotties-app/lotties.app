import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useApiClient } from '../api/ApiClientContext';
import { describeApiError } from '../api/errorMessages';
import { formatDate, formatDateTime, formatRelative } from '../i18n/format';
import { SegmentedControl } from '../ui/form';
import { palette } from '../ui/form/styles';
import { Icon } from '../ui/Icon';
import { copyText } from '../util/copyText';
import { createKey, revokeKey, type BoardApiKey, type BoardTopic } from './boardApi';
import { useBoardKeys, useBoardRefresh } from './boardData';
import { boardErrorOverrides } from './boardErrors';
import { MultiSelect } from './BoardFilterBar';
import { sortTopics } from './boardQuery';
import { boardApiRoot, curlExample, maskedPrefix, mcpCommand } from './boardUsage';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

interface Props {
  topics: readonly BoardTopic[];
  announce: (message: string) => void;
  now: number;
}

/**
 * API keys (admins only, docs/design/36-project-board.md section 4.2): the list (prefix, scope,
 * topics, expiry, last use), creating one (its secret is shown once, then forgotten), revoking
 * one, and how a tool uses it.
 */
export function KeysPanel({ topics, announce, now }: Props) {
  const { t } = useTranslation();
  const keys = useBoardKeys(true);
  const refresh = useBoardRefresh();
  const api = useApiClient();
  const [created, setCreated] = useState<{ name: string; secret: string } | null>(null);
  const [revoking, setRevoking] = useState<BoardApiKey | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const revoke = async (key: BoardApiKey) => {
    setRevoking(null);
    try {
      await revokeKey(api, key.id);
      await refresh.keys();
      announce(t('board.keys.revoked', { name: key.name }));
    } catch (error) {
      setFailure(describeApiError(error, boardErrorOverrides()));
    }
  };

  return (
    <Stack spacing={3}>
      <CreateKeyForm
        topics={topics}
        now={now}
        onCreated={(name, secret) => {
          setCreated({ name, secret });
          void refresh.keys();
        }}
      />

      <Box component="section" aria-labelledby="board-keys-list">
        <Typography component="h3" variant="subtitle1" id="board-keys-list" sx={{ mb: 1 }}>
          {t('board.keys.listTitle')}
        </Typography>
        {failure && (
          <Alert severity="error" role="alert" sx={{ mb: 1 }}>
            {failure}
          </Alert>
        )}
        {keys.isPending ? (
          <Stack spacing={1} aria-busy="true">
            <Skeleton variant="rounded" height={72} />
            <Skeleton variant="rounded" height={72} />
          </Stack>
        ) : keys.isError ? (
          <Alert severity="error">{describeApiError(keys.error, boardErrorOverrides())}</Alert>
        ) : keys.data.length === 0 ? (
          <Typography color="text.secondary">{t('board.keys.none')}</Typography>
        ) : (
          <Box component="ul" sx={{ m: 0, p: 0, display: 'grid', gap: 1 }}>
            {keys.data.map((key) => (
              <KeyRow
                key={key.id}
                apiKey={key}
                topics={topics}
                now={now}
                onRevoke={() => setRevoking(key)}
              />
            ))}
          </Box>
        )}
      </Box>

      <HowToUse />

      {created && (
        <SecretDialog
          name={created.name}
          secret={created.secret}
          // The secret leaves the page's memory here: it is never shown again.
          onDone={() => setCreated(null)}
        />
      )}

      <Dialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        aria-labelledby="board-revoke-title"
      >
        <DialogTitle id="board-revoke-title">{t('board.keys.revokeTitle')}</DialogTitle>
        <DialogContent>
          <Typography>{t('board.keys.revokeText', { name: revoking?.name ?? '' })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevoking(null)} sx={{ minHeight: 44 }}>
            {t('board.drawer.cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => revoking && void revoke(revoking)}
            sx={{ minHeight: 44 }}
          >
            {t('board.keys.revoke')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function KeyRow({
  apiKey,
  topics,
  now,
  onRevoke,
}: {
  apiKey: BoardApiKey;
  topics: readonly BoardTopic[];
  now: number;
  onRevoke: () => void;
}) {
  const { t } = useTranslation();
  const state = apiKey.revokedAt
    ? 'revoked'
    : apiKey.expiresAt && Date.parse(apiKey.expiresAt) <= now
      ? 'expired'
      : 'active';
  const topicNames = apiKey.allowedTopics?.map(
    (key) => topics.find((topic) => topic.key === key)?.name ?? key,
  );
  return (
    <Box
      component="li"
      sx={(theme) => ({
        listStyle: 'none',
        p: 1.5,
        borderRadius: '16px',
        backgroundColor: palette(theme).surfaceRaised,
        opacity: state === 'active' ? 1 : 0.85,
      })}
    >
      <Stack
        direction="row"
        useFlexGap
        sx={{ flexWrap: 'wrap', alignItems: 'center', gap: 1, justifyContent: 'space-between' }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{apiKey.name}</Typography>
          <Typography
            component="code"
            variant="body2"
            sx={{ fontFamily: MONO, overflowWrap: 'anywhere' }}
          >
            {maskedPrefix(apiKey.prefix)}
          </Typography>
        </Box>
        <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', gap: 0.5 }}>
          <Chip size="small" variant="outlined" label={t(`board.keys.scopes.${apiKey.scope}`)} />
          <Chip
            size="small"
            color={state === 'active' ? 'success' : state === 'revoked' ? 'error' : 'warning'}
            label={t(`board.keys.states.${state}`)}
          />
        </Stack>
      </Stack>
      <Box
        component="dl"
        sx={{
          m: 0,
          mt: 1,
          display: 'grid',
          gridTemplateColumns: 'auto minmax(0, 1fr)',
          columnGap: 1.5,
          rowGap: 0.25,
          fontSize: '0.8125rem',
          '& dt': { color: 'text.secondary' },
          '& dd': { m: 0, overflowWrap: 'anywhere' },
        }}
      >
        <dt>{t('board.keys.topics')}</dt>
        <dd>{topicNames?.length ? topicNames.join(', ') : t('board.keys.allTopics')}</dd>
        <dt>{t('board.keys.expires')}</dt>
        <dd>{apiKey.expiresAt ? formatDate(apiKey.expiresAt) : t('board.keys.noExpiry')}</dd>
        <dt>{t('board.keys.lastUsed')}</dt>
        <dd>
          {apiKey.lastUsedAt
            ? t('board.keys.lastUsedValue', {
                when: formatRelative(Date.parse(apiKey.lastUsedAt), now),
                count: apiKey.useCount,
              })
            : t('board.keys.neverUsed')}
        </dd>
        <dt>{t('board.keys.createdBy')}</dt>
        <dd>
          {t('board.drawer.byOn', {
            name: apiKey.createdBy,
            date: formatDateTime(apiKey.createdAt),
          })}
        </dd>
        {apiKey.revokedAt && (
          <>
            <dt>{t('board.keys.revokedAt')}</dt>
            <dd>{formatDateTime(apiKey.revokedAt)}</dd>
          </>
        )}
      </Box>
      {state === 'active' && (
        <Button
          color="error"
          onClick={onRevoke}
          startIcon={<Icon name="delete" size={20} />}
          sx={{ mt: 1, minHeight: 44 }}
        >
          {t('board.keys.revokeNamed', { name: apiKey.name })}
        </Button>
      )}
    </Box>
  );
}

function CreateKeyForm({
  topics,
  now,
  onCreated,
}: {
  topics: readonly BoardTopic[];
  now: number;
  onCreated: (name: string, secret: string) => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('read');
  const [expires, setExpires] = useState('');
  const [allowed, setAllowed] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const tomorrow = new Date(now + 86_400_000).toISOString().slice(0, 10);
  const nameError = touched && !name.trim();
  const expiryError = !!expires && expires < tomorrow;

  const submit = async () => {
    setTouched(true);
    if (!name.trim() || expiryError) return;
    setBusy(true);
    setFailure(null);
    try {
      // Straight from the answer into the dialog's state: never into a query or mutation cache.
      const answer = await createKey(api, {
        name: name.trim(),
        scope,
        ...(allowed.length ? { allowedTopics: allowed } : {}),
        ...(expires ? { expiresAt: `${expires}T23:59:59.000Z` } : {}),
      });
      onCreated(answer.key.name, answer.secret);
      setName('');
      setExpires('');
      setAllowed([]);
      setScope('read');
      setTouched(false);
    } catch (error) {
      setFailure(describeApiError(error, boardErrorOverrides()));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      component="form"
      noValidate
      aria-labelledby="board-keys-create"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Typography component="h3" variant="subtitle1" id="board-keys-create" sx={{ mb: 1 }}>
        {t('board.keys.createTitle')}
      </Typography>
      <Stack spacing={2}>
        {failure && (
          <Alert severity="error" role="alert">
            {failure}
          </Alert>
        )}
        <TextField
          label={t('board.keys.name')}
          value={name}
          required
          onChange={(e) => setName(e.target.value)}
          error={nameError}
          helperText={nameError ? t('board.keys.nameRequired') : t('board.keys.nameHelp')}
          slotProps={{ htmlInput: { maxLength: 80 } }}
        />
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }} id="board-keys-scope">
            {t('board.keys.scope')}
          </Typography>
          <SegmentedControl<'read' | 'write'>
            aria-label={t('board.keys.scope')}
            value={scope}
            onChange={(value) => value && setScope(value)}
            options={[
              { value: 'read', label: t('board.keys.scopes.read'), icon: 'eye' },
              { value: 'write', label: t('board.keys.scopes.write'), icon: 'edit' },
            ]}
          />
        </Box>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { sm: '1fr 1fr' } }}>
          <TextField
            type="date"
            label={t('board.keys.expiry')}
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            error={expiryError}
            helperText={expiryError ? t('board.keys.expiryPast') : t('board.keys.expiryHelp')}
            slotProps={{ htmlInput: { min: tomorrow } }}
          />
          <MultiSelect
            label={t('board.keys.topicsLimit')}
            options={sortTopics(topics).map((topic) => ({ value: topic.key, label: topic.name }))}
            value={allowed}
            onChange={(next) => setAllowed(next.slice(0, 10))}
          />
        </Box>
        <Button
          type="submit"
          variant="contained"
          disabled={busy}
          startIcon={<Icon name="key" size={20} />}
          sx={{ alignSelf: 'flex-start', minHeight: 44 }}
        >
          {t('board.keys.create')}
        </Button>
      </Stack>
    </Box>
  );
}

/** The new key's secret, this one time: a copy button and a plain warning. */
function SecretDialog({
  name,
  secret,
  onDone,
}: {
  name: string;
  secret: string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    // No `onClose`: Escape and the backdrop do not close it, only "Done" forgets the secret.
    <Dialog open aria-labelledby={titleId} fullWidth maxWidth="sm">
      <DialogTitle id={titleId}>{t('board.keys.secretTitle', { name })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Alert severity="warning">{t('board.keys.secretWarning')}</Alert>
          <TextField
            label={t('board.keys.secretLabel')}
            value={secret}
            multiline
            onFocus={(e) => e.target.select()}
            slotProps={{
              input: { readOnly: true, sx: { fontFamily: MONO } },
              htmlInput: { spellCheck: false, 'data-testid': 'board-key-secret' },
            }}
          />
          <Button
            variant="contained"
            startIcon={<Icon name="copy" size={20} />}
            onClick={() => void copyText(secret).then(setCopied)}
            sx={{ alignSelf: 'flex-start', minHeight: 44 }}
          >
            {t('board.keys.copy')}
          </Button>
          <Typography variant="body2" role="status" aria-live="polite">
            {copied === true
              ? t('board.keys.copied')
              : copied === false
                ? t('board.keys.copyFailed')
                : ''}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="outlined" onClick={onDone} sx={{ minHeight: 44 }}>
          {t('board.keys.secretDone')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CommandBlock({ label, command }: { label: string; command: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      <Box
        component="pre"
        sx={(theme) => ({
          m: 0,
          mt: 0.5,
          p: 1.25,
          borderRadius: '12px',
          backgroundColor: palette(theme).surfaceRaised,
          fontFamily: MONO,
          fontSize: '0.8125rem',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        })}
      >
        <code>{command}</code>
      </Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button
          size="small"
          startIcon={<Icon name="copy" size={16} />}
          onClick={() => void copyText(command).then(setCopied)}
          aria-label={t('board.keys.copyCommand', { label })}
          sx={{ minHeight: 44 }}
        >
          {t('board.keys.copy')}
        </Button>
        <Typography variant="caption" role="status" aria-live="polite">
          {copied === true
            ? t('board.keys.copied')
            : copied === false
              ? t('board.keys.copyFailed')
              : ''}
        </Typography>
      </Stack>
    </Box>
  );
}

function HowToUse() {
  const { t } = useTranslation();
  const root = boardApiRoot();
  return (
    <Box component="section" aria-labelledby="board-keys-howto">
      <Typography component="h3" variant="subtitle1" id="board-keys-howto" sx={{ mb: 1 }}>
        {t('board.keys.howTitle')}
      </Typography>
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {t('board.keys.howIntro')}
        </Typography>
        <CommandBlock label={t('board.keys.howCurl')} command={curlExample(root)} />
        <CommandBlock label={t('board.keys.howMcp')} command={mcpCommand(root)} />
        <Typography variant="body2" color="text.secondary">
          {t('board.keys.howDocs')}
        </Typography>
      </Stack>
    </Box>
  );
}
