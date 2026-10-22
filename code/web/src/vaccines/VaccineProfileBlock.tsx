import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { ApiClientContext } from '../api/ApiClientContext';
import { useDatabase } from '../db/DatabaseContext';
import type { Baby, RsvMaternalAnswer } from '../db/models';
import { formatAge, formatDate } from '../i18n/format';
import { ErrorNotice } from '../settings/ErrorNotice';
import { useServerAction } from '../settings/useServerAction';
import type { VaccineProfileRequest } from '../sync/contract';
import { RADIUS } from '../theme/tokens';
import { Field, NumberStepper, SegmentedControl, SwitchRow } from '../ui/form';
import { saveVaccineProfile } from './vaccineProfileApi';
import { hasBirthDate, profileOf } from './vaccineModel';
import { TERM_WEEKS } from './vaccineStatus';

/** The weeks a baby born before term can have (the server accepts 20 to 44). */
const PREMATURE_MIN_WEEKS = 20;
const PREMATURE_MAX_WEEKS = TERM_WEEKS - 1;

const RSV_ANSWERS: readonly RsvMaternalAnswer[] = ['yes', 'no', 'unknown'];

interface Draft {
  premature: boolean;
  weeks: number;
  rsv: RsvMaternalAnswer | null;
  withPrivate: boolean;
}

function draftOf(baby: Baby): Draft {
  const profile = profileOf(baby);
  const weeks = profile.gestationalAgeWeeks;
  const premature = weeks !== null && weeks < TERM_WEEKS;
  return {
    premature,
    weeks: premature ? weeks : PREMATURE_MAX_WEEKS,
    rsv: profile.rsvMaternalVaccination,
    withPrivate: profile.coverage === 'public+private',
  };
}

/** The full state to send: a stored term-or-later week count is kept unless the user said "premature". */
function requestOf(baby: Baby, draft: Draft): VaccineProfileRequest {
  const stored = baby.gestationalAgeWeeks ?? null;
  return {
    vaccineProfile: draft.withPrivate ? 'public+private' : 'public',
    gestationalAgeWeeks: draft.premature
      ? draft.weeks
      : stored !== null && stored >= TERM_WEEKS
        ? stored
        : null,
    rsvMaternalVaccination: draft.rsv,
  };
}

function sameProfile(baby: Baby, request: VaccineProfileRequest): boolean {
  const profile = profileOf(baby);
  return (
    profile.coverage === request.vaccineProfile &&
    profile.gestationalAgeWeeks === request.gestationalAgeWeeks &&
    profile.rsvMaternalVaccination === request.rsvMaternalVaccination
  );
}

const panelSx = {
  display: 'grid',
  gap: 2,
  p: 2,
  borderRadius: `${RADIUS.card}px`,
  backgroundColor: 'background.paper',
} as const;

/** What a member who cannot change the profile reads. */
function ProfileSummary({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const profile = profileOf(baby);
  const weeks = profile.gestationalAgeWeeks;
  const answer = profile.rsvMaternalVaccination;
  const lines = [
    t(
      profile.coverage === 'public'
        ? 'vaccines.profile.summary.public'
        : 'vaccines.profile.summary.withPrivate',
    ),
    weeks !== null && weeks < TERM_WEEKS
      ? t('vaccines.profile.summary.premature', { weeks })
      : null,
    answer
      ? t('vaccines.profile.summary.rsv', { answer: t(`vaccines.profile.rsvAnswers.${answer}`) })
      : null,
  ].filter((line): line is string => line !== null);
  return (
    <Stack component="ul" spacing={0.5} sx={{ m: 0, p: 0, listStyle: 'none' }}>
      {lines.map((line) => (
        <Typography key={line} component="li" variant="body2" color="text.secondary">
          {line}
        </Typography>
      ))}
    </Stack>
  );
}

/**
 * "About this baby": the birth date and the answers the schedule depends on (born before 37 weeks,
 * the mother's RSV vaccine, private clinic recommendations). Owners and Parents edit them and save
 * with one button (`PUT /babies/{id}/vaccine-profile`, online); everybody else reads them.
 */
export function VaccineProfileBlock({
  baby,
  writable,
  now,
}: {
  baby: Baby;
  writable: boolean;
  /** The clock for the age line (tests and previews). */
  now: Date;
}) {
  const { t } = useTranslation();
  const api = useContext(ApiClientContext);
  const db = useDatabase();
  const save = useServerAction();
  const [draft, setDraft] = useState<Draft>(() => draftOf(baby));
  const [saved, setSaved] = useState(false);
  const request = requestOf(baby, draft);
  const dirty = !sameProfile(baby, request);
  const change = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaved(false);
  };

  const submit = async () => {
    if (!api) return;
    const done = await save.run(() => saveVaccineProfile(api, db, baby.id, request));
    if (done) setSaved(true);
  };

  return (
    <Box component="section" aria-labelledby="vaccine-profile-title" sx={panelSx}>
      <Typography id="vaccine-profile-title" variant="h6" component="h2">
        {t('vaccines.profile.title')}
      </Typography>
      <Box>
        <Typography variant="caption" color="text.secondary" component="p">
          {t('vaccines.profile.birthDate')}
        </Typography>
        <Typography>
          {hasBirthDate(baby)
            ? t('vaccines.profile.born', {
                date: formatDate(baby.birthDate),
                age: formatAge(baby.birthDate, now),
              })
            : '—'}
        </Typography>
      </Box>
      {writable ? (
        <>
          <SwitchRow
            checked={draft.premature}
            onChange={(premature) => change({ premature })}
            label={t('vaccines.profile.premature')}
          />
          {draft.premature && (
            <Field label={t('vaccines.profile.weeks')}>
              <NumberStepper
                value={draft.weeks}
                onChange={(weeks) => change({ weeks: weeks ?? PREMATURE_MAX_WEEKS })}
                step={1}
                min={PREMATURE_MIN_WEEKS}
                max={PREMATURE_MAX_WEEKS}
                start={PREMATURE_MAX_WEEKS}
                unit={t('vaccines.profile.weeksUnit')}
              />
            </Field>
          )}
          <Field label={t('vaccines.profile.rsv')} group>
            <SegmentedControl<RsvMaternalAnswer>
              value={draft.rsv}
              onChange={(rsv) => change({ rsv })}
              options={RSV_ANSWERS.map((answer) => ({
                value: answer,
                label: t(`vaccines.profile.rsvAnswers.${answer}`),
              }))}
            />
          </Field>
          <SwitchRow
            checked={draft.withPrivate}
            onChange={(withPrivate) => change({ withPrivate })}
            label={t('vaccines.profile.private')}
            description={t('vaccines.profile.privateHelp')}
          />
          {!save.online && <Alert severity="warning">{t('errors.offline')}</Alert>}
          <ErrorNotice message={save.error} />
          {dirty && (
            <Button
              variant="contained"
              disabled={!save.online || save.pending || !api}
              onClick={() => void submit()}
              sx={{ minHeight: 48, borderRadius: '999px' }}
            >
              {t('vaccines.profile.save')}
            </Button>
          )}
          {saved && !dirty && (
            <Typography role="status" variant="body2" color="text.secondary">
              {t('vaccines.profile.saved')}
            </Typography>
          )}
        </>
      ) : (
        <ProfileSummary baby={baby} />
      )}
    </Box>
  );
}
