import { useTranslation } from 'react-i18next';
import { Alert, List, ListItem, ListItemText, Stack, Typography } from '@mui/material';
import { formatDate } from '../i18n/format';
import {
  BACKUP_KINDS,
  MAX_ISSUES_SHOWN,
  describeCounts,
  describeIssueCode,
  describeNotice,
  type BackupKind,
  type BackupReportDto,
} from './backupModel';

/** The kind of an issue; the server may name one this build does not know (shown as events). */
function asKind(kind: string): BackupKind | 'baby' {
  return kind === 'baby' || (BACKUP_KINDS as readonly string[]).includes(kind)
    ? (kind as BackupKind | 'baby')
    : 'events';
}

/** What a backup import will do (or did): the file's origin, the counts per kind, notices and invalid records. */
export function BackupReport({ report }: { report: BackupReportDto }) {
  const { t } = useTranslation();
  const rows = BACKUP_KINDS.map((kind) => ({ kind, counts: report.kinds[kind] })).filter(
    (row) => row.counts && row.counts.total > 0,
  );
  const shown = report.issues.slice(0, MAX_ISSUES_SHOWN);
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        {t('backup.report.source', {
          name: report.source.babyName ?? '',
          date: formatDate(report.source.exportedAt),
        })}
      </Typography>
      {rows.length === 0 ? (
        <Typography>{t('backup.report.empty')}</Typography>
      ) : (
        <List dense aria-label={t('backup.report.listLabel')} disablePadding>
          {rows.map(({ kind, counts }) => (
            <ListItem key={kind} disableGutters divider>
              <ListItemText
                primary={t(`backup.kinds.${kind}`)}
                secondary={describeCounts(counts)}
                sx={{ overflowWrap: 'anywhere' }}
              />
            </ListItem>
          ))}
        </List>
      )}
      {report.notices.map((notice) => (
        <Alert key={notice.code} severity="info">
          {describeNotice(notice.code, notice.count)}
        </Alert>
      ))}
      {report.issueCount > 0 && (
        <Alert severity="error">
          <Typography>{t('backup.report.invalidTitle', { count: report.issueCount })}</Typography>
          <List dense disablePadding aria-label={t('backup.report.issuesLabel')}>
            {shown.map((issue, index) => (
              <ListItem key={`${issue.kind}-${issue.id ?? index}`} disableGutters>
                <ListItemText
                  primary={t('backup.report.issue', {
                    kind: t(`backup.kinds.${asKind(issue.kind)}`),
                    reason: describeIssueCode(issue.code),
                  })}
                  secondary={issue.id ?? undefined}
                  sx={{ overflowWrap: 'anywhere' }}
                />
              </ListItem>
            ))}
          </List>
          {report.issueCount > shown.length && (
            <Typography variant="body2">
              {t('backup.report.moreIssues', { count: report.issueCount - shown.length })}
            </Typography>
          )}
        </Alert>
      )}
    </Stack>
  );
}
