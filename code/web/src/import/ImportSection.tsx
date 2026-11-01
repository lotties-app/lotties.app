import { useTranslation } from 'react-i18next';
import { Alert, Step, StepContent, StepLabel, Stepper, Typography } from '@mui/material';
import { canWrite } from '../baby/permissions';
import type { Baby } from '../db/models';
import { ErrorNotice } from '../settings/ErrorNotice';
import { ConfirmStep } from './ConfirmStep';
import { FilesStep } from './FilesStep';
import { MedicationsStep } from './MedicationsStep';
import { PreviewStep } from './PreviewStep';
import { ResultStep } from './ResultStep';
import { STEP, STEP_KEYS, useNapperImport, type NapperImport } from './useNapperImport';

function StepBody({ baby, flow }: { baby: Baby; flow: NapperImport }) {
  const { preview } = flow;
  switch (flow.step) {
    case STEP.files:
      return (
        <FilesStep
          files={flow.files}
          pending={flow.pending}
          onPick={(kind, file) => void flow.pickFile(kind, file)}
          onRemove={flow.removeFile}
          onPreview={() => void flow.startPreview()}
        />
      );
    case STEP.review:
      return (
        preview && (
          <PreviewStep
            preview={preview}
            onBack={() => flow.goTo(STEP.files)}
            onNext={() => flow.goTo(STEP.medications)}
          />
        )
      );
    case STEP.medications:
      return (
        <MedicationsStep
          baby={baby}
          suggestions={flow.suggestions}
          choices={flow.choices}
          problems={flow.problems}
          unmapped={flow.unmapped}
          canContinue={flow.canContinueFromMedications && !flow.hasProblems}
          pending={flow.pending}
          onChange={flow.setChoice}
          onRecheck={() => void flow.recheck()}
          onBack={() => flow.goTo(STEP.review)}
          onNext={() => flow.goTo(STEP.confirm)}
        />
      );
    case STEP.confirm:
      return (
        preview && (
          <ConfirmStep
            preview={preview}
            choices={flow.choices}
            pending={flow.pending}
            online={flow.online}
            enrichExisting={flow.enrichExisting}
            onEnrichChange={(value) => void flow.setEnrichExisting(value)}
            onBack={() => flow.goTo(STEP.medications)}
            onImport={() => void flow.runImport()}
          />
        )
      );
    default:
      return flow.result && <ResultStep result={flow.result} onReset={flow.reset} />;
  }
}

/** Napper CSV importer (Settings > Import). Parents and owners only; needs a connection. */
export function ImportSection({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const flow = useNapperImport(baby);

  if (!canWrite(baby)) {
    return <Typography color="text.secondary">{t('import.viewerBlocked')}</Typography>;
  }

  return (
    <>
      {!flow.online && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('errors.offline')}
        </Alert>
      )}
      <ErrorNotice message={flow.error} />
      <Stepper activeStep={flow.step} orientation="vertical" aria-label={t('import.stepsLabel')}>
        {STEP_KEYS.map((key) => (
          <Step key={key}>
            <StepLabel>{t(`import.steps.${key}`)}</StepLabel>
            <StepContent>
              <StepBody baby={baby} flow={flow} />
            </StepContent>
          </Step>
        ))}
      </Stepper>
    </>
  );
}
