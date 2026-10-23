import { fireEvent, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { activateLocale } from '../../i18n/i18n';
import { useTestLocale } from '../../test/locale';
import { renderUi } from '../../test/renderUi';
import { nightPeriodKey } from '../../theme/nightFeed';
import { NIGHT_FEED_STATE_STORAGE_KEY } from '../../theme/nightFeedStorage';
import { THEME_STORAGE_KEY } from '../../theme/themeStorage';
import type { NapProjection } from '../napProjection';
import { DayRuler } from './DayRuler';

const at = (h: number, m = 0) => new Date(2026, 9, 21, h, m);
const WINDOW = {
  earliest: at(15, 50).toISOString(),
  latest: at(16, 39).toISOString(),
  basis: { kind: 'AwakeWindow', medianGapMinutes: 135, lookBackDays: 7 },
};

function renderRuler(props: Partial<Parameters<typeof DayRuler>[0]> = {}) {
  return renderUi(
    <DayRuler
      since={at(13, 54).toISOString()}
      now={at(15, 21)}
      window={WINDOW}
      minutes={87}
      {...props}
    />,
  );
}

const strip = () => screen.getByTestId('rhythm-detail');

afterEach(async () => {
  window.localStorage.clear();
  await activateLocale('en');
});

describe('DayRuler', () => {
  it('is a labelled group with the window and the face of now as buttons, nothing extra', () => {
    renderRuler();
    const ruler = screen.getByRole('group', {
      name: 'Awake since 13:54, now 15:21. Nap window 15:50 to 16:39.',
    });
    expect(
      within(ruler)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual([
      'Now, 15:21, awake. Awake for 1h 27m. Next: nap window opens 15:50.',
      'Nap window opens 15:50, closes 16:39. Opens in 29m. Based on the usual awake time of about 2h 15m.',
    ]);
    expect(within(ruler).getByTestId('ruler-now').getAttribute('data-face')).toBe('awake');
    expect(strip().textContent).toBe('');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('selects on tap, moves with the arrows and clears with Esc', () => {
    renderRuler();
    const now = screen.getByTestId('rhythm-mark-now');
    fireEvent.click(now);
    expect(strip().textContent).toBe(
      'Now, 15:21, awake · Awake for 1h 27m · Next: nap window opens 15:50',
    );
    fireEvent.keyDown(now, { key: 'ArrowRight' });
    const window = screen.getByTestId('rhythm-mark-window');
    expect(document.activeElement).toBe(window);
    fireEvent.click(window);
    expect(strip().textContent).toMatch(/^Nap window opens 15:50, closes 16:39 · Opens in 29m/);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(strip().textContent).toBe('');
  });

  it('shows the hover tooltip', async () => {
    renderRuler();
    fireEvent.mouseOver(screen.getByTestId('rhythm-mark-now'));
    expect((await screen.findByRole('tooltip')).textContent).toMatch(/^Now, 15:21, awake\./);
  });

  it('turns drowsy inside the window and tired during the heads-up', () => {
    const { unmount } = renderRuler({ now: at(16, 0), minutes: 126 });
    expect(screen.getByTestId('ruler-now').getAttribute('data-face')).toBe('drowsy');
    unmount();
    renderRuler({ now: at(16, 0), minutes: 126, overtired: true });
    expect(screen.getByTestId('ruler-now').getAttribute('data-face')).toBe('tired');
  });

  it('says the window closed once it has passed', () => {
    renderRuler({ now: at(17, 0), minutes: 186 });
    fireEvent.click(screen.getByTestId('rhythm-mark-window'));
    expect(strip().textContent).toMatch(/Window closed at 16:39/);
  });

  it('draws the projected naps and the bedtime window, with a legend only then', () => {
    const projection: NapProjection = {
      wake: null,
      windows: [
        {
          index: 1,
          earliest: at(18, 0).getTime(),
          expected: at(18, 15).getTime(),
          latest: at(18, 45).getTime(),
        },
      ],
      basis: { gapKind: 'awake', gapMinutes: 135, napMinutes: 60 },
    };
    renderRuler({
      projection,
      bedTime: { earliest: at(19, 20).toISOString(), latest: at(20, 10).toISOString() },
    });
    expect(screen.getByTestId('ruler-projected').getAttribute('data-upcoming')).toBe('1');
    expect(screen.getByTestId('ruler-bedtime')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /^Later nap window about 18:00 to 18:45 \(estimate\)\./ }),
    ).toBeTruthy();
    const legend = screen.getByRole('list', { name: 'What the ruler shows' });
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((i) => i.textContent),
    ).toEqual(['Nap window', 'Next naps (estimate)', 'Bedtime window', 'Now']);
    // The ruler reaches past the bedtime window.
    expect(screen.getAllByText(/^\d\d:\d\d$/).map((n) => n.textContent)).toEqual([
      '13:54',
      '20:40',
    ]);
  });

  for (const scheme of ['light', 'dark', 'night'] as const) {
    it(`has no axe violations in ${scheme}`, async () => {
      if (scheme === 'night') {
        window.localStorage.setItem(
          NIGHT_FEED_STATE_STORAGE_KEY,
          JSON.stringify({ override: { on: true, key: nightPeriodKey(new Date()) } }),
        );
      } else {
        window.localStorage.setItem(THEME_STORAGE_KEY, scheme);
      }
      renderRuler();
      fireEvent.click(screen.getByTestId('rhythm-mark-now'));
      const result = await axe.run(document.body, {
        runOnly: ['wcag2a', 'wcag2aa'],
        rules: { 'color-contrast': { enabled: false } },
      });
      expect(result.violations.map((v) => v.id)).toEqual([]);
    });
  }

  it('speaks Portuguese', async () => {
    await useTestLocale('pt-BR');
    renderRuler();
    fireEvent.click(screen.getByTestId('rhythm-mark-now'));
    expect(strip().textContent).toBe(
      'Agora, 15:21, acordado · Acordado há 1 h 27 min · A seguir: janela da soneca abre às 15:50',
    );
    expect(screen.getByRole('button', { name: 'Limpar a seleção' })).toBeTruthy();
  });
});
