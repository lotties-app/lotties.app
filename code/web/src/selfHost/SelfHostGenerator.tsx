import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import { copyText } from '../util/copyText';
import { Field, SegmentedControl, SwitchRow, TextInput } from '../ui/form';
import {
  buildComposeFile,
  buildEnvFile,
  DEFAULT_INPUT,
  identityProviderSettings,
  validateInput,
  type DbMode,
  type SelfHostInput,
} from './generate';
import { generateVapidPair, randomPassword } from './secrets';

type TextKey = Exclude<
  {
    [K in keyof SelfHostInput]: SelfHostInput[K] extends string ? K : never;
  }[keyof SelfHostInput],
  'dbMode'
>;

interface TextMeta {
  required?: boolean;
  kind?: 'public' | 'secret';
  placeholder?: string;
}

/** Which text fields are required, public (compiled into the bundle) or secret, and an example value. */
const META: Record<TextKey, TextMeta> = {
  publicUrl: { required: true, placeholder: 'https://baby.example.com' },
  webPort: { required: true, kind: 'public' },
  oidcAuthority: {
    required: true,
    kind: 'public',
    placeholder: 'https://id.example.com/realms/home',
  },
  oidcClientId: { required: true, kind: 'public' },
  apiAudience: { required: true, kind: 'public' },
  dbHost: { required: true },
  dbPort: { required: true },
  dbName: { required: true },
  dbUser: { required: true },
  dbPassword: { required: true, kind: 'secret' },
  corsOrigins: { kind: 'public' },
  vapidPublicKey: { required: true, kind: 'public' },
  vapidPrivateKey: { required: true, kind: 'secret' },
  vapidSubject: { required: true, placeholder: 'mailto:you@example.com' },
  privacyControllerName: { kind: 'public' },
  privacyContactEmail: { kind: 'public' },
  privacyDpo: { kind: 'public' },
  repoUrl: { kind: 'public' },
};

const SITE_FIELDS = ['publicUrl', 'webPort'] as const;
const SIGN_IN_FIELDS = ['oidcAuthority', 'oidcClientId', 'apiAudience'] as const;
const EXTERNAL_DB_FIELDS = ['dbHost', 'dbPort'] as const;
const CORS_FIELDS = ['corsOrigins'] as const;
const PUSH_SUBJECT_FIELDS = ['vapidSubject'] as const;
const OTHER_FIELDS = ['repoUrl'] as const;
const DB_FIELDS = ['dbName', 'dbUser', 'dbPassword'] as const;
const PUSH_KEY_FIELDS = ['vapidPublicKey', 'vapidPrivateKey'] as const;
const PRIVACY_FIELDS = ['privacyControllerName', 'privacyContactEmail', 'privacyDpo'] as const;

/** The generator state lives only in this component: no storage, no network. */
function initialInput(): SelfHostInput {
  return { ...DEFAULT_INPUT, dbPassword: randomPassword() };
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack spacing={2} component="section" aria-label={title}>
      <Typography variant="h6" component="h3">
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

function FileBlock({
  name,
  help,
  text,
  downloadName,
}: {
  name: string;
  help: string;
  text: string;
  downloadName: string;
}) {
  const { t } = useTranslation();
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const onCopy = async () => setCopy((await copyText(text)) ? 'copied' : 'failed');
  const onDownload = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = downloadName;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Stack spacing={1} component="section" aria-label={name}>
      <Typography variant="subtitle1" component="h4" sx={{ fontFamily: 'monospace' }}>
        {name}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {help}
      </Typography>
      <Box
        component="pre"
        tabIndex={0}
        aria-label={name}
        sx={{
          m: 0,
          p: 1.5,
          overflow: 'auto',
          maxHeight: 360,
          borderRadius: 1,
          bgcolor: 'action.hover',
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        {text}
      </Box>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="outlined" onClick={onCopy} sx={{ minHeight: 44 }}>
          {copy === 'copied'
            ? t('selfHost.generator.actions.copied')
            : t('selfHost.generator.actions.copy')}
        </Button>
        <Button variant="outlined" onClick={onDownload} sx={{ minHeight: 44 }}>
          {t('selfHost.generator.actions.download')}
        </Button>
        {copy === 'failed' && (
          <Typography role="status" variant="body2" color="error">
            {t('selfHost.generator.actions.copyFailed')}
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}

/**
 * The self-host configuration generator: typed values in, a `.env` and a `docker-compose.yml` out, all in this
 * page (see generate.ts). Secrets are made here with WebCrypto and never leave the component.
 */
export function SelfHostGenerator() {
  const { t } = useTranslation();
  const [input, setInput] = useState<SelfHostInput>(initialInput);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [keyFailed, setKeyFailed] = useState(false);

  const errors = useMemo(() => validateInput(input), [input]);
  const complete = Object.keys(errors).length === 0;
  const files = useMemo(
    () => (complete ? { env: buildEnvFile(input), compose: buildComposeFile(input) } : null),
    [complete, input],
  );
  const provider = identityProviderSettings(input.publicUrl);

  const update = <K extends keyof SelfHostInput>(key: K, value: SelfHostInput[K]) =>
    setInput((current) => ({ ...current, [key]: value }));
  const touch = (key: string) => setTouched((s) => new Set(s).add(key));

  const badge = (kind: 'public' | 'secret') => (
    <Chip
      size="small"
      variant="outlined"
      color={kind === 'secret' ? 'warning' : 'default'}
      label={t(`selfHost.generator.badge.${kind}`)}
      sx={{ height: 20 }}
    />
  );

  /** One text field: label with its public/secret badge, help, and the error once the person has been there. */
  const text = (key: TextKey) => {
    const options = META[key];
    const problem = errors[key];
    return (
      <Field
        key={key}
        label={
          <>
            {t(`selfHost.generator.fields.${key}.label`)} {options.kind && badge(options.kind)}
          </>
        }
        help={t(`selfHost.generator.fields.${key}.help`)}
        required={options.required}
        optional={!options.required}
        error={
          problem && (touched.has(key) || input[key] !== '')
            ? t(`selfHost.generator.errors.${problem}`)
            : undefined
        }
      >
        <TextInput
          value={input[key]}
          onChange={(value) => {
            touch(key);
            update(key, value);
          }}
          placeholder={options.placeholder}
          maxLength={key === 'dbPassword' || key.startsWith('vapid') ? 300 : 200}
        />
      </Field>
    );
  };

  const regeneratePassword = () => update('dbPassword', randomPassword());
  const regenerateKeys = async () => {
    try {
      const pair = await generateVapidPair();
      setKeyFailed(false);
      setInput((current) => ({
        ...current,
        vapidPublicKey: pair.publicKey,
        vapidPrivateKey: pair.privateKey,
      }));
    } catch {
      setKeyFailed(true);
    }
  };
  const togglePush = (on: boolean) => {
    update('pushEnabled', on);
    if (on && !input.vapidPublicKey) void regenerateKeys();
  };

  return (
    <Stack spacing={3} component="section" aria-labelledby="selfhost-generator-title">
      <Stack spacing={1}>
        <Typography id="selfhost-generator-title" variant="h5" component="h2">
          {t('selfHost.generator.title')}
        </Typography>
        <Typography>{t('selfHost.generator.intro')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('selfHost.generator.badgeHelp')}
        </Typography>
      </Stack>

      <Group title={t('selfHost.generator.groups.site')}>{SITE_FIELDS.map(text)}</Group>

      <Group title={t('selfHost.generator.groups.signIn')}>
        {SIGN_IN_FIELDS.map(text)}
        <SwitchRow
          checked={input.sendAudience}
          onChange={(v) => update('sendAudience', v)}
          label={t('selfHost.generator.fields.sendAudience.label')}
          description={t('selfHost.generator.fields.sendAudience.description')}
        />
      </Group>

      <Group title={t('selfHost.generator.groups.database')}>
        <Field label={t('selfHost.generator.fields.dbMode.label')} group>
          <SegmentedControl<DbMode>
            value={input.dbMode}
            onChange={(v) => v && update('dbMode', v)}
            options={[
              { value: 'bundled', label: t('selfHost.generator.fields.dbMode.bundled') },
              { value: 'external', label: t('selfHost.generator.fields.dbMode.external') },
            ]}
          />
        </Field>
        {input.dbMode === 'external' && <>{EXTERNAL_DB_FIELDS.map(text)}</>}
        {DB_FIELDS.map(text)}
        <Box>
          <Button variant="outlined" onClick={regeneratePassword} sx={{ minHeight: 44 }}>
            {t('selfHost.generator.actions.regenerate')}
          </Button>
        </Box>
        <SwitchRow
          checked={input.autoMigrate}
          onChange={(v) => update('autoMigrate', v)}
          label={t('selfHost.generator.fields.autoMigrate.label')}
          description={t('selfHost.generator.fields.autoMigrate.description')}
        />
        {CORS_FIELDS.map(text)}
      </Group>

      <Group title={t('selfHost.generator.groups.push')}>
        <SwitchRow
          checked={input.pushEnabled}
          onChange={togglePush}
          label={t('selfHost.generator.fields.pushEnabled.label')}
          description={t('selfHost.generator.fields.pushEnabled.description')}
        />
        {input.pushEnabled && (
          <>
            {PUSH_KEY_FIELDS.map(text)}
            <Box>
              <Button variant="outlined" onClick={regenerateKeys} sx={{ minHeight: 44 }}>
                {t('selfHost.generator.actions.generateKeys')}
              </Button>
            </Box>
            {keyFailed && (
              <Alert severity="error">{t('selfHost.generator.actions.copyFailed')}</Alert>
            )}
            {PUSH_SUBJECT_FIELDS.map(text)}
          </>
        )}
      </Group>

      <Group title={t('selfHost.generator.groups.privacy')}>{PRIVACY_FIELDS.map(text)}</Group>

      <Group title={t('selfHost.generator.groups.other')}>{OTHER_FIELDS.map(text)}</Group>

      <Stack spacing={2} component="section" aria-labelledby="selfhost-output-title">
        <Typography id="selfhost-output-title" variant="h5" component="h2">
          {t('selfHost.generator.output.title')}
        </Typography>
        {files ? (
          <>
            <FileBlock
              name={t('selfHost.generator.output.envTitle')}
              help={t('selfHost.generator.output.envHelp')}
              text={files.env}
              downloadName=".env"
            />
            <FileBlock
              name={t('selfHost.generator.output.composeTitle')}
              help={t('selfHost.generator.output.composeHelp')}
              text={files.compose}
              downloadName="docker-compose.yml"
            />
          </>
        ) : (
          <Alert severity="info">{t('selfHost.generator.output.incomplete')}</Alert>
        )}
        {provider && !errors.publicUrl && (
          <Stack spacing={0.5}>
            <Typography variant="subtitle1" component="h3">
              {t('selfHost.generator.output.providerTitle')}
            </Typography>
            <Typography variant="body2">{t('selfHost.generator.output.providerBody')}</Typography>
            <Typography variant="body2" component="ul" sx={{ m: 0, pl: 3 }}>
              <li>
                {t('selfHost.generator.output.callback')}: <code>{provider.callback}</code>
              </li>
              <li>
                {t('selfHost.generator.output.logout')}: <code>{provider.logout}</code>
              </li>
              <li>
                {t('selfHost.generator.output.webOrigin')}: <code>{provider.webOrigin}</code>
              </li>
            </Typography>
          </Stack>
        )}
      </Stack>
    </Stack>
  );
}
