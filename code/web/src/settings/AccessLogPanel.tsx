import { useTranslation } from 'react-i18next';
import { CircularProgress, List, ListItem, ListItemText, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import type { Baby } from '../db/models';
import { formatDateTime } from '../i18n/format';
import { DoctorName } from '../professional/DoctorName';
import { listAccessLog, type AccessLogEntry } from '../professional/professionalApi';
import { useOnline } from '../sync/useOnline';
import { ErrorNotice } from './ErrorNotice';

function EntryRow({ entry }: { entry: AccessLogEntry }) {
  const { t } = useTranslation();
  return (
    <ListItem divider sx={{ px: 0 }}>
      <ListItemText
        disableTypography
        primary={
          entry.person ? (
            <DoctorName person={entry.person} variant="body2" />
          ) : (
            <Typography variant="body2">{t('doctor.notes.unknownAuthor')}</Typography>
          )
        }
        secondary={
          <Typography variant="caption" color="text.secondary" component="p">
            {t('doctor.accessLog.entry', {
              role: t(`baby.roles.${entry.role}`),
              when: formatDateTime(entry.at),
            })}
          </Typography>
        }
      />
    </ListItem>
  );
}

/**
 * Owner only, inside Members: who among the baby's doctors loaded its data and when (written by the
 * server at most once an hour per doctor; the newest 50). Read-only, online only.
 */
export function AccessLogPanel({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const online = useOnline();
  const log = useQuery({
    queryKey: ['access-log', baby.id],
    queryFn: () => listAccessLog(api, baby.id),
    enabled: online,
  });

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle1" component="h3">
        {t('doctor.accessLog.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('doctor.accessLog.explainer', { name: baby.name })}
      </Typography>
      {log.isError && <ErrorNotice message={t('doctor.accessLog.loadFailed')} />}
      {log.isPending && online && <CircularProgress size={24} aria-label={t('common.loading')} />}
      {log.data?.length === 0 && (
        <Typography color="text.secondary">
          {t('doctor.accessLog.none', { name: baby.name })}
        </Typography>
      )}
      {!!log.data?.length && (
        <List aria-label={t('doctor.accessLog.title')} disablePadding>
          {log.data.map((entry) => (
            <EntryRow key={`${entry.userId}-${entry.at}`} entry={entry} />
          ))}
        </List>
      )}
    </Stack>
  );
}
