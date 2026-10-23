import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  ButtonBase,
  IconButton,
  InputAdornment,
  Popover,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { BabyAvatar } from '../baby/BabyAvatar';
import type { Baby } from '../db/models';
import { palette } from '../ui/form/styles';
import { Icon } from '../ui/Icon';
import { clinicalAge } from './clinicalAge';
import { readDashboardState } from './dashboardStorage';
import type { DoctorPatient } from './doctorApi';
import { useDoctorDashboard } from './DoctorDashboardContext';
import { neighbours, useSwitchPatient } from './navModel';
import { matchesName } from './useDoctorData';

interface Group {
  id: string;
  label: string | null;
  patients: DoctorPatient[];
}

/** The searchable list: recent patients and all patients, or the matches of a search. */
function groupsOf(
  patients: readonly DoctorPatient[],
  search: string,
  labels: { recent: string; all: string },
): Group[] {
  if (search.trim()) {
    return [
      { id: 'matches', label: null, patients: patients.filter((p) => matchesName(p.name, search)) },
    ];
  }
  const byId = new Map(patients.map((patient) => [patient.babyId, patient]));
  const recents = readDashboardState()
    .recents.map((id) => byId.get(id))
    .filter((patient): patient is DoctorPatient => !!patient);
  return [
    ...(recents.length > 0 ? [{ id: 'recent', label: labels.recent, patients: recents }] : []),
    { id: 'all', label: labels.all, patients: [...patients] },
  ];
}

function PatientOption({
  id,
  patient,
  active,
  current,
  now,
  onPick,
}: {
  id: string;
  patient: DoctorPatient;
  active: boolean;
  current: boolean;
  now: Date;
  onPick: () => void;
}) {
  return (
    <Box
      id={id}
      role="option"
      aria-selected={active}
      aria-current={current ? 'true' : undefined}
      onClick={onPick}
      onMouseDown={(event) => event.preventDefault()}
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        minHeight: 48,
        px: 1.5,
        py: 0.75,
        borderRadius: 2,
        cursor: 'pointer',
        backgroundColor: active
          ? `color-mix(in srgb, ${palette(theme).primary.main} 14%, transparent)`
          : 'transparent',
        '&:hover': {
          backgroundColor: `color-mix(in srgb, ${palette(theme).primary.main} 10%, transparent)`,
        },
      })}
    >
      <BabyAvatar id={patient.babyId} name={patient.name} size={32} />
      <Stack sx={{ minWidth: 0, flex: 1 }}>
        <Typography noWrap sx={{ fontWeight: current ? 650 : 500 }}>
          {patient.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {clinicalAge(patient.birthDate, now)}
        </Typography>
      </Stack>
      {current && <Icon name="check" size={20} />}
    </Box>
  );
}

function SwitcherPanel({
  babyId,
  onPick,
}: {
  babyId: string;
  onPick: (patientId: string) => void;
}) {
  const { t } = useTranslation();
  const { patients } = useDoctorDashboard();
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const now = useMemo(() => new Date(), []);
  const inputRef = useRef<HTMLInputElement>(null);
  // The search field takes the focus when the list opens (the popover itself does not).
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const groups = groupsOf(patients ?? [], search, {
    recent: t('doctorDashboard.switcher.recent'),
    all: t('doctorDashboard.switcher.all'),
  });
  const options = groups
    .flatMap((group) => group.patients.map((patient) => ({ group: group.id, patient })))
    .map((option, position) => ({ ...option, position }));
  const optionId = (index: number) => `${listId}-option-${index}`;
  const clamped = Math.min(active, Math.max(0, options.length - 1));

  const onKeyDown = (event: KeyboardEvent) => {
    const last = options.length - 1;
    if (event.key === 'ArrowDown') setActive(clamped >= last ? 0 : clamped + 1);
    else if (event.key === 'ArrowUp') setActive(clamped <= 0 ? last : clamped - 1);
    else if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(last);
    else if (event.key === 'Enter' && options[clamped]) onPick(options[clamped].patient.babyId);
    else return;
    event.preventDefault();
  };

  const rendered: ReactNode[] = groups.map((group) => {
    const headingId = `${listId}-${group.id}`;
    const items = options
      .filter((option) => option.group === group.id)
      .map(({ patient, position }) => (
        <PatientOption
          key={`${group.id}-${patient.babyId}`}
          id={optionId(position)}
          patient={patient}
          active={position === clamped}
          current={patient.babyId === babyId}
          now={now}
          onPick={() => onPick(patient.babyId)}
        />
      ));
    return (
      <Box key={group.id} role="group" {...(group.label ? { 'aria-labelledby': headingId } : {})}>
        {group.label && (
          <Typography
            id={headingId}
            variant="overline"
            color="text.secondary"
            component="div"
            sx={{ px: 1.5, pt: 1, lineHeight: 2 }}
          >
            {group.label}
          </Typography>
        )}
        {items}
      </Box>
    );
  });

  return (
    <Stack spacing={1} sx={{ p: 1.5, width: 'min(380px, calc(100vw - 32px))' }}>
      <Typography variant="subtitle1" component="h2" sx={{ px: 0.5 }}>
        {t('doctorDashboard.switcher.title')}
      </Typography>
      <TextField
        autoFocus
        inputRef={inputRef}
        size="small"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        label={t('doctorDashboard.patients.search')}
        slotProps={{
          htmlInput: {
            role: 'combobox',
            'aria-expanded': true,
            'aria-controls': listId,
            'aria-autocomplete': 'list',
            ...(options[clamped] ? { 'aria-activedescendant': optionId(clamped) } : {}),
          },
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <Icon name="search" size={20} />
              </InputAdornment>
            ),
          },
        }}
      />
      <Box
        role="listbox"
        id={listId}
        aria-label={t('doctorDashboard.switcher.all')}
        sx={{ maxHeight: '55dvh', overflowY: 'auto' }}
      >
        {rendered}
      </Box>
      {options.length === 0 && (
        <Typography color="text.secondary" sx={{ px: 1 }} role="status">
          {t('doctorDashboard.patients.noMatch', { search: search.trim() })}
        </Typography>
      )}
      {/* A keyboard tip, where there is a keyboard. */}
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ px: 0.5, display: { xs: 'none', md: 'block' } }}
      >
        {t('doctorDashboard.switcher.shortcut')}
      </Typography>
    </Stack>
  );
}

/**
 * The patient header of the doctor's dashboard (docs/design/19-doctor-dashboard.md section 6): the
 * open patient's name and age; a tap opens a searchable list (recent patients, then all), the
 * arrows (and the `[` / `]` keys, see DoctorShell) move through the patients in the Patients sort
 * order. Switching keeps the section and changes the URL, so the back button and bookmarks work.
 */
export function PatientSwitcher({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const { patients } = useDoctorDashboard();
  const switchTo = useSwitchPatient();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const around = neighbours(patients ?? [], baby.id);
  const age = clinicalAge(baby.birthDate, new Date());
  const theme = useTheme();
  // "2 of 12" only where it fits next to the age (wide screens).
  const wide = useMediaQuery(theme.breakpoints.up('md'));
  const pick = (patientId: string) => {
    setAnchor(null);
    if (patientId !== baby.id) switchTo(patientId);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexGrow: 1, minWidth: 0 }}>
      {around && (
        <IconButton
          aria-label={t('doctorDashboard.switcher.previousNamed', { name: around.previous.name })}
          onClick={() => switchTo(around.previous.babyId)}
          sx={{ flexShrink: 0 }}
        >
          <Icon name="chevron-left" size={20} />
        </IconButton>
      )}
      <ButtonBase
        onClick={(event) => setAnchor(event.currentTarget)}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        aria-label={t('doctorDashboard.switcher.button', { name: baby.name, age })}
        sx={{
          flex: '0 1 auto',
          minWidth: 0,
          justifyContent: 'flex-start',
          minHeight: 44,
          borderRadius: 2,
          py: 0.5,
          px: 0.5,
          gap: 1.25,
        }}
      >
        <BabyAvatar id={baby.id} name={baby.name} />
        <Stack sx={{ minWidth: 0, textAlign: 'left' }}>
          <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', minWidth: 0 }}>
            <Typography variant="h6" component="p" noWrap>
              {baby.name}
            </Typography>
            <Icon name="expand" size={20} />
          </Stack>
          <Typography variant="caption" color="text.secondary" noWrap>
            {around && wide
              ? `${age} · ${t('doctorDashboard.switcher.position', {
                  index: around.index + 1,
                  count: patients?.length ?? 0,
                })}`
              : age}
          </Typography>
        </Stack>
      </ButtonBase>
      {around && (
        <IconButton
          aria-label={t('doctorDashboard.switcher.nextNamed', { name: around.next.name })}
          onClick={() => switchTo(around.next.babyId)}
          sx={{ flexShrink: 0 }}
        >
          <Icon name="chevron-right" size={20} />
        </IconButton>
      )}
      <Popover
        disableAutoFocus
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            role: 'dialog',
            'aria-label': t('doctorDashboard.switcher.title'),
            sx: { borderRadius: 3 },
          },
        }}
      >
        {anchor && <SwitcherPanel babyId={baby.id} onPick={pick} />}
      </Popover>
    </Box>
  );
}
