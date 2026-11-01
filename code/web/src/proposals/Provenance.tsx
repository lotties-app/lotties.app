import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Chip, Typography } from '@mui/material';
import type { Prescription } from '../db/models';
import { EditorBody, EditorFrame, EditorHeader } from '../medications/EditorShell';
import { doctorLabel } from '../professional/doctorLabel';
import { SelfDeclaredBadge } from '../professional/DoctorName';
import { Icon } from '../ui/Icon';
import { ContentFacts } from './ContentFacts';
import { isDoctorSourced, prescriberOf } from './proposalModel';

type Provenanced = Pick<
  Prescription,
  | 'prescribedByUserId'
  | 'prescribedByName'
  | 'prescribedBy'
  | 'proposalId'
  | 'changedByParent'
  | 'original'
>;

/**
 * Where a prescription came from (docs/design/16-doctor-access.md section 10.2): "Prescribed by
 * Dr. Ana Souza" with the self-declared or verified badge, "Changed by parent" once a parent edited
 * what the doctor sent, and a link to read what she prescribed. Everyone reads it, nobody edits it;
 * nothing for a prescription the parents entered themselves.
 */
export function Provenance({ prescription }: { prescription: Provenanced }) {
  const { t } = useTranslation();
  const [reading, setReading] = useState(false);
  const doctor = prescriberOf(prescription);
  if (!isDoctorSourced(prescription) || !doctor) return null;
  const name = doctorLabel(t, doctor);
  const original = prescription.original ?? null;
  return (
    <Box sx={{ display: 'grid', gap: 0.75 }} data-testid="provenance">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        <Icon name="stethoscope" size={16} sx={{ color: 'text.secondary' }} />
        <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
          {t('proposals.provenance.prescribedBy', { doctor: name })}
        </Typography>
        <SelfDeclaredBadge verified={doctor.professional?.verified === true} />
      </Box>
      {prescription.changedByParent === true && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Chip
            size="small"
            variant="outlined"
            icon={<Icon name="edit" size={16} />}
            label={t('proposals.provenance.changedByParent')}
          />
          {original && (
            <Button size="small" onClick={() => setReading(true)} sx={{ minHeight: 40 }}>
              {t('proposals.provenance.seeOriginal', { doctor: name })}
            </Button>
          )}
        </Box>
      )}
      {reading && original && (
        <OriginalSheet doctor={name} original={original} onClose={() => setReading(false)} />
      )}
    </Box>
  );
}

/** What the doctor prescribed, read-only: the medication, the summary, the course, the instructions. */
export function OriginalSheet({
  doctor,
  original,
  onClose,
}: {
  doctor: string;
  original: NonNullable<Prescription['original']>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <EditorFrame titleId={titleId} onClose={onClose}>
      <EditorHeader
        titleId={titleId}
        title={t('proposals.provenance.originalTitle', { doctor })}
        onClose={onClose}
      />
      <EditorBody>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Icon name="pill" size={20} sx={{ color: 'text.secondary' }} />
          <Typography sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
            {original.medicationName}
          </Typography>
        </Box>
        <ContentFacts content={original} />
        <Typography variant="body2" color="text.secondary">
          {t('proposals.provenance.originalNote')}
        </Typography>
      </EditorBody>
    </EditorFrame>
  );
}
