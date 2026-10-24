import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Stack, Typography } from '@mui/material';
import { useAgeNorms } from '../../ageNorms/useAgeNorms';
import { canLog, canPropose, canSeeAppointments, canWrite, isOwner } from '../../baby/permissions';
import { NextAppointment } from '../../appointments/NextAppointmentCard';
import { VaccinesDue } from '../../vaccines/VaccinesDueCard';
import { useOldestEventStart } from '../../db/hooks';
import type { Baby, Prescription } from '../../db/models';
import { EventSheet } from '../../events/EventSheet';
import { PrescriptionSheet } from '../../medications/PrescriptionSheet';
import { canRemind } from '../../medications/prescriptionForm';
import { DoctorInbox } from '../../proposals/DoctorInbox';
import { useNotificationLink } from '../../notifications/notificationLinkContext';
import type { NotificationLink } from '../../pwa/sw/deepLink';
import { ReminderPromptCard } from '../../notifications/ui/ReminderPromptCard';
import { tileStateLine } from '../../medications/statusText';
import type { SheetPrefill } from '../../presets/actions';
import { useClaimInlineTimers } from '../../timers/inlineTimers';
import { useAddRequests } from '../../layout/addSheetContext';
import { usePresetActions } from '../../presets/usePresetActions';
import { usePredictions } from '../../predictions/usePredictions';
import { useNightFeed } from '../../theme/NightFeedContext';
import { presetsForBaby } from '../../presets/resolve';
import { BELLY_MASSAGE_KEY } from '../bellyPattern';
import { useOfferCatchUp } from '../catchUpSlot';
import type { CryCause } from '../cryReasons';
import { typeForKey } from '../eventFacts';
import { formatTileStatus, sleepActionLabel } from '../nowText';
import { changesRunningSleep, runningSleepLock, type SleepActionKind } from '../sleepToggle';
import type { MedicationEntry, TileId, TrayChoice } from '../quickLog';
import { QuickLogToastProvider } from '../QuickLogToastProvider';
import { tileDetailText } from '../tileText';
import { todayStats } from '../todayStats';
import { useNowScreen, type NowScreenModel } from '../useNow';
import { BellyPainSuggestion } from './BellyPainCard';
import { BellyPainTraySheet } from './BellyPainTraySheet';
import {
  CryReasonsButton,
  CryReasonsSheet,
  type CryAnswerChoice,
  type CryShortcut,
} from './CryReasonsSheet';
import { DiaperSuggestions } from './DiaperCard';
import { DiaperTraySheet } from './DiaperTraySheet';
import { FeedTraySheet } from './FeedTraySheet';
import { FirstRun } from './FirstRun';
import { FussyPatternSuggestion } from './FussyPatternCard';
import { LogTiles } from './LogTiles';
import { MedsTraySheet, type TrayReminder } from './MedsTraySheet';
import { MoreSheet } from './MoreSheet';
import { NightNow } from './NightNow';
import { NightStars } from './NightStars';
import { NowSkeleton } from './NowSkeleton';
import { OvertiredSuggestionCard } from './OvertiredCard';
import { RunningNow } from './RunningNow';
import { StateCard } from './StateCard';
import { ToastHost } from './ToastHost';
import { TodayStrip } from './TodayStrip';
import type { TrayName } from './trays';
import { useNowAction } from './useNowAction';

const HOUR_MS = 3_600_000;

/** Visually hidden but read by screen readers: the page heading. */
const HIDDEN = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

/** The "Still going" snooze of forgotten timers: hidden for an hour, per timer, until reload. */
function useSnooze(now: Date) {
  const [until, setUntil] = useState<Record<string, number>>({});
  return {
    isSnoozed: (id: string) => (until[id] ?? 0) > now.getTime(),
    keep: (id: string) => setUntil((previous) => ({ ...previous, [id]: Date.now() + HOUR_MS })),
  };
}

/**
 * A dose reminder tapped for this baby opens the Meds tray with its reminder line; a nap reminder
 * just shows Now. Opening never logs or confirms anything.
 */
function useReminderLink(babyId: string, canOpenMeds: boolean, openMeds: () => void) {
  const links = useNotificationLink();
  const [reminder, setReminder] = useState<TrayReminder | null>(null);
  const link = links?.link ?? null;
  const [handled, setHandled] = useState<NotificationLink | null>(null);
  // An appointment reminder belongs to the calendar page, a doctor suggestion to "From your
  // doctor" and a vaccine reminder to the vaccines page; each consumes its own link there.
  const mine =
    link &&
    link.babyId === babyId &&
    link.kind !== 'appt' &&
    link.kind !== 'doctor' &&
    link.kind !== 'vaccine'
      ? link
      : null;
  // Adjusted while rendering (not in an effect): the tray opens in the same render pass.
  if (mine && mine !== handled) {
    setHandled(mine);
    if (mine.kind === 'dose' && canOpenMeds) {
      setReminder({
        rxId: mine.rxId,
        deliveryId: mine.deliveryId,
        ...(mine.token !== undefined ? { token: mine.token } : {}),
      });
      openMeds();
    }
  }
  useEffect(() => {
    if (mine) links?.consume();
  }, [mine, links]);
  return { reminder, clear: () => setReminder(null) };
}

/** Predictions go stale when the state flips: ask again after a sleep starts or ends. */
function useRefreshPredictions(babyId: string, model: NowScreenModel) {
  const queryClient = useQueryClient();
  const state = model.state;
  const signature = state.kind === 'unknown' ? 'unknown' : `${state.kind}:${state.since}`;
  const previous = useRef(signature);
  useEffect(() => {
    if (previous.current === signature) return;
    previous.current = signature;
    void queryClient.invalidateQueries({ queryKey: ['predictions', babyId] });
  }, [signature, babyId, queryClient]);
}

function NowContent({
  baby,
  model,
  hasEvents,
}: {
  baby: Baby;
  model: NowScreenModel;
  hasEvents: boolean;
}) {
  const { t } = useTranslation();
  const night = useNightFeed().active;
  const action = useNowAction();
  const actions = usePresetActions(baby.id, model.types);
  const snooze = useSnooze(model.now);
  const predictions = usePredictions(baby.id).query.data;
  const ageNorms = useAgeNorms();
  const [tray, setTray] = useState<TrayName | null>(null);
  const [solid, setSolid] = useState<SheetPrefill | null>(null);
  const [addingPrescription, setAddingPrescription] = useState(false);
  const [proposingChange, setProposingChange] = useState<Prescription | null>(null);
  const proposing = canPropose(baby);
  const [offeringReminders, setOfferingReminders] = useState(false);
  const reminderLink = useReminderLink(baby.id, !!model.trays.meds, () => setTray('meds'));
  useRefreshPredictions(baby.id, model);
  // "Since you last looked" lives behind the header button (CatchUpButton), offered on the day
  // view only, as the inline card was.
  const catchUpOffer = useMemo(
    () =>
      !night && hasEvents && model.catchUp
        ? {
            babyId: baby.id,
            babyName: baby.name,
            catchUp: model.catchUp,
            types: model.types,
            acknowledge: model.acknowledgeCatchUp,
          }
        : null,
    [night, hasEvents, baby.id, baby.name, model.catchUp, model.types, model.acknowledgeCatchUp],
  );
  useOfferCatchUp(catchUpOffer);
  // The "+" of the bottom navigation opens the More sheet here (viewers have no "+").
  useAddRequests(() => {
    if (!model.readOnly) setTray('more');
  });

  const feedTile = model.tiles.find((tile) => tile.id === 'feed');
  const sleepPrediction = predictions?.predictions.find((p) => p.typeKey === 'sleep');
  const stats = useMemo(
    () => todayStats(model.events, model.types, model.now),
    [model.events, model.types, model.now],
  );
  const disabled = model.readOnly;
  /** "Running now": every running timer, first on the page (large targets at night). */
  const running = (large: boolean) => (
    <RunningNow
      babyId={baby.id}
      model={model}
      actions={actions}
      action={action}
      isSnoozed={snooze.isSnoozed}
      onKeepRunning={snooze.keep}
      large={large}
    />
  );

  const close = () => {
    setTray(null);
    reminderLink.clear();
  };
  const choose = (choice: TrayChoice) => {
    close();
    void action.run(() => model.commands.tray(choice));
  };
  const runSleep = (kind: SleepActionKind) =>
    void action.run(() =>
      model.commands.sleep(
        kind,
        model.state.kind === 'asleep' ? undefined : model.state.sleepKindHint,
      ),
    );
  /** "Why is she crying?" is for those who log (never Viewers nor the Doctor). */
  const cryOpen = canLog(baby) ? () => setTray('cry') : null;
  const cryEntry = cryOpen && <CryReasonsButton onClick={cryOpen} />;
  const cryShortcuts = (): Partial<Record<CryCause, CryShortcut>> => {
    const shortcuts: Partial<Record<CryCause, CryShortcut>> = {};
    if (model.trays.feed) {
      shortcuts.hunger = {
        label: t('cryReasons.suggests.shortcuts.hunger'),
        run: () => setTray('feed'),
      };
    }
    if (model.trays.diaper) {
      shortcuts.diaper = {
        label: t('cryReasons.suggests.shortcuts.diaper'),
        run: () => setTray('diaper'),
      };
    }
    const sleepLock = runningSleepLock(
      model.running,
      typeForKey(model.types, 'sleep')?.id,
      model.access.controlLockedBy,
    );
    const sleep = model.sleepActions.find(
      (a) =>
        (a.kind === 'fell_asleep' || a.kind === 'back_asleep') &&
        !(sleepLock !== null && changesRunningSleep(a.kind)),
    );
    if (sleep) {
      shortcuts.sleepy = {
        label: sleepActionLabel(sleep.kind),
        run: () => {
          close();
          runSleep(sleep.kind);
        },
      };
    }
    const massage = presetsForBaby(model.types).find((preset) => preset.id === BELLY_MASSAGE_KEY);
    if (massage && !model.running.some((e) => e.typeId === massage.typeId)) {
      shortcuts.gas = {
        label: t('cryReasons.suggests.shortcuts.gas'),
        run: () => {
          close();
          void actions.run(massage);
        },
      };
    }
    return shortcuts;
  };
  const answerCry = (answer: CryAnswerChoice) => {
    close();
    void action.run(() =>
      model.commands.crySpell({
        ...answer,
        canChange: model.access.canChange,
        canControl: (event) => model.access.controlLockedBy(event) === null,
      }),
    );
  };
  const openTile = (id: TileId) => setTray(id);
  const openDiaperTray = () => setTray('diaper');
  const feedSubtitle = feedTile
    ? [formatTileStatus(feedTile, model.now), tileDetailText(feedTile, model.types)]
        .filter(Boolean)
        .join(' · ')
    : '';

  const medsLine = tileStateLine(
    model.meds.statuses.map((status) => ({
      status,
      name: model.medications.find((m) => m.id === status.prescription.medicationId)?.name ?? '',
    })),
    model.now,
  );

  const medsChosen = (medications: MedicationEntry[]) =>
    choose({ kind: 'medication', medications });

  if (model.types.length === 0) {
    // Event types arrive with the first sync; until then there is nothing to log.
    return (
      <Stack spacing={2}>
        <Box component="h1" sx={HIDDEN}>
          {t('nav.now')}
        </Box>
        <Typography color="text.secondary">{t('home.noTypes')}</Typography>
      </Stack>
    );
  }

  return (
    <Stack spacing={2}>
      <Box component="h1" sx={HIDDEN}>
        {t('nav.now')}
      </Box>
      {model.readOnly && <Alert severity="info">{t('baby.viewerNotice')}</Alert>}
      {action.error && (
        <Alert severity="error" onClose={action.clearError}>
          {action.error}
        </Alert>
      )}
      {offeringReminders && !model.readOnly && (
        <ReminderPromptCard baby={baby} onClose={() => setOfferingReminders(false)} />
      )}

      {night ? (
        <NightNow
          model={model}
          babyName={baby.name}
          action={action}
          running={running(true)}
          onOpenFeed={() => setTray('feed')}
          onOpenDiaper={() => setTray('diaper')}
          cryEntry={cryEntry}
        />
      ) : !hasEvents ? (
        <>
          <DoctorInbox baby={baby} />
          <FirstRun
            babyName={baby.name}
            readOnly={model.readOnly}
            canImport={canWrite(baby)}
            canInvite={isOwner(baby)}
            disabled={disabled}
            onFellAsleep={() => runSleep('fell_asleep')}
            onFeed={() => setTray('feed')}
          />
        </>
      ) : (
        <>
          {running(false)}
          <LogTiles
            tiles={model.tiles}
            types={model.types}
            now={model.now}
            readOnly={model.readOnly}
            medsLine={medsLine}
            viewable={proposing && model.trays.meds ? ['meds'] : []}
            onOpen={openTile}
          />
          {cryEntry}
          <StateCard
            model={model}
            babyId={baby.id}
            babyName={baby.name}
            action={action}
            {...(sleepPrediction ? { prediction: sleepPrediction } : {})}
            bedTime={predictions?.bedTime ?? null}
            {...(predictions ? { predictions } : {})}
            birthDate={baby.birthDate}
            ageNorms={ageNorms ?? null}
          />
          <DoctorInbox baby={baby} />
          <OvertiredSuggestionCard
            babyId={baby.id}
            model={model}
            predictions={predictions}
            actions={actions}
          />
          <BellyPainSuggestion
            babyId={baby.id}
            model={model}
            predictions={predictions}
            actions={actions}
          />
          <FussyPatternSuggestion babyId={baby.id} model={model} predictions={predictions} />
          <DiaperSuggestions
            babyId={baby.id}
            model={model}
            predictions={predictions}
            {...(model.trays.diaper ? { onLogDiaper: openDiaperTray } : {})}
          />
          {canSeeAppointments(baby) && (
            <NextAppointment babyId={baby.id} now={model.now.getTime()} />
          )}
          <VaccinesDue baby={baby} now={model.now.getTime()} />
          <TodayStrip stats={stats} />
        </>
      )}

      {tray === 'feed' && model.trays.feed && (
        <FeedTraySheet
          open
          onClose={close}
          tray={model.trays.feed}
          type={typeForKey(model.types, 'feeding')}
          subtitle={feedSubtitle}
          disabled={disabled}
          onBottle={(amountMl, content, drunkMl) =>
            choose({ kind: 'bottle', amountMl, content, ...(drunkMl !== null ? { drunkMl } : {}) })
          }
          onBreast={(side) => choose({ kind: 'breast', side })}
          onSolid={() => {
            close();
            setSolid(model.trays.feed?.solid ?? null);
          }}
        />
      )}
      {tray === 'diaper' && model.trays.diaper && (
        <DiaperTraySheet
          open
          onClose={close}
          tray={model.trays.diaper}
          types={model.types}
          disabled={disabled}
          onChoose={(content) => choose({ kind: 'diaper', content })}
        />
      )}
      {tray === 'meds' && model.trays.meds && (
        <MedsTraySheet
          open
          onClose={close}
          tray={model.trays.meds}
          now={model.now}
          disabled={disabled}
          onChoose={medsChosen}
          {...(reminderLink.reminder ? { reminder: reminderLink.reminder } : {})}
          {...(canWrite(baby)
            ? {
                onAddPrescription: () => {
                  close();
                  setAddingPrescription(true);
                },
              }
            : {})}
          {...(proposing
            ? {
                onProposeChange: (prescription: Prescription) => {
                  close();
                  setProposingChange(prescription);
                },
              }
            : {})}
        />
      )}
      {tray === 'bellyPain' && model.trays.bellyPain && (
        <BellyPainTraySheet
          open
          onClose={close}
          tray={model.trays.bellyPain}
          disabled={disabled}
          onChoose={(intensity) => choose({ kind: 'belly_pain', intensity })}
        />
      )}
      {tray === 'more' && (
        <MoreSheet
          open
          onClose={close}
          babyId={baby.id}
          userId={baby.userId}
          types={model.types}
          events={model.events}
          actions={actions}
          readOnly={model.readOnly}
          onOpenTray={setTray}
          onStartNursing={() => void action.run(() => model.commands.startNursing())}
          {...(cryOpen ? { onCryReasons: cryOpen } : {})}
        />
      )}
      {tray === 'cry' && cryOpen && (
        <CryReasonsSheet
          open
          onClose={close}
          babyId={baby.id}
          birthDate={baby.birthDate}
          events={model.events}
          types={model.types}
          predictions={predictions}
          ageNorms={ageNorms ?? null}
          shortcuts={cryShortcuts()}
          onAnswer={answerCry}
        />
      )}
      {solid && !model.readOnly && (
        <EventSheet
          babyId={baby.id}
          types={model.types}
          prefill={solid}
          onDone={() => setSolid(null)}
        />
      )}
      {proposingChange && proposing && (
        <PrescriptionSheet
          mode="proposal"
          babyId={baby.id}
          authorUserId={baby.userId ?? null}
          replaces={proposingChange}
          onDone={() => setProposingChange(null)}
        />
      )}
      {addingPrescription && canWrite(baby) && (
        <PrescriptionSheet
          babyId={baby.id}
          onSaved={(terms) => setOfferingReminders(canRemind(terms))}
          onDone={() => setAddingPrescription(false)}
        />
      )}
      {!model.readOnly && actions.elements}
    </Stack>
  );
}

function NowScreenBody({ baby }: { baby: Baby }) {
  const model = useNowScreen(baby);
  const oldest = useOldestEventStart(baby.id);
  if (!model || oldest === undefined) return <NowSkeleton />;
  return <NowContent baby={baby} model={model} hasEvents={oldest !== null} />;
}

/**
 * The Now screen of one baby (docs/design/01-ux-strategy.md "A. Now dashboard", docs/DESIGN.md
 * "Now"), what you act on first: "Running now" (every running timer as a card), "Quick log" (the
 * tiles with their trays), the compact state card with the sleep toggle and the folded day ring,
 * then the hand-over, suggestion and pattern cards and the Today strip; the simple night layout
 * in the night scheme. The floating mini timer bar stays away here (`useClaimInlineTimers`).
 * Mount with `key={baby.id}`.
 */
export function NowScreen({ baby }: { baby: Baby }) {
  useClaimInlineTimers();
  return (
    <QuickLogToastProvider>
      {/* A stacking context of its own, so the night stars can sit behind the content. */}
      <Box sx={{ position: 'relative', zIndex: 0, isolation: 'isolate' }}>
        <NightStars />
        <NowScreenBody baby={baby} />
      </Box>
      <ToastHost />
    </QuickLogToastProvider>
  );
}
