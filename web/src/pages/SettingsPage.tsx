import { Alert, CircularProgress, Stack, Typography } from '@mui/material';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { AppearanceSection } from '../settings/AppearanceSection';
import { BabySection } from '../settings/BabySection';
import { EventTypesSection } from '../settings/EventTypesSection';
import { MedicationsSection } from '../settings/MedicationsSection';
import { MembersSection } from '../settings/MembersSection';
import { SettingsSection } from '../settings/SettingsSection';
import { SyncSection } from '../settings/SyncSection';
import { canWrite } from '../baby/permissions';

export function SettingsPage() {
  const { babies, baby } = useSelectedBaby();

  if (!babies) return <CircularProgress aria-label="Loading" />;

  return (
    <Stack spacing={1}>
      <Typography variant="h5" component="h1" gutterBottom>
        Settings
      </Typography>
      {baby ? (
        <>
          {!canWrite(baby) && (
            <Alert severity="info">You have view-only access to {baby.name}.</Alert>
          )}
          <SettingsSection id="baby" title="Baby" defaultExpanded>
            <BabySection baby={baby} />
          </SettingsSection>
          <SettingsSection id="event-types" title="Event types">
            <EventTypesSection baby={baby} />
          </SettingsSection>
          <SettingsSection id="medications" title="Medications">
            <MedicationsSection baby={baby} />
          </SettingsSection>
          <SettingsSection id="members" title="Members & invites">
            <MembersSection baby={baby} />
          </SettingsSection>
        </>
      ) : (
        <Alert severity="info">Create a baby on the Home screen to unlock these settings.</Alert>
      )}
      <SettingsSection id="appearance" title="Appearance">
        <AppearanceSection />
      </SettingsSection>
      <SettingsSection id="sync" title="Sync">
        <SyncSection />
      </SettingsSection>
    </Stack>
  );
}
