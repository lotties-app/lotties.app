import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { Box, Paper, Skeleton, Stack, Typography } from '@mui/material';
import { useAllPrescriptions, useMedications } from '../db/hooks';
import type { Prescription } from '../db/models';
import { summaryText } from '../medications/prescriptionForm';
import { NotesScreen } from '../notes/NotesScreen';
import { Growth } from '../pages/GrowthPage';
import { ProposalsScreen } from '../proposals/ProposalsScreen';
import { Provenance } from '../proposals/Provenance';
import { AppearanceSection } from '../settings/AppearanceSection';
import { LanguageSection } from '../settings/LanguageSection';
import { ProfessionalSection } from '../settings/ProfessionalSection';
import { SettingsSection } from '../settings/SettingsSection';
import { SyncSection } from '../settings/SyncSection';
import { RADIUS } from '../theme/tokens';
import { formatDate } from '../i18n/format';
import { usePatientBaby } from './DoctorDashboardContext';
import { WhenShared } from './PatientRoute';

/** `/doctor/:babyId/growth`: the measurements and charts; she adds and edits her own. */
export function PatientGrowth() {
  const { t } = useTranslation();
  const baby = usePatientBaby();
  return (
    <WhenShared baby={baby} scope="growth" title={t('doctorDashboard.sections.growth')}>
      <Growth key={baby.id} baby={baby} heading="h1" />
    </WhenShared>
  );
}

const isActive = (prescription: Prescription) =>
  prescription.deletedAt === null && prescription.status === 'active';

function ActivePrescriptions() {
  const { t } = useTranslation();
  const baby = usePatientBaby();
  const prescriptions = useAllPrescriptions(baby.id);
  const medications = useMedications(baby.id);
  if (!prescriptions || !medications) {
    return <Skeleton variant="rounded" height={96} />;
  }
  const active = prescriptions.filter(isActive);
  const nameOf = (prescription: Prescription) =>
    medications.find((medication) => medication.id === prescription.medicationId)?.name ??
    t('doctorDashboard.summary.medications.unknownMedication');
  return (
    <Stack spacing={1.25} component="section" aria-labelledby="doctor-active-prescriptions">
      <Typography id="doctor-active-prescriptions" variant="h5" component="h2">
        {t('doctorDashboard.summary.medications.active')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('doctorDashboard.medications.prescriptionsHelp')}
      </Typography>
      {active.length === 0 ? (
        <Typography color="text.secondary">
          {t('doctorDashboard.summary.medications.noActive')}
        </Typography>
      ) : (
        <Stack component="ul" spacing={1.25} sx={{ m: 0, p: 0, listStyle: 'none' }}>
          {active.map((prescription) => (
            <Paper
              component="li"
              key={prescription.id}
              sx={{ borderRadius: `${RADIUS.card}px`, p: 2, display: 'grid', gap: 0.5 }}
            >
              <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                {nameOf(prescription)}
              </Typography>
              {summaryText(prescription) && (
                <Typography variant="body2" color="text.secondary">
                  {summaryText(prescription)}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                {prescription.endDate
                  ? t('doctorDashboard.summary.formulas.between', {
                      from: formatDate(prescription.startDate, 'dayMonthYear'),
                      to: formatDate(prescription.endDate, 'dayMonthYear'),
                    })
                  : t('doctorDashboard.summary.formulas.since', {
                      date: formatDate(prescription.startDate, 'dayMonthYear'),
                    })}
              </Typography>
              <Provenance prescription={prescription} />
            </Paper>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/**
 * `/doctor/:babyId/medications`: the baby's active prescriptions (read-only, with "Prescribed by"),
 * then her proposals with "Prescribe" (docs/design/16-doctor-access.md section 10.5).
 */
export function PatientMedications() {
  const { t } = useTranslation();
  const baby = usePatientBaby();
  return (
    <WhenShared baby={baby} scope="medications" title={t('doctorDashboard.sections.medications')}>
      <Stack spacing={3} key={baby.id}>
        <Typography variant="h4" component="h1">
          {t('doctorDashboard.sections.medications')}
        </Typography>
        <ActivePrescriptions />
        <ProposalsScreen baby={baby} heading="h2" />
      </Stack>
    </WhenShared>
  );
}

/** `/doctor/:babyId/notes`: her notes and recommendations, with the composer. */
export function PatientNotes() {
  const { t } = useTranslation();
  const baby = usePatientBaby();
  return (
    <WhenShared baby={baby} scope="notes" title={t('doctorDashboard.sections.notes')}>
      <NotesScreen key={baby.id} baby={baby} />
    </WhenShared>
  );
}

/**
 * `/doctor/settings`: what a doctor sets on her account (her professional profile, appearance,
 * language, sync). The family's settings (members, reminders, import) are never shown here.
 */
export function DoctorSettingsPage() {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const target = hash.slice(1);
  useEffect(() => {
    if (target) document.getElementById(`${target}-header`)?.scrollIntoView?.({ block: 'start' });
  }, [target]);
  return (
    <Box sx={{ maxWidth: 720 }}>
      <Stack spacing={1}>
        <Typography variant="h5" component="h1" gutterBottom>
          {t('doctorDashboard.settings.title')}
        </Typography>
        <SettingsSection
          id="professional"
          title={t('doctor.profile.sectionTitle')}
          defaultExpanded={target === '' || target === 'professional'}
        >
          <ProfessionalSection />
        </SettingsSection>
        <SettingsSection
          id="appearance"
          title={t('settings.sections.appearance')}
          defaultExpanded={target === 'appearance'}
        >
          <AppearanceSection />
        </SettingsSection>
        <SettingsSection
          id="language"
          title={t('settings.sections.language')}
          defaultExpanded={target === 'appearance' || target === 'language'}
        >
          <LanguageSection />
        </SettingsSection>
        <SettingsSection
          id="sync"
          title={t('settings.sections.sync')}
          defaultExpanded={target === 'sync'}
        >
          <SyncSection />
        </SettingsSection>
      </Stack>
    </Box>
  );
}
