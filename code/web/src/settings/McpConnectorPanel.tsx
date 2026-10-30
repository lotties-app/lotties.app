import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import { connectedAppsUrl } from '../assistants/connectedApps';
import { visuallyHidden } from '../insights/charts/chartStyle';
import { isNativeApp } from '../platform/nativeApp';
import { Icon } from '../ui/Icon';

interface Props {
  /** The MCP server URL the server reports (the one its OAuth metadata names). */
  url: string;
  /** The OIDC authority (Keycloak realm issuer) whose account console lists the connected apps; `null` hides the link. */
  authority: string | null;
}

/**
 * Settings > Voice assistants > AI assistants (MCP) (docs/design/32-assistants.md section 9,
 * docs/MCP.md): what connecting an AI assistant means, the URL to paste into it, what the
 * assistant's provider receives, and where to disconnect it. Shown only when the server has MCP on.
 */
export function McpConnectorPanel({ url, authority }: Props) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const manageHref = authority ? connectedAppsUrl(authority) : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
  };

  return (
    <Stack spacing={1.5} component="section" aria-labelledby="mcp-connector-title">
      <Typography variant="subtitle1" component="h3" id="mcp-connector-title">
        {t('assistants.mcp.title')}
      </Typography>
      <Typography color="text.secondary">{t('assistants.mcp.intro')}</Typography>
      <TextField
        label={t('assistants.mcp.urlLabel')}
        value={url}
        onFocus={(e) => e.target.select()}
        slotProps={{
          input: { readOnly: true },
          htmlInput: { 'aria-describedby': 'mcp-connector-url-hint', spellCheck: false },
        }}
      />
      <Typography variant="body2" color="text.secondary" id="mcp-connector-url-hint">
        {t('assistants.mcp.urlHint')}
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          startIcon={<Icon name="copy" />}
          onClick={() => void copy()}
          sx={{ minHeight: 44 }}
        >
          {t('assistants.mcp.copy')}
        </Button>
        {manageHref && (
          <Button
            variant="outlined"
            endIcon={<Icon name="external-link" />}
            href={manageHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              if (!isNativeApp()) return;
              event.preventDefault();
              void import('../platform/nativeShell').then((m) =>
                m.capacitorShell.openBrowser(manageHref),
              );
            }}
            sx={{ minHeight: 44 }}
          >
            {t('assistants.mcp.manage')}
            <Box component="span" sx={visuallyHidden}>
              {' '}
              {t('assistants.mcp.newWindow')}
            </Box>
          </Button>
        )}
      </Stack>
      <Typography variant="body2" role="status" aria-live="polite">
        {copied === 'yes'
          ? t('assistants.mcp.copied')
          : copied === 'failed'
            ? t('assistants.mcp.copyFailed')
            : ''}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('assistants.mcp.privacy')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('assistants.mcp.revoke')}
      </Typography>
    </Stack>
  );
}
