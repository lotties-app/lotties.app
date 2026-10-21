import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BedtimeLine } from '../now/ui/BedtimeLine';
import type { BedTimeDto } from '../sync/contract';
import { useTestLocale } from '../test/locale';
import { renderUi } from '../test/renderUi';
import { describeBedTime, describeBedTimeReason } from './predictionModel';

const NOW = new Date(2026, 9, 21, 17, 0);
const at = (h: number, m: number) => new Date(2026, 9, 21, h, m).toISOString();

const BED_TIME: BedTimeDto = {
  typeKey: 'sleep',
  kind: 'night',
  nextStart: { earliest: at(19, 30), expected: at(19, 50), latest: at(20, 15) },
  expectedDuration: { minutes: 600, sampleCount: 9 },
  confidence: 'Medium',
  sampleCount: 9,
  reason: 'English fallback.',
  basis: {
    kind: 'BedTimeClock',
    sampleCount: 9,
    recentBedTimeCount: 9,
    lookBackDays: 14,
    medianClock: '19:50',
  },
};

describe('bed time (heuristic v1.1)', () => {
  it('reads the line and the reason from the basis', () => {
    expect(describeBedTime(BED_TIME, NOW)).toMatch(/^Bedtime around .*7:50|19:50/);
    const reason = describeBedTimeReason(BED_TIME, NOW);
    expect(reason).toMatch(/usual bedtime was around .* from 9 recent nights/);
    expect(reason).toMatch(/Likely between/);
    expect(reason).toMatch(/Night sleep|usually lasts|10 h|10h/i);
  });

  it('falls back to the English reason without a usable basis', () => {
    expect(describeBedTimeReason({ ...BED_TIME, basis: {} }, NOW)).toBe('English fallback.');
  });

  it('shows a quiet line with a Why? sheet', () => {
    renderUi(<BedtimeLine bedTime={BED_TIME} now={NOW} />);
    expect(screen.getByText(/^Bedtime around/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Why?' }));
    expect(screen.getByRole('dialog').textContent).toMatch(/9 recent nights/);
  });

  it('reads in Portuguese', async () => {
    await useTestLocale('pt-BR');
    renderUi(<BedtimeLine bedTime={BED_TIME} now={NOW} />);
    expect(screen.getByText(/^Hora de dormir por volta das/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Por quê?' }));
    expect(screen.getByRole('dialog').textContent).toMatch(/9 noites recentes/);
    await useTestLocale('en');
  });
});
