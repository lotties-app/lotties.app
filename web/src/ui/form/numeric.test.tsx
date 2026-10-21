import { useState } from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTestLocale } from '../../test/locale';
import { renderUi } from '../../test/renderUi';
import { formatDurationInput, parseDuration } from './duration';
import { DurationField } from './DurationField';
import { Field } from './Field';
import { NotesRow } from './NotesRow';
import { NumberStepper } from './NumberStepper';
import { decimalsOf, formatDecimal, parseLocaleNumber, roundTo } from './numbers';

afterEach(() => vi.useRealTimers());

function Stepper(props: Partial<React.ComponentProps<typeof NumberStepper>> & { start?: number }) {
  const [value, setValue] = useState<number | null>(props.value ?? null);
  return (
    <Field label="Amount" required>
      <NumberStepper {...props} value={value} onChange={setValue} />
    </Field>
  );
}

describe('number parsing', () => {
  it('reads dot and comma decimals in any language', () => {
    expect(parseLocaleNumber('7,5')).toBe(7.5);
    expect(parseLocaleNumber('7.5')).toBe(7.5);
    expect(parseLocaleNumber('1.234,5')).toBe(1234.5);
    expect(parseLocaleNumber('1,234.5')).toBe(1234.5);
    expect(parseLocaleNumber(' 12 ')).toBe(12);
    expect(parseLocaleNumber('-3')).toBe(-3);
  });

  it('rejects text, empty input and a second decimal part', () => {
    for (const text of ['', 'abc', '1,2,3x', '1.2.3', '--1', ',']) {
      expect(parseLocaleNumber(text), text).toBeNull();
    }
  });

  it('keeps floating point noise out of steps', () => {
    expect(roundTo(0.1 + 0.2, 1)).toBe(0.3);
    expect(decimalsOf(0.5)).toBe(1);
    expect(decimalsOf(10)).toBe(0);
    expect(formatDecimal(7.5, 1, 'pt-BR')).toBe('7,5');
    expect(formatDecimal(1234.5, 1, 'en')).toBe('1234.5');
  });
});

describe('NumberStepper', () => {
  it('is a spinbutton named by its label, with value text and bounds', () => {
    renderUi(<Stepper value={90} unit="ml" min={0} max={400} />);
    const input = screen.getByRole('spinbutton', { name: /^Amount/ });
    expect(input.getAttribute('aria-valuenow')).toBe('90');
    expect(input.getAttribute('aria-valuemax')).toBe('400');
    expect(input.getAttribute('aria-valuetext')).toBe('90 ml');
    expect(input.getAttribute('inputmode')).toBe('decimal');
    expect(input.getAttribute('aria-required')).toBe('true');
  });

  it('steps with the buttons and the arrow keys, rounding decimal steps', () => {
    renderUi(<Stepper value={36.5} step={0.1} />);
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Increase' })); // keyboard activation
    expect(input.value).toBe('36.6');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.value).toBe('36.4');
  });

  it('clamps to the bounds, disables the button at the bound and says why', () => {
    renderUi(<Stepper value={395} step={10} min={0} max={400} unit="ml" />);
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(input.value).toBe('400');
    expect(screen.getByRole('status').textContent).toBe('Up to 400 ml');
    expect((screen.getByRole('button', { name: 'Increase' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('lets a number be typed and clamps it when leaving the field', () => {
    renderUi(<Stepper value={90} min={0} max={400} unit="ml" />);
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '120' } });
    expect(input.getAttribute('aria-valuenow')).toBe('120');
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.blur(input);
    expect(input.value).toBe('400');
    expect(screen.getByRole('status').textContent).toBe('Up to 400 ml');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(input.value).toBe('');
  });

  it('starts from `start` when empty', () => {
    renderUi(<Stepper start={3.5} step={0.1} />);
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('3.5');
  });

  it('shows the decimal comma in Portuguese and reads both separators', async () => {
    await useTestLocale('pt-BR');
    renderUi(<Stepper value={36.6} step={0.1} unit="°C" />);
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input.value).toBe('36,6');
    expect(screen.getByRole('button', { name: 'Aumentar' })).toBeTruthy();
    fireEvent.change(input, { target: { value: '37,25' } });
    expect(input.getAttribute('aria-valuenow')).toBe('37.25');
    fireEvent.blur(input);
    expect(input.value).toBe('37,3');
  });

  it('offers quick values, marks the last used and selects on tap', () => {
    renderUi(<Stepper value={90} quickValues={[60, 90, 120]} lastValue={150} unit="ml" />);
    const chips = screen.getByRole('group', { name: 'Quick values' });
    expect(chips.querySelectorAll('button')).toHaveLength(4);
    expect(screen.getByRole('button', { name: /150 ml/ }).textContent).toContain('· last');
    expect(screen.getByRole('button', { name: '90 ml' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '120 ml' }));
    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('120');
  });

  describe('press and hold', () => {
    it('steps once on press, then repeats after 400 ms every 90 ms until released', () => {
      vi.useFakeTimers();
      renderUi(<Stepper value={0} step={10} />);
      const input = screen.getByRole('spinbutton') as HTMLInputElement;
      const plus = screen.getByRole('button', { name: 'Increase' });

      fireEvent.pointerDown(plus, { button: 0 });
      expect(input.value).toBe('10');
      act(() => vi.advanceTimersByTime(399));
      expect(input.value).toBe('10');
      act(() => vi.advanceTimersByTime(1 + 90 * 2)); // repeats at 490 and 580 ms
      expect(input.value).toBe('30');
      act(() => vi.advanceTimersByTime(90));
      expect(input.value).toBe('40');

      fireEvent.pointerUp(plus);
      act(() => vi.advanceTimersByTime(1000));
      expect(input.value).toBe('40');
    });

    it('does not double step when the click follows the press', () => {
      vi.useFakeTimers();
      renderUi(<Stepper value={0} step={1} />);
      const plus = screen.getByRole('button', { name: 'Increase' });
      fireEvent.pointerDown(plus, { button: 0 });
      fireEvent.pointerUp(plus);
      fireEvent.click(plus, { detail: 1 });
      expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('1');
    });

    it('stops repeating when the bound is reached', () => {
      vi.useFakeTimers();
      renderUi(<Stepper value={95} step={1} max={100} />);
      const baseline = vi.getTimerCount();
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Increase' }), { button: 0 });
      act(() => vi.advanceTimersByTime(400 + 90 * 20));
      expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe('100');
      expect(vi.getTimerCount()).toBe(baseline);
    });

    it('stops on unmount', () => {
      vi.useFakeTimers();
      const { unmount } = renderUi(<Stepper value={0} step={1} />);
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Increase' }), { button: 0 });
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

describe('duration parsing', () => {
  it('reads minutes, mm:ss, h:mm:ss and decimal minutes into seconds', () => {
    expect(parseDuration('12')).toEqual({ kind: 'ok', seconds: 720 });
    expect(parseDuration('12:30')).toEqual({ kind: 'ok', seconds: 750 });
    expect(parseDuration('0:45')).toEqual({ kind: 'ok', seconds: 45 });
    expect(parseDuration('1:02:03')).toEqual({ kind: 'ok', seconds: 3723 });
    expect(parseDuration('12,5')).toEqual({ kind: 'ok', seconds: 750 });
    expect(parseDuration('12.5')).toEqual({ kind: 'ok', seconds: 750 });
    expect(parseDuration('  8 ')).toEqual({ kind: 'ok', seconds: 480 });
    expect(parseDuration('')).toEqual({ kind: 'empty' });
  });

  it('rejects anything else, including seconds of 60 or more', () => {
    for (const text of ['abc', '12:60', '12:', ':30', '-5', '1:2:3:4', '12 min']) {
      expect(parseDuration(text).kind, text).toBe('invalid');
    }
  });

  it('formats whole minutes plainly and the rest as mm:ss', () => {
    expect(formatDurationInput(720)).toBe('12');
    expect(formatDurationInput(750)).toBe('12:30');
    expect(formatDurationInput(45)).toBe('0:45');
    expect(formatDurationInput(0)).toBe('0');
  });
});

describe('DurationField', () => {
  function Duration({
    initial = null as number | null,
    max,
  }: {
    initial?: number | null;
    max?: number;
  }) {
    const [value, setValue] = useState(initial);
    return (
      <Field label="Left breast">
        <DurationField valueSeconds={value} onChange={setValue} maxSeconds={max} />
        <span data-testid="seconds">{String(value)}</span>
      </Field>
    );
  }

  it('keeps seconds as the stored unit while showing minutes with a localized unit', () => {
    renderUi(<Duration initial={750} />);
    const input = screen.getByLabelText('Left breast') as HTMLInputElement;
    expect(input.value).toBe('12:30');
    expect(screen.getByText('min')).toBeTruthy();
    fireEvent.change(input, { target: { value: '8' } });
    expect(screen.getByTestId('seconds').textContent).toBe('480');
    fireEvent.change(input, { target: { value: '1:15' } });
    expect(screen.getByTestId('seconds').textContent).toBe('75');
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getByTestId('seconds').textContent).toBe('null');
  });

  it('flags text it cannot read once the field is left, then clears on a good value', () => {
    renderUi(<Duration initial={60} />);
    const input = screen.getByLabelText('Left breast') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'soon' } });
    fireEvent.blur(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Enter minutes, like 12 or 12:30.');
    expect(screen.getByTestId('seconds').textContent).toBe('60');
    fireEvent.change(input, { target: { value: '3' } });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByTestId('seconds').textContent).toBe('180');
  });

  it('refuses a duration over the limit', () => {
    renderUi(<Duration max={3600} />);
    const input = screen.getByLabelText('Left breast');
    fireEvent.change(input, { target: { value: '90' } });
    fireEvent.blur(input);
    expect(screen.getByRole('status').textContent).toBe('Up to 60 min.');
    expect(screen.getByTestId('seconds').textContent).toBe('null');
  });

  it('shows Portuguese messages', async () => {
    await useTestLocale('pt-BR');
    renderUi(<Duration initial={60} />);
    const input = screen.getByLabelText('Left breast');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.blur(input);
    expect(screen.getByRole('status').textContent).toBe('Digite minutos, como 12 ou 12:30.');
  });
});

describe('NotesRow', () => {
  function Notes({ initial = '' }) {
    const [value, setValue] = useState(initial);
    return <NotesRow value={value} onChange={setValue} />;
  }

  it('starts collapsed, opens into a focused multiline field and keeps what is typed', () => {
    renderUi(<Notes />);
    const row = screen.getByRole('button', { name: 'Add a note' });
    expect(row.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(row);
    const area = screen.getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(area);
    fireEvent.change(area, { target: { value: 'Slept well' } });
    expect(area.value).toBe('Slept well');
    expect(screen.queryByRole('button', { name: 'Add a note' })).toBeNull();
  });

  it('is already open when there is text and counts characters near the limit', () => {
    renderUi(<Notes initial={'x'.repeat(1850)} />);
    expect(screen.getByRole('textbox', { name: 'Note' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('1850 of 2000 characters');
    expect(screen.getByRole('textbox').getAttribute('maxlength')).toBe('2000');
  });

  it('shows no counter far from the limit and speaks Portuguese', async () => {
    await useTestLocale('pt-BR');
    renderUi(<Notes initial="Dormiu bem" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Observação' })).toBeTruthy();
  });
});
