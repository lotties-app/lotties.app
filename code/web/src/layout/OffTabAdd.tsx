import { useState } from 'react';
import { useEventsStartedSince, useEventTypes } from '../db/hooks';
import type { Baby } from '../db/models';
import { AddEventFlow } from './AddEventFlow';
import { useAddRequests } from './addSheetContext';

const DAY_MS = 86_400_000;

/**
 * The "+" on tabs that have no add flow of their own (Insights, Settings): opens the More sheet
 * over the page. Now and Day listen to the same request themselves.
 */
export function OffTabAdd({ baby }: { baby: Baby }) {
  const [open, setOpen] = useState(false);
  useAddRequests(() => setOpen(true));
  const types = useEventTypes(baby.id);
  // Rounded to the hour so the live query does not restart every render.
  const [since] = useState(() =>
    new Date(Math.floor((Date.now() - 3 * DAY_MS) / 3_600_000) * 3_600_000).toISOString(),
  );
  const events = useEventsStartedSince(baby.id, since);
  if (!types) return null;
  return (
    <AddEventFlow
      baby={baby}
      types={types}
      events={events ?? []}
      open={open}
      onClose={() => setOpen(false)}
    />
  );
}
