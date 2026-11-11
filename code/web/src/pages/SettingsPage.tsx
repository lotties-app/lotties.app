import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router-dom';
import { Alert, CircularProgress, Stack, Typography } from '@mui/material';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { AppearanceSection } from '../settings/AppearanceSection';
import { LanguageSection } from '../settings/LanguageSection';
import { UnitsSection } from '../settings/UnitsSection';
import { BabySection } from '../settings/BabySection';
import { EventTypesSection } from '../settings/EventTypesSection';
import { FeedingSection } from '../settings/FeedingSection';
import { ConsentSection } from '../consent/ConsentSection';
import { SettingsSection } from '../settings/SettingsSection';
import { SyncSection } from '../settings/SyncSection';
import { DeleteAccountSection } from '../settings/DeleteAccountSection';
import { ProfessionalSection } from '../settings/ProfessionalSection';
import { VoiceAssistantsSection } from '../settings/VoiceAssistantsSection';
import { VoiceCommandsLink } from '../assistants/VoiceCommandsLink';
import { canLog, canWrite, isCaregiver, isDoctor } from '../baby/permissions';
import { hasPatients } from '../doctor/appMode';
import { useBabies } from '../db/hooks';
import { usePushConfig } from '../notifications/usePush';
import { NotificationsSection } from '../notifications/ui/NotificationsSection';
import { VersionLine } from '../ui/VersionLine';
import { babyShownName } from '../baby/shownName';
import { ProfileSection } from '../settings/ProfileSection';
import { DataLocationSection } from '../byoDatabase/DataLocationSection';
import { CommunityInsightsSection } from '../communityInsights/CommunityInsightsSection';

/**
 * Sections that moved to the Hub: an old `/settings#medications` link (a bookmark, a reminder or
 * a first-run card from an older version) lands on the page that holds it now.
 */
const MOVED_TO_HUB: Readonly<Record<string, string>> = {
  medications: '/hub/medicines',
  formulas: '/hub/formulas',
  import: '/hub/import',
  members: '/hub/family',
};

export function SettingsPage() {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  const all = useBabies();
  const doctor = hasPatients(all);
  // Links open one section: the header's sync icon (#sync), the account menu (#baby, #appearance)
  // the first-run cards (#import, #members) and the reminder prompts (#notifications).
  const { hash } = useLocation();
  const target = hash.slice(1);
  const moved = Object.hasOwn(MOVED_TO_HUB, target) ? MOVED_TO_HUB[target] : undefined;
  const wants = (...ids: string[]) => ids.includes(target);
  // Hidden when the server has push off (or before its config loaded).
  const push = usePushConfig().data;

  useEffect(() => {
    if (target) document.getElementById(`${target}-header`)?.scrollIntoView?.({ block: 'start' });
  }, [target, babies]);

  if (moved) return <Navigate to={moved} replace />;
  if (!babies || !all) return <CircularProgress aria-label={t('common.loading')} />;

  return (
    <Stack spacing={1} useFlexGap>
      <Typography variant="h5" component="h1" sx={{ mb: 2 }}>
        {t('settings.title')}
      </Typography>
      {baby ? (
        <>
          {!canWrite(baby) && (
            <Alert severity="info">
              {t(
                isDoctor(baby)
                  ? 'doctor.settingsNotice'
                  : isCaregiver(baby)
                    ? 'baby.caregiverNamed'
                    : 'baby.viewOnlyNamed',
                {
                  name: babyShownName(baby),
                },
              )}
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
          <CommunityInsightsSection baby={baby} expanded={wants('community-insights')} />
        </>
      ) : (
        !doctor && <Alert severity="info">{t('settings.createBabyFirst')}</Alert>
      )}
      <SettingsSection id="profile" title={t('profile.title')} defaultExpanded={wants('profile')}>
        <ProfileSection />
      </SettingsSection>
      <SettingsSection
        id="professional"
        title={t('doctor.profile.sectionTitle')}
        defaultExpanded={wants('professional')}
      >
        <ProfessionalSection />
      </SettingsSection>
      {push?.enabled && push.publicKey && (
        <SettingsSection
          id="notifications"
          title={t('settings.sections.notifications')}
          defaultExpanded={wants('notifications')}
        >
          <NotificationsSection babies={babies} publicKey={push.publicKey} />
        </SettingsSection>
      )}
      {babies.some(canLog) && (
        <SettingsSection
          id="feeding"
          title={t('feedingAmounts.timeBottles.title')}
          defaultExpanded={wants('feeding')}
        >
          <FeedingSection />
        </SettingsSection>
      )}
      {babies.some(canLog) && (
        <SettingsSection
          id="voice-assistants"
          title={t('assistants.title')}
          defaultExpanded={wants('voice-assistants')}
        >
          <Stack spacing={1.5}>
            <VoiceCommandsLink />
            <VoiceAssistantsSection babies={babies} />
          </Stack>
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
      <SettingsSection id="units" title={t('units.title')} defaultExpanded={wants('units')}>
        <UnitsSection />
      </SettingsSection>
      <SettingsSection
        id="sync"
        title={t('settings.sections.sync')}
        defaultExpanded={wants('sync')}
      >
        <SyncSection />
      </SettingsSection>
      {baby && <DataLocationSection baby={baby} expanded={wants('data-location')} />}
      <SettingsSection
        id="privacy"
        title={t('consent.settings.title')}
        defaultExpanded={wants('privacy')}
      >
        <ConsentSection />
      </SettingsSection>
      <SettingsSection
        id="account"
        title={t('account.sectionTitle')}
        defaultExpanded={wants('account')}
      >
        <DeleteAccountSection />
      </SettingsSection>
      <VersionLine to="/hub/about" />
    </Stack>
  );
}
