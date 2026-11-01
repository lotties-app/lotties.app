import { useState } from 'react';
import axe from 'axe-core';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTestLocale } from '../../test/locale';
import { renderUi } from '../../test/renderUi';
import { Field } from './Field';
import { TimePanel } from './TimePanel';
import {
  addMinutes,
  clampDate,
  clockValue,
  dateAtRatio,
  daysBeforeToday,
  hourMarks,
  parseClock,
  ratioOf,
  resolveTypedTime,
  rulerRange,
  shiftLocalDays,
  snapToStep,
  startOfMinute,
  withClock,
} from './timeMath';

const at = (h: number, m: number, day = 21) => new Date(2026, 9, day, h, m, 0, 0);

describe('parseClock', () => {
  it('reads the HH:MM value of a native time input', () => {
    expect(parseClock('14:30')).toEqual({ hours: 14, minutes: 30 });
    expect(parseClock('00:00')).toEqual({ hours: 0, minutes: 0 });
    expect(parseClock('09:05')).toEqual({ hours: 9, minutes: 5 });
    expect(parseClock('23:59:00')).toEqual({ hours: 23, minutes: 59 });
  });

  it('rejects an empty (incomplete) field and non-times', () => {
    for (const text of ['', 'abc', '24:00', '12:60', '9:30', '1430', '2:30 pm']) {
      expect(parseClock(text), text).toBeNull();
    }
  });

  it('writes the local clock of an instant as a native value', () => {
    expect(clockValue(at(9, 5))).toBe('09:05');
    expect(clockValue(at(0, 0))).toBe('00:00');
    expect(clockValue(at(23, 59))).toBe('23:59');
  });
});

describe('time maths', () => {
  it('drops seconds and snaps to five minutes on the clock', () => {
    expect(startOfMinute(new Date(2026, 9, 21, 14, 20, 45, 500)).getTime()).toBe(
      at(14, 20).getTime(),
    );
    expect(snapToStep(at(14, 22)).getTime()).toBe(at(14, 20).getTime());
    expect(snapToStep(at(14, 23)).getTime()).toBe(at(14, 25).getTime());
  });

  it('moves across midnight by local days, not by 24 hours', () => {
    expect(shiftLocalDays(at(23, 50), 1).getTime()).toBe(at(23, 50, 22).getTime());
    expect(shiftLocalDays(at(0, 5), -1).getTime()).toBe(at(0, 5, 20).getTime());
    expect(addMinutes(at(23, 50), 30).getTime()).toBe(at(0, 20, 22).getTime());
    expect(daysBeforeToday(at(23, 50, 20), at(0, 10))).toBe(1);
    expect(daysBeforeToday(at(0, 0), at(23, 59))).toBe(0);
    expect(daysBeforeToday(at(12, 0, 18), at(8, 0))).toBe(3);
  });

  it('puts a typed clock on the chosen day and survives an ISO round trip', () => {
    const value = withClock(at(9, 0, 20), 23, 45);
    expect(value.getFullYear()).toBe(2026);
    expect(value.getDate()).toBe(20);
    expect(value.getHours()).toBe(23);
    expect(new Date(value.toISOString()).getTime()).toBe(value.getTime());
  });

  it('clamps into min and max', () => {
    const min = at(10, 0);
    const max = at(14, 0);
    expect(clampDate(at(9, 0), min, max)).toBe(min);
    expect(clampDate(at(15, 0), min, max)).toBe(max);
    expect(clampDate(at(12, 0), min, max).getTime()).toBe(at(12, 0).getTime());
    expect(clampDate(at(15, 0), null, undefined).getTime()).toBe(at(15, 0).getTime());
  });

  it('reads a time typed just after midnight as the previous evening', () => {
    const now = at(0, 10);
    const result = resolveTypedTime('23:30', now, { max: now });
    expect(result).toEqual({ ok: true, value: at(23, 30, 20) });
  });

  it('reports a future time, a time before the minimum, and non-times', () => {
    const now = at(14, 20);
    expect(resolveTypedTime('15:00', at(9, 0, 19), { max: now })).toEqual({
      ok: true,
      value: at(15, 0, 19),
    });
    // Same day as `now` and later than it: the previous day if that is allowed...
    expect(resolveTypedTime('15:00', now, { max: now })).toEqual({
      ok: true,
      value: at(15, 0, 20),
    });
    // ...but not when that falls before the minimum: the nearest allowed instant comes along.
    expect(resolveTypedTime('15:00', now, { max: now, min: at(14, 0) })).toEqual({
      ok: false,
      problem: 'beforeMin',
      nearest: at(14, 0),
    });
    expect(resolveTypedTime('13:00', now, { max: now, min: at(14, 0) })).toEqual({
      ok: false,
      problem: 'beforeMin',
      nearest: at(14, 0),
    });
    // A later day than today (the date chip of a future day cannot be reached, but the maths holds).
    expect(resolveTypedTime('10:00', at(9, 0, 22), { max: now })).toEqual({
      ok: false,
      problem: 'future',
      nearest: now,
    });
    expect(resolveTypedTime('', now, { max: now })).toEqual({ ok: false, problem: 'invalid' });
  });

  it('builds a ruler of twelve hours that snaps to five minutes and lands exactly on now', () => {
    const now = at(14, 22);
    const range = rulerRange(now);
    expect(range.from.getTime()).toBe(addMinutes(now, -720).getTime());
    expect(ratioOf(now, range)).toBe(1);
    expect(ratioOf(addMinutes(now, -360), range)).toBeCloseTo(0.5);
    expect(dateAtRatio(1, range).getTime()).toBe(now.getTime());
    expect(dateAtRatio(0.999, range).getTime()).toBe(now.getTime());
    const middle = dateAtRatio(0.5, range);
    expect(middle.getMinutes() % 5).toBe(0);
    expect(Math.abs(middle.getTime() - addMinutes(now, -360).getTime())).toBeLessThan(150_000);
    // The minimum shortens the ruler.
    const shorter = rulerRange(now, at(12, 0));
    expect(shorter.from.getTime()).toBe(at(12, 0).getTime());
    expect(hourMarks(shorter).map((d) => d.getHours())).toEqual([12, 13, 14]);
  });
});

describe('TimePanel', () => {
  const NOW = at(14, 20);

  function Panel(props: {
    initial?: Date | null;
    min?: Date | null;
    allowRunning?: boolean;
    now?: Date;
    compact?: boolean;
  }) {
    const [value, setValue] = useState<Date | null>(
      props.initial === undefined ? NOW : props.initial,
    );
    return (
      <Field label="Start">
        <TimePanel
          value={value}
          onChange={setValue}
          now={props.now ?? NOW}
          min={props.min}
          allowRunning={props.allowRunning}
          compact={props.compact}
        />
        <span data-testid="iso">{value ? value.toISOString() : 'running'}</span>
      </Field>
    );
  }
  const chosen = () => screen.getByTestId('iso').textContent;
  const pill = () => screen.getByLabelText('Start') as HTMLInputElement;

  it('shows the chosen local time in a big pill and the quick chips with relative labels', () => {
    renderUi(<Panel initial={at(14, 5)} />);
    expect(pill().value).toBe('14:05');
    for (const name of ['Now', '5 min ago', '15 min ago', '30 min ago']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: '15 min ago' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('chips set the time relative to now and mark the matching chip', () => {
    renderUi(<Panel />);
    fireEvent.click(screen.getByRole('button', { name: '30 min ago' }));
    expect(chosen()).toBe(at(13, 50).toISOString());
    expect(pill().value).toBe('13:50');
    fireEvent.click(screen.getByRole('button', { name: 'Now' }));
    expect(chosen()).toBe(NOW.toISOString());
  });

  it('is the native time picker with the chosen time as HH:MM', () => {
    renderUi(<Panel initial={at(9, 5)} />);
    expect(pill().type).toBe('time');
    expect(pill().getAttribute('step')).toBe('60');
    expect(pill().value).toBe('09:05');
  });

  it('applies a picked time that fits on the chosen day at once, as the wheel turns', () => {
    renderUi(<Panel />);
    fireEvent.change(pill(), { target: { value: '13:05' } });
    expect(chosen()).toBe(at(13, 5).toISOString());
    fireEvent.change(pill(), { target: { value: '00:00' } });
    expect(chosen()).toBe(at(0, 0).toISOString());
    fireEvent.blur(pill());
    expect(chosen()).toBe(at(0, 0).toISOString());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps an out-of-range value mid-scroll and settles it when the field is left', () => {
    renderUi(<Panel min={at(14, 0)} />);
    fireEvent.change(pill(), { target: { value: '13:30' } }); // before the start: kept as a draft
    expect(pill().value).toBe('13:30');
    expect(chosen()).toBe(NOW.toISOString());
    expect(screen.queryByRole('status')).toBeNull(); // no message while scrolling
    fireEvent.change(pill(), { target: { value: '14:10' } }); // back in range: applied
    expect(chosen()).toBe(at(14, 10).toISOString());
    fireEvent.change(pill(), { target: { value: '13:45' } });
    fireEvent.blur(pill());
    expect(chosen()).toBe(at(14, 0).toISOString()); // clamped to the start
    expect(pill().value).toBe('14:00');
    expect(screen.getByRole('status').textContent).toBe('The time cannot be before 14:00.');
    expect(pill().getAttribute('aria-invalid')).toBe('true');
    expect(pill().getAttribute('aria-describedby')).toContain(screen.getByRole('status').id);
  });

  it('explains an emptied field and keeps the old value', () => {
    renderUi(<Panel />);
    fireEvent.change(pill(), { target: { value: '' } });
    fireEvent.blur(pill());
    expect(screen.getByRole('status').textContent).toBe('Enter a time like 14:30.');
    expect(pill().getAttribute('aria-invalid')).toBe('true');
    expect(chosen()).toBe(NOW.toISOString());
    expect(pill().value).toBe('14:20');
    fireEvent.change(pill(), { target: { value: '14:00' } });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('has no axe violations, also while showing a problem', async () => {
    const { container } = renderUi(<Panel />);
    const rules = { rules: { 'color-contrast': { enabled: false } } };
    expect((await axe.run(container, rules)).violations).toEqual([]);
    fireEvent.change(pill(), { target: { value: '' } });
    fireEvent.blur(pill());
    expect((await axe.run(container, rules)).violations).toEqual([]);
  });

  it('turns a late typed time into yesterday evening just after midnight', () => {
    const now = at(0, 10);
    renderUi(<Panel now={now} initial={now} />);
    fireEvent.change(pill(), { target: { value: '23:30' } });
    fireEvent.blur(pill());
    expect(chosen()).toBe(at(23, 30, 20).toISOString());
    expect(screen.getByRole('button', { name: 'Yesterday' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('switches between Today and Yesterday keeping the clock, never into the future', () => {
    renderUi(<Panel initial={at(9, 15)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
    expect(chosen()).toBe(at(9, 15, 20).toISOString());
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(chosen()).toBe(at(9, 15).toISOString());

    fireEvent.change(pill(), { target: { value: '23:00' } });
    fireEvent.blur(pill());
    expect(chosen()).toBe(at(23, 0, 20).toISOString());
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(chosen()).toBe(NOW.toISOString()); // 23:00 today is in the future: clamped to now
  });

  it('shows the date as a chip when it is older than yesterday', () => {
    renderUi(<Panel initial={at(9, 0, 17)} />);
    expect(screen.getByText(/Oct/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Today' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(screen.getByRole('button', { name: 'Yesterday' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('has a ruler slider with spoken value text, keyboard steps of 1 and 15 minutes, Home and End', () => {
    renderUi(<Panel />);
    const ruler = screen.getByRole('slider', { name: 'Adjust time' });
    expect(ruler.getAttribute('aria-valuemax')).toBe('0');
    expect(ruler.getAttribute('aria-valuemin')).toBe('-720');
    expect(ruler.getAttribute('aria-valuenow')).toBe('0');
    fireEvent.keyDown(ruler, { key: 'ArrowLeft' });
    expect(chosen()).toBe(at(14, 19).toISOString());
    expect(ruler.getAttribute('aria-valuenow')).toBe('-1');
    expect(ruler.getAttribute('aria-valuetext')).toMatch(/^14:19, 1 minute ago$/);
    fireEvent.keyDown(ruler, { key: 'ArrowLeft', shiftKey: true });
    expect(chosen()).toBe(at(14, 4).toISOString());
    fireEvent.keyDown(ruler, { key: 'PageDown' });
    expect(chosen()).toBe(at(13, 49).toISOString());
    fireEvent.keyDown(ruler, { key: 'ArrowRight' });
    fireEvent.keyDown(ruler, { key: 'ArrowRight', shiftKey: true }); // cannot pass now
    fireEvent.keyDown(ruler, { key: 'ArrowRight', shiftKey: true });
    expect(chosen()).toBe(NOW.toISOString());
    fireEvent.keyDown(ruler, { key: 'End' });
    expect(chosen()).toBe(at(2, 20).toISOString());
    fireEvent.keyDown(ruler, { key: 'Home' });
    expect(chosen()).toBe(NOW.toISOString());
  });

  it('snaps a drag on the ruler to five minutes', () => {
    renderUi(<Panel />);
    const ruler = screen.getByRole('slider', { name: 'Adjust time' });
    ruler.getBoundingClientRect = () =>
      ({ left: 0, width: 240, top: 0, height: 64, right: 240, bottom: 64, x: 0, y: 0 }) as DOMRect;
    fireEvent.pointerDown(ruler, { clientX: 120, pointerId: 1 });
    const picked = new Date(chosen()!);
    expect(picked.getMinutes() % 5).toBe(0);
    expect(Math.abs(picked.getTime() - at(8, 20).getTime())).toBeLessThanOrEqual(150_000);
  });

  it('does not offer a time before the minimum (an end before its start)', () => {
    renderUi(<Panel min={at(14, 10)} />);
    expect((screen.getByRole('button', { name: '15 min ago' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: '5 min ago' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    const ruler = screen.getByRole('slider', { name: 'Adjust time' });
    expect(ruler.getAttribute('aria-valuemin')).toBe('-10');
    fireEvent.keyDown(ruler, { key: 'End' });
    expect(chosen()).toBe(at(14, 10).toISOString());
  });

  it('has a Still running switch for the end of an event', () => {
    renderUi(<Panel allowRunning initial={null} />);
    const running = screen.getByRole('switch', { name: 'Still running' });
    expect(running.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('slider')).toBeNull();
    fireEvent.click(running);
    expect(chosen()).toBe(NOW.toISOString());
    expect(screen.getByRole('slider')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Still running' }));
    expect(chosen()).toBe('running');
  });

  it('speaks Portuguese: relative chips, day chips and the ruler text', async () => {
    await useTestLocale('pt-BR');
    renderUi(<Panel initial={at(14, 5)} />);
    expect(screen.getByRole('button', { name: 'Agora' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'há 15 min' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ontem' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hoje' }).getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByRole('slider', { name: 'Ajustar o horário' }).getAttribute('aria-valuetext'),
    ).toMatch(/^14:05, há 15 minutos$/);
  });

  describe('compact', () => {
    it('puts short chips and the time in one row, named in full for assistive technology', () => {
      renderUi(<Panel compact initial={at(14, 5)} />);
      expect(pill().value).toBe('14:05');
      const quick = screen.getByRole('group', { name: 'Quick times' });
      expect(Array.from(quick.querySelectorAll('button'), (b) => b.textContent)).toEqual([
        'Now',
        '−5',
        '−15',
        '−30',
      ]);
      fireEvent.click(screen.getByRole('button', { name: '15 min ago' }));
      expect(chosen()).toBe(addMinutes(NOW, -15).toISOString());
    });

    it('folds the day and the ruler away until asked', () => {
      renderUi(<Panel compact />);
      expect(screen.queryByRole('group', { name: 'Day' })).toBeNull();
      expect(screen.queryByRole('slider')).toBeNull();

      const more = screen.getByRole('button', { name: /More precise/ });
      expect(more.getAttribute('aria-expanded')).toBe('false');
      fireEvent.click(more);
      expect(more.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByRole('slider', { name: 'Adjust time' })).toBeTruthy();
      fireEvent.click(more);
      expect(screen.queryByRole('slider')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: /^Today/ }));
      expect(screen.getByRole('group', { name: 'Day' })).toBeTruthy();
    });

    it('names the date of an older day on the folded day button', () => {
      renderUi(<Panel compact initial={at(14, 5, 18)} />);
      expect(screen.queryByRole('button', { name: /^Today/ })).toBeNull();
      expect(screen.getByRole('button', { name: /^Sun, Oct 18/ })).toBeTruthy();
    });

    it('keeps the "Still running" switch and hides the row while it is on', () => {
      renderUi(<Panel compact allowRunning initial={null} />);
      expect(screen.getByRole('switch', { name: 'Still running' })).toBeTruthy();
      expect(screen.queryByRole('group', { name: 'Quick times' })).toBeNull();
    });
  });
});
