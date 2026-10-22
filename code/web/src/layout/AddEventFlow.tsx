import { useState } from 'react';
import type { Baby, BabyEvent, EventType } from '../db/models';
import { EventSheet } from '../events/EventSheet';
import { typeForKey } from '../now/eventFacts';
import { MoreSheet } from '../now/ui/MoreSheet';
import type { TrayName } from '../now/ui/trays';
import { canLog } from '../baby/permissions';
import { usePresetActions } from '../presets/usePresetActions';

/** The built-in type each Now tray stands for; outside Now the full event sheet opens instead. */
const TRAY_TYPE_KEY: Readonly<Record<TrayName, string>> = {
  feed: 'feeding',
  diaper: 'diaper',
  meds: 'medication',
  bellyPain: 'belly_pain',
  more: '',
};

interface Props {
  baby: Baby;
  types: readonly EventType[];
  /** Recent events for the status lines of the More sheet. */
  events: readonly BabyEvent[];
  /** The More sheet is open. */
  open: boolean;
  onClose: () => void;
}

/**
 * Adding an event away from the Now trays (the Day tab, Insights, Settings): the More sheet, and
 * the full event sheet for the type that was picked. Quick presets (a nap, a wake-up) still log in
 * one tap through the preset actions.
 */
export function AddEventFlow({ baby, types, events, open, onClose }: Props) {
  const actions = usePresetActions(baby.id, [...types]);
  const [creating, setCreating] = useState<string | null>(null);
  const writable = canLog(baby);

  const openTray = (tray: TrayName) => {
    const key = TRAY_TYPE_KEY[tray];
    const type = key ? typeForKey([...types], key) : undefined;
    if (type) setCreating(type.id);
  };
  return (
    <>
      {open && (
        <MoreSheet
          open
          onClose={onClose}
          types={[...types]}
          events={[...events]}
          actions={actions}
          readOnly={!writable}
          onOpenTray={openTray}
          onStartNursing={() => openTray('feed')}
        />
      )}
      {creating && (
        <EventSheet
          babyId={baby.id}
          types={[...types]}
          initialTypeId={creating}
          onDone={() => setCreating(null)}
        />
      )}
      {writable && actions.elements}
    </>
  );
}
