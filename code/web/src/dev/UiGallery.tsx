import { useEffect, useState, type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { createDatabase, type BabyRoutineDb } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';
import { useLocale } from '../i18n/useLocale';
import { useNightFeed } from '../theme/NightFeedContext';
import { useThemeMode } from '../theme/ThemeModeContext';
import { CATEGORY_NAMES } from '../theme/tokens';
import { CategoryIcon } from '../ui/CategoryIcon';
import { Icon } from '../ui/Icon';
import { ICON_COMPONENTS, type IconName } from '../ui/icons';
import {
  ChipGroup,
  DateField,
  DurationField,
  Field,
  MedicationPicker,
  NotesRow,
  NumberStepper,
  SegmentedControl,
  SwitchRow,
  TimePanel,
  type MedicationSelection,
} from '../ui/form';

/** Fixed "now" so reviews and screenshots are repeatable. */
const NOW = new Date(2026, 9, 21, 14, 20, 0, 0);
const GALLERY_BABY = 'dev-gallery-baby';

type Scheme = 'light' | 'dark' | 'night';

const CATEGORY_ICONS: Record<(typeof CATEGORY_NAMES)[number], IconName> = {
  sleep: 'moon',
  feeding: 'bottle',
  diaper: 'diaper',
  health: 'pill',
  care: 'bath',
  activity: 'walk',
  nightWaking: 'eye',
  custom: 'star',
};

/** Developer-only: one page with every UI component in all its states (route `/dev/ui`). */
export default function UiGallery({ db: injected }: { db?: BabyRoutineDb }) {
  const [db] = useState(() => injected ?? createDatabase('dev-ui-gallery'));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      if ((await db.medications.count()) === 0) {
        const createdAt = NOW.toISOString();
        await db.medications.bulkPut(
          [
            ['m1', 'Colidis', true, { amount: 5, unit: 'drops' }],
            ['m2', 'Vitamin D', true, null],
            ['m3', 'Paracetamol', false, { amount: 2.5, unit: 'ml' }],
          ].map(([id, name, isUsual, defaultDosage]) => ({
            id: id as string,
            babyId: GALLERY_BABY,
            name: name as string,
            isUsual: isUsual as boolean,
            defaultDosage: defaultDosage as { amount: number; unit: string } | null,
            notes: null,
            createdAt,
          })),
        );
      }
      if (live) setReady(true);
    })();
    return () => {
      live = false;
    };
  }, [db]);

  return (
    <DatabaseProvider db={db}>
      <Box
        sx={{
          bgcolor: 'background.default',
          color: 'text.primary',
          minHeight: '100dvh',
          px: 2,
          py: 3,
          pb: 12,
        }}
      >
        <Box sx={{ maxWidth: 480, mx: 'auto', display: 'grid', gap: 3 }}>
          <Typography variant="h4" component="h1">
            UI gallery
          </Typography>
          <Toolbar />
          <IconSection />
          <FieldSection />
          <SegmentedSection />
          <ChipSection />
          <StepperSection />
          <DurationSection />
          <TimeSection />
          <DateSection />
          <NotesSection />
          <SwitchSection />
          {ready && <MedicationSection />}
        </Box>
      </Box>
    </DatabaseProvider>
  );
}

function Toolbar() {
  const { mode, scheme, setMode } = useThemeMode();
  const night = useNightFeed();
  const { locale, setPreference } = useLocale();
  const setScheme = (next: Scheme) => {
    if (next === 'night') {
      if (!night.active) night.toggle();
      return;
    }
    setMode(next);
    if (night.active) night.toggle();
  };
  return (
    <Box
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 2,
        display: 'grid',
        gap: 1,
        py: 1,
        bgcolor: 'background.default',
      }}
    >
      <SegmentedControl<Scheme>
        aria-label="Colour scheme"
        value={scheme}
        onChange={(value) => value && setScheme(value)}
        options={[
          { value: 'light', label: 'Light', icon: 'sun' },
          { value: 'dark', label: 'Dark', icon: 'moon' },
          { value: 'night', label: 'Night', icon: 'night-mode' },
        ]}
      />
      <SegmentedControl<'en' | 'pt-BR'>
        aria-label="Language"
        value={locale}
        onChange={(value) => value && setPreference(value)}
        options={[
          { value: 'en', label: 'English' },
          { value: 'pt-BR', label: 'Português' },
        ]}
      />
      <Typography variant="caption" color="text.secondary">
        {`mode: ${mode}, scheme: ${scheme}`}
      </Typography>
    </Box>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" aria-label={title} sx={{ display: 'grid', gap: 2 }}>
      <Typography variant="overline" component="h2" color="text.secondary">
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function IconSection() {
  const names = Object.keys(ICON_COMPONENTS) as IconName[];
  return (
    <Section title="Icons">
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
        {CATEGORY_NAMES.map((category) => (
          <CategoryIcon key={category} category={category} name={CATEGORY_ICONS[category]} />
        ))}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
        {([16, 20, 24] as const).map((size) => (
          <Icon key={size} name="bottle" size={size} />
        ))}
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))',
          gap: 1,
        }}
      >
        {names.map((name) => (
          <Box
            key={name}
            title={name}
            sx={{ display: 'grid', placeItems: 'center', height: 44, color: 'text.primary' }}
          >
            <Icon name={name} />
          </Box>
        ))}
      </Box>
    </Section>
  );
}

function FieldSection() {
  const [text, setText] = useState('');
  return (
    <Section title="Field">
      <Field label="Default" help="Help text under the control">
        <NotesRow value={text} onChange={setText} />
      </Field>
      <Field label="Required" required>
        <NumberStepper value={null} onChange={() => {}} />
      </Field>
      <Field label="Optional" optional icon="note">
        <DurationField valueSeconds={null} onChange={() => {}} />
      </Field>
      <Field label="Error" error="Something to fix" required>
        <NumberStepper value={500} onChange={() => {}} unit="ml" />
      </Field>
      <Field label="Disabled" disabled>
        <NumberStepper value={90} onChange={() => {}} unit="ml" />
      </Field>
    </Section>
  );
}

const METHODS = [
  { value: 'bottle', label: 'Bottle', icon: 'bottle' },
  { value: 'breast', label: 'Breast', icon: 'heart' },
  { value: 'solid', label: 'Solid food', icon: 'utensils' },
] as const;

function SegmentedSection() {
  const [method, setMethod] = useState<string | null>('bottle');
  const [side, setSide] = useState<string | null>(null);
  const [many, setMany] = useState<string | null>('b');
  return (
    <Section title="Segmented control">
      <Field label="Method" group required>
        <SegmentedControl
          value={method}
          onChange={setMethod}
          options={METHODS.map((o) => ({ ...o }))}
        />
      </Field>
      <Field label="Side (optional, tap again to clear)" group optional>
        <SegmentedControl
          value={side}
          onChange={setSide}
          clearable
          options={[
            { value: 'left', label: 'Left', icon: 'arrow-left' },
            { value: 'right', label: 'Right', icon: 'arrow-right' },
          ]}
        />
      </Field>
      <Field label="Five options wrap to two rows when narrow" group>
        <SegmentedControl
          value={many}
          onChange={setMany}
          options={['a', 'b', 'c', 'd', 'e'].map((v) => ({ value: v, label: `Option ${v}` }))}
        />
      </Field>
      <Field label="Error" group error="Choose one">
        <SegmentedControl
          value={null}
          onChange={() => {}}
          options={METHODS.map((o) => ({ ...o }))}
        />
      </Field>
      <Field label="Disabled" group disabled>
        <SegmentedControl
          value="breast"
          onChange={() => {}}
          options={METHODS.map((o) => ({ ...o }))}
        />
      </Field>
    </Section>
  );
}

function ChipSection() {
  const [mood, setMood] = useState<string | null>('smile');
  const [tags, setTags] = useState<string[]>(['gas']);
  return (
    <Section title="Chips">
      <Field label="Mood (single)" group>
        <ChipGroup
          value={mood}
          onChange={setMood}
          clearable
          options={[
            { value: 'happy', label: 'Happy', icon: 'mood-happy' },
            { value: 'smile', label: 'Content', icon: 'mood-smile' },
            { value: 'neutral', label: 'Neutral', icon: 'mood-neutral' },
            { value: 'sad', label: 'Fussy', icon: 'mood-sad' },
            { value: 'cry', label: 'Crying', icon: 'mood-cry' },
          ]}
        />
      </Field>
      <Field label="Symptoms (multiple)" group>
        <ChipGroup
          multiple
          value={tags}
          onChange={setTags}
          options={[
            { value: 'gas', label: 'Gas' },
            { value: 'reflux', label: 'Reflux' },
            { value: 'fever', label: 'Fever', icon: 'thermometer' },
            { value: 'cough', label: 'Cough', disabled: true },
          ]}
        />
      </Field>
    </Section>
  );
}

function StepperSection() {
  const [ml, setMl] = useState<number | null>(90);
  const [temp, setTemp] = useState<number | null>(36.6);
  const [empty, setEmpty] = useState<number | null>(null);
  return (
    <Section title="Number stepper">
      <Field label="Amount" required>
        <NumberStepper
          value={ml}
          onChange={setMl}
          step={10}
          min={0}
          max={400}
          unit="ml"
          quickValues={[60, 90, 120, 150]}
          lastValue={120}
        />
      </Field>
      <Field label="Temperature (decimal step)">
        <NumberStepper value={temp} onChange={setTemp} step={0.1} min={34} max={42} unit="°C" />
      </Field>
      <Field label="Empty">
        <NumberStepper value={empty} onChange={setEmpty} step={1} start={5} unit="drops" />
      </Field>
      <Field label="At the maximum" error="Up to 400 ml">
        <NumberStepper value={400} onChange={() => {}} min={0} max={400} unit="ml" />
      </Field>
      <Field label="Disabled" disabled>
        <NumberStepper value={90} onChange={() => {}} unit="ml" quickValues={[60, 90]} />
      </Field>
    </Section>
  );
}

function DurationSection() {
  const [a, setA] = useState<number | null>(750);
  return (
    <Section title="Duration">
      <Field label="Left breast">
        <DurationField valueSeconds={a} onChange={setA} />
      </Field>
      <Field label="Empty">
        <DurationField valueSeconds={null} onChange={() => {}} />
      </Field>
      <Field label="Disabled" disabled>
        <DurationField valueSeconds={600} onChange={() => {}} />
      </Field>
    </Section>
  );
}

function TimeSection() {
  const [start, setStart] = useState<Date | null>(new Date(NOW.getTime() - 15 * 60_000));
  const [end, setEnd] = useState<Date | null>(null);
  const [yesterday, setYesterday] = useState<Date | null>(new Date(2026, 9, 20, 23, 40));
  return (
    <Section title="Time panel">
      <Field label="Start" required>
        <TimePanel value={start} onChange={setStart} now={NOW} />
      </Field>
      <Field label="End (with Still running)">
        <TimePanel value={end} onChange={setEnd} now={NOW} min={start} allowRunning />
      </Field>
      <Field label="Yesterday">
        <TimePanel value={yesterday} onChange={setYesterday} now={NOW} />
      </Field>
      <Field label="Disabled" disabled>
        <TimePanel value={start} onChange={() => {}} now={NOW} />
      </Field>
    </Section>
  );
}

function DateSection() {
  const [date, setDate] = useState('2026-03-04');
  return (
    <Section title="Date field">
      <Field label="Birth date" group required>
        <DateField value={date} onChange={setDate} max="2026-10-21" />
      </Field>
      <Field label="Empty" group>
        <DateField value="" onChange={() => {}} />
      </Field>
      <Field label="Error" group error="The date cannot be in the future.">
        <DateField value="2027-01-01" onChange={() => {}} />
      </Field>
      <Field label="Disabled" group disabled>
        <DateField value="2026-03-04" onChange={() => {}} />
      </Field>
    </Section>
  );
}

function NotesSection() {
  const [empty, setEmpty] = useState('');
  const [filled, setFilled] = useState('Slept well after the bath.');
  const [long, setLong] = useState('x'.repeat(1850));
  return (
    <Section title="Notes row">
      <Field label="Collapsed">
        <NotesRow value={empty} onChange={setEmpty} />
      </Field>
      <Field label="With text">
        <NotesRow value={filled} onChange={setFilled} />
      </Field>
      <Field label="Near the limit">
        <NotesRow value={long} onChange={setLong} />
      </Field>
    </Section>
  );
}

function SwitchSection() {
  const [on, setOn] = useState(false);
  return (
    <Section title="Switch row">
      <SwitchRow checked={on} onChange={setOn} label="Keep screen on" icon="sun" />
      <SwitchRow checked onChange={() => {}} label="On" />
      <SwitchRow checked={false} onChange={() => {}} label="Disabled" disabled />
    </Section>
  );
}

function MedicationSection() {
  const [selected, setSelected] = useState<MedicationSelection>({});
  return (
    <Section title="Medication picker">
      <Field label="Medications" group>
        <MedicationPicker babyId={GALLERY_BABY} selected={selected} onChange={setSelected} />
      </Field>
    </Section>
  );
}
