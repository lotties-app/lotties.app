import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Stack, Typography } from '@mui/material';
import { readBuildInfo } from '../config/buildInfo';
import { saveFile } from '../platform/saveFile';
import type { SpeechCapabilities } from '../platform/speechTypes';
import type { SpeechLocale } from '../voice/numberWords';
import { buildExport, exportFileName, type PhraseRecord } from './labModel';

interface Props {
  records: readonly PhraseRecord[];
  capabilities: Partial<Record<SpeechLocale, SpeechCapabilities>>;
  /** Test seam: where the file goes (default: download in a browser, share sheet in the app). */
  save?: (file: Blob, name: string) => Promise<boolean>;
}

/** Export results: the attempts and the summary as one JSON file (platform/saveFile.ts). */
export function ExportResults({ records, capabilities, save = saveFile }: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'done' | 'failed' | null>(null);

  async function exportNow() {
    const at = new Date();
    const build = readBuildInfo();
    const known = Object.values(capabilities)[0];
    const file = buildExport(
      records,
      capabilities,
      {
        version: build.version,
        commit: build.commit,
        platform: known?.platform ?? 'web',
        osVersion: known?.osVersion ?? null,
      },
      at,
    );
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    try {
      setStatus((await save(blob, exportFileName(at))) ? 'done' : 'failed');
    } catch {
      setStatus('failed');
    }
  }

  return (
    <Stack spacing={1}>
      <Button
        variant="outlined"
        size="large"
        disabled={records.length === 0}
        onClick={() => void exportNow()}
      >
        {t('voiceLab.export.button')}
      </Button>
      <Typography variant="body2" color="text.secondary">
        {t('voiceLab.export.hint')}
      </Typography>
      {status && (
        <Typography variant="body2" role="status" color={status === 'failed' ? 'error' : undefined}>
          {t(`voiceLab.export.${status}`)}
        </Typography>
      )}
    </Stack>
  );
}
