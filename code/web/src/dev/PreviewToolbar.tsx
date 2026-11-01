import { useEffect } from 'react';
import { Box } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { useLocale } from '../i18n/useLocale';
import { useNightFeed } from '../theme/NightFeedContext';
import { useThemeMode } from '../theme/ThemeModeContext';
import { SegmentedControl } from '../ui/form';

type Scheme = 'light' | 'dark' | 'night';

/** Scenario select, colour scheme and language switches under a preview. */
export function PreviewToolbar({
  scenarios,
  scenario,
  onScenario,
}: {
  scenarios: readonly string[];
  scenario: string;
  onScenario: (scenario: string) => void;
}) {
  const { scheme, setMode } = useThemeMode();
  const night = useNightFeed();
  const { locale, setPreference } = useLocale();
  const [params] = useSearchParams();
  const requested = params.get('scheme');
  const setScheme = (next: Scheme) => {
    if (next === 'night') {
      if (!night.active) night.toggle();
      return;
    }
    setMode(next);
    if (night.active) night.toggle();
  };
  // `?scheme=dark` applies once on load (a modal sheet covers the switch below).
  useEffect(() => {
    if (requested === 'light' || requested === 'dark' || requested === 'night') {
      setScheme(requested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);
  return (
    <Box sx={{ display: 'grid', gap: 1, p: 1, bgcolor: 'background.paper' }}>
      <select
        aria-label="Scenario"
        value={scenario}
        onChange={(event) => onScenario(event.target.value)}
      >
        {scenarios.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <SegmentedControl<Scheme>
        aria-label="Colour scheme"
        value={scheme}
        onChange={(value) => value && setScheme(value)}
        options={[
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
          { value: 'night', label: 'Night' },
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
    </Box>
  );
}
