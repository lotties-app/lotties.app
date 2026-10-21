import { useTranslation } from 'react-i18next';
import { Typography } from '@mui/material';
import { eventTypeText, humanizeCode } from '../i18n/eventTypeText';
import { formatNumber } from '../i18n/format';
import type { NapperEnrichedField } from '../sync/contract';

const SLEEP = { key: 'sleep', babyId: null } as const;

/** "Where and how (12), Waking up (9)": the detail fields an enrich fills, by their labels. */
function enrichedFieldsText(fields: readonly NapperEnrichedField[]): string {
  return fields
    .map(
      (f) =>
        `${eventTypeText.fieldLabel(SLEEP, { key: f.field, label: humanizeCode(f.field) })} (${formatNumber(f.count)})`,
    )
    .join(', ');
}

/**
 * What "Enrich existing events" did or would do: how many events got missing details and which
 * fields were filled. Nothing when the option was off or nothing matched.
 */
export function EnrichSummary({
  count,
  fields,
  done,
}: {
  count: number | undefined;
  fields: readonly NapperEnrichedField[] | undefined;
  /** `true` in the result (past tense), `false` in the preview. */
  done: boolean;
}) {
  const { t } = useTranslation();
  if (!count || count <= 0) return null;
  return (
    <Typography variant="body2" data-testid="enrich-summary">
      {t(done ? 'import.enrich.done' : 'import.enrich.would', { count })}
      {fields &&
        fields.length > 0 &&
        ` ${t('import.enrich.fields', { fields: enrichedFieldsText(fields) })}`}
    </Typography>
  );
}
