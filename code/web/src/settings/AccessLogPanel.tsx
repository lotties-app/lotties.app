import { useTranslation } from 'react-i18next';
import { CircularProgress, List, ListItem, ListItemText, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import type { Baby } from '../db/models';
import { scopeList } from '../doctor/scopeText';
import { parseScopes } from '../doctor/scopes';
import { fromProfessionalDto, parseRole, type MemberDto } from '../sync/contract';
import { doctorLabel } from '../professional/doctorLabel';
import { formatDateTime } from '../i18n/format';
import { DoctorName } from '../professional/DoctorName';
import { listAccessLog, type AccessLogEntry } from '../professional/professionalApi';
import { useOnline } from '../sync/useOnline';
import { ErrorNotice } from './ErrorNotice';
import { babyShownName } from '../baby/shownName';

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

/** What each doctor of the baby sees, above the log ("Dr. Ana Souza sees: daily log and growth"). */
function DoctorScopesHeader({ baby, members }: { baby: Baby; members: readonly MemberDto[] }) {
  const { t } = useTranslation();
  const doctors = members.filter((member) => parseRole(member.role) === 'Doctor');
  if (doctors.length === 0) return null;
  return (
    <Stack component="ul" spacing={0.5} sx={{ m: 0, p: 0, listStyle: 'none' }}>
      {doctors.map((member) => {
        const doctor = doctorLabel(t, {
          displayName: member.displayName?.trim() ?? '',
          professional: fromProfessionalDto(member.professional),
        });
        const scopes = parseScopes(member.doctorScopes);
        return (
          <Typography component="li" variant="body2" key={member.userId}>
            {scopes.length === 0
              ? t('doctorDashboard.access.logHeaderNothing', { doctor, baby: babyShownName(baby) })
              : t('doctorDashboard.access.logHeader', { doctor, list: scopeList(scopes, t) })}
          </Typography>
        );
      })}
    </Stack>
  );
}

/**
 * Owner only, inside Members: who among the baby's doctors loaded its data and when (written by the
 * server at most once an hour per doctor; the newest 50), under what each doctor sees. Read-only,
 * online only.
 */
export function AccessLogPanel({ baby, members }: { baby: Baby; members?: readonly MemberDto[] }) {
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
        {t('doctor.accessLog.explainer', { name: babyShownName(baby) })}
      </Typography>
      {members && <DoctorScopesHeader baby={baby} members={members} />}
      {log.isError && <ErrorNotice message={t('doctor.accessLog.loadFailed')} />}
      {log.isPending && online && <CircularProgress size={24} aria-label={t('common.loading')} />}
      {log.data?.length === 0 && (
        <Typography color="text.secondary">
          {t('doctor.accessLog.none', { name: babyShownName(baby) })}
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
