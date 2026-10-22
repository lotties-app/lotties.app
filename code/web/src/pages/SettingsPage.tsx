import { lazy, Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { Alert, CircularProgress, Stack, Typography } from '@mui/material';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { AppearanceSection } from '../settings/AppearanceSection';
import { LanguageSection } from '../settings/LanguageSection';
import { BabySection } from '../settings/BabySection';
import { EventTypesSection } from '../settings/EventTypesSection';
import { MedicationsSection } from '../settings/MedicationsSection';
import { MembersSection } from '../settings/MembersSection';
import { SettingsSection } from '../settings/SettingsSection';
import { SyncSection } from '../settings/SyncSection';
import { canWrite, isCaregiver } from '../baby/permissions';
import { usePushConfig } from '../notifications/usePush';
import { NotificationsSection } from '../notifications/ui/NotificationsSection';

// The importer is only needed when its section is opened, so it loads on demand.
const ImportSection = lazy(() =>
  import('../import/ImportSection').then((m) => ({ default: m.ImportSection })),
);

export function SettingsPage() {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  // Links open one section: the header's sync icon (#sync), the account menu (#baby, #appearance)
  // the first-run cards (#import, #members) and the reminder prompts (#notifications).
  const { hash } = useLocation();
  const target = hash.slice(1);
  const wants = (...ids: string[]) => ids.includes(target);
  // Hidden when the server has push off (or before its config loaded).
  const push = usePushConfig().data;

  useEffect(() => {
    if (target) document.getElementById(`${target}-header`)?.scrollIntoView?.({ block: 'start' });
  }, [target, babies]);

  if (!babies) return <CircularProgress aria-label={t('common.loading')} />;

  return (
    <Stack spacing={1}>
      <Typography variant="h5" component="h1" gutterBottom>
        {t('settings.title')}
      </Typography>
      {baby ? (
        <>
          {!canWrite(baby) && (
            <Alert severity="info">
              {t(isCaregiver(baby) ? 'baby.caregiverNamed' : 'baby.viewOnlyNamed', {
                name: baby.name,
              })}
            </Alert>
          )}
          <SettingsSection
            id="baby"
            title={t('settings.sections.baby')}
            defaultExpanded={target === '' || wants('baby')}
          >
            <BabySection baby={baby} />
          </SettingsSection>
          <SettingsSection
            id="event-types"
            title={t('settings.sections.eventTypes')}
            defaultExpanded={wants('event-types')}
          >
            <EventTypesSection baby={baby} />
          </SettingsSection>
          <SettingsSection
            id="medications"
            title={t('settings.sections.medications')}
            defaultExpanded={wants('medications')}
          >
            <MedicationsSection baby={baby} />
          </SettingsSection>
          <SettingsSection
            id="import"
            title={t('settings.sections.import')}
            defaultExpanded={wants('import')}
          >
            <Suspense fallback={<CircularProgress aria-label={t('common.loading')} />}>
              <ImportSection baby={baby} />
            </Suspense>
          </SettingsSection>
          <SettingsSection
            id="members"
            title={t('settings.sections.members')}
            defaultExpanded={wants('members')}
          >
            <MembersSection baby={baby} />
          </SettingsSection>
        </>
      ) : (
        <Alert severity="info">{t('settings.createBabyFirst')}</Alert>
      )}
      {push?.enabled && push.publicKey && (
        <SettingsSection
          id="notifications"
          title={t('settings.sections.notifications')}
          defaultExpanded={wants('notifications')}
        >
          <NotificationsSection babies={babies} publicKey={push.publicKey} />
        </SettingsSection>
      )}
      <SettingsSection
        id="appearance"
        title={t('settings.sections.appearance')}
        defaultExpanded={wants('appearance', 'language')}
      >
        <AppearanceSection />
      </SettingsSection>
      <SettingsSection
        id="language"
        title={t('settings.sections.language')}
        defaultExpanded={wants('appearance', 'language')}
      >
        <LanguageSection />
      </SettingsSection>
      <SettingsSection
        id="sync"
        title={t('settings.sections.sync')}
        defaultExpanded={wants('sync')}
      >
        <SyncSection />
      </SettingsSection>
    </Stack>
  );
}
