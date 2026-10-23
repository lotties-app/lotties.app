import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, Navigate, useLocation } from 'react-router-dom';
import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import type { Baby } from '../db/models';
import { CreditsContent } from '../credits/CreditsContent';
import { AboutScreen } from '../hub/AboutScreen';
import { UpdatesScreen } from '../hub/UpdatesScreen';
import { canSeeFamilyRecords, canWrite } from '../baby/permissions';
import { ProvidersScreen } from '../providers/ProvidersScreen';
import { FormulasSection } from '../settings/FormulasSection';
import { MedicationsSection } from '../settings/MedicationsSection';
import { MembersSection } from '../settings/MembersSection';
import { Icon } from '../ui/Icon';

// The importers are only needed when their page is opened, so they load on demand.
const ExportSection = lazy(() =>
  import('../backup/ExportSection').then((m) => ({ default: m.ExportSection })),
);
const ImportBackupSection = lazy(() =>
  import('../backup/ImportBackupSection').then((m) => ({ default: m.ImportBackupSection })),
);
const ImportSection = lazy(() =>
  import('../import/ImportSection').then((m) => ({ default: m.ImportSection })),
);

/** A page opened from the Hub: a way back, the page title as the one h1, then the content. */
function HubSubPage({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <Stack spacing={2}>
      <Button
        component={RouterLink}
        to="/hub"
        startIcon={<Icon name="arrow-left" size={20} />}
        sx={{ alignSelf: 'flex-start', minHeight: 44 }}
      >
        {t('hub.back')}
      </Button>
      <Typography variant="h5" component="h1">
        {title}
      </Typography>
      {children}
    </Stack>
  );
}

/** A Hub sub-page about the selected baby: waits for the babies, and asks for one when there is none. */
function BabyPage({ title, children }: { title: string; children: (baby: Baby) => ReactNode }) {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  if (!babies) return <CircularProgress aria-label={t('common.loading')} />;
  return (
    <HubSubPage title={title}>
      {baby ? children(baby) : <Alert severity="info">{t('settings.createBabyFirst')}</Alert>}
    </HubSubPage>
  );
}

export function HubMedicinesPage() {
  const { t } = useTranslation();
  return (
    <BabyPage title={t('hub.entries.medicines.title')}>
      {(baby) => <MedicationsSection baby={baby} />}
    </BabyPage>
  );
}

/** "Doctors and clinics": the baby's directory of care providers. A Doctor never sees it. */
export function HubProvidersPage() {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  if (babies && baby && !canSeeFamilyRecords(baby)) return <Navigate to="/patients" replace />;
  return (
    <BabyPage title={t('hub.entries.providers.title')}>
      {(current) => <ProvidersScreen key={current.id} baby={current} />}
    </BabyPage>
  );
}

export function HubFormulasPage() {
  const { t } = useTranslation();
  return (
    <BabyPage title={t('hub.entries.formulas.title')}>
      {(baby) => <FormulasSection baby={baby} />}
    </BabyPage>
  );
}

/** Members, invites and the doctor access log; `#invite` and `#doctor-access` scroll to their part. */
export function HubFamilyPage() {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const { baby } = useSelectedBaby();
  const target = hash.slice(1);
  useEffect(() => {
    if (target) document.getElementById(target)?.scrollIntoView?.({ block: 'start' });
  }, [target, baby]);
  return (
    <BabyPage title={t('hub.entries.members.title')}>
      {(current) => <MembersSection baby={current} />}
    </BabyPage>
  );
}

export function HubImportPage() {
  const { t } = useTranslation();
  return (
    <BabyPage title={t('hub.entries.import.title')}>
      {(baby) => (
        <Suspense fallback={<CircularProgress aria-label={t('common.loading')} />}>
          <ImportSection baby={baby} />
        </Suspense>
      )}
    </BabyPage>
  );
}

/** "Export data": the baby's backup file. Owners and Parents only. */
export function HubExportPage() {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  if (babies && baby && !canWrite(baby)) return <Navigate to="/hub" replace />;
  return (
    <BabyPage title={t('hub.entries.export.title')}>
      {(current) => (
        <Suspense fallback={<CircularProgress aria-label={t('common.loading')} />}>
          <ExportSection key={current.id} baby={current} />
        </Suspense>
      )}
    </BabyPage>
  );
}

/** "Import backup": a file this app exported, into a new baby or the selected one. */
export function HubBackupImportPage() {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  return (
    <HubSubPage title={t('hub.entries.backupImport.title')}>
      {babies ? (
        <Suspense fallback={<CircularProgress aria-label={t('common.loading')} />}>
          <ImportBackupSection key={baby?.id} baby={baby} />
        </Suspense>
      ) : (
        <CircularProgress aria-label={t('common.loading')} />
      )}
    </HubSubPage>
  );
}

export function HubUpdatesPage() {
  const { t } = useTranslation();
  return (
    <HubSubPage title={t('hub.updates.title')}>
      <UpdatesScreen />
    </HubSubPage>
  );
}

export function HubAboutPage() {
  const { t } = useTranslation();
  return (
    <HubSubPage title={t('hub.about.title')}>
      <AboutScreen />
    </HubSubPage>
  );
}

/** Hub > App > Credits and licenses: the same content as the public /credits page, inside the shell. */
export function HubCreditsPage() {
  const { t } = useTranslation();
  return (
    <HubSubPage title={t('credits.title')}>
      <CreditsContent />
    </HubSubPage>
  );
}
