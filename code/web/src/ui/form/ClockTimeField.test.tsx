import { useState } from 'react';
import axe from 'axe-core';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderUi } from '../../test/renderUi';
import { ClockTimeField } from './ClockTimeField';
import { Field } from './Field';

function Harness({ error }: { error?: string }) {
  const [value, setValue] = useState('08:00');
  const [left, setLeft] = useState(0);
  return (
    <Field label="Reminder" help="When to remind" error={error}>
      <ClockTimeField value={value} onChange={setValue} onBlur={() => setLeft((n) => n + 1)} />
      <span data-testid="value">{value}</span>
      <span data-testid="left">{left}</span>
      <button type="button" onClick={() => setValue('06:15')}>
        Reset
      </button>
    </Field>
  );
}

const input = () => screen.getByLabelText('Reminder') as HTMLInputElement;
const stored = () => screen.getByTestId('value').textContent;

describe('ClockTimeField', () => {
  it('is the native time picker, labelled and described by its Field', () => {
    renderUi(<Harness />);
    expect(input().type).toBe('time');
    expect(input().getAttribute('step')).toBe('60');
    expect(input().value).toBe('08:00');
    const help = screen.getByText('When to remind');
    expect(input().getAttribute('aria-describedby')).toContain(help.id);
  });

  it('reports every native change, midnight included, and the blur', () => {
    renderUi(<Harness />);
    fireEvent.change(input(), { target: { value: '21:30' } });
    expect(stored()).toBe('21:30');
    fireEvent.change(input(), { target: { value: '00:00' } });
    expect(stored()).toBe('00:00');
    fireEvent.blur(input());
    expect(screen.getByTestId('left').textContent).toBe('1');
  });

  it('follows a controlled value change', () => {
    renderUi(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(input().value).toBe('06:15');
  });

  it('is marked invalid by its Field error', () => {
    renderUi(<Harness error="Pick another time" />);
    expect(input().getAttribute('aria-invalid')).toBe('true');
  });

  it('has no axe violations, also with an error', async () => {
    const rules = { rules: { 'color-contrast': { enabled: false } } };
    const { container, unmount } = renderUi(<Harness />);
    expect((await axe.run(container, rules)).violations).toEqual([]);
    unmount();
    const withError = renderUi(<Harness error="Pick another time" />);
    expect((await axe.run(withError.container, rules)).violations).toEqual([]);
  });
});
