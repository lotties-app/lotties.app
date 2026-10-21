import { useState } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { dateFromIso, isoFromDate } from './dateValue';
import { setDateField } from '../../test/dateField';
import { useTestLocale } from '../../test/locale';
import { renderUi } from '../../test/renderUi';
import { DateField } from './DateField';
import { Field } from './Field';

function Birth({ initial = '2026-03-04', max }: { initial?: string; max?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <Field label="Birth date" group required>
      <DateField value={value} onChange={setValue} max={max} />
      <span data-testid="value">{value || 'empty'}</span>
    </Field>
  );
}

describe('date values', () => {
  it('converts calendar dates without any time zone shift', () => {
    const date = dateFromIso('2026-03-04')!;
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 2, 4]);
    expect(isoFromDate(date)).toBe('2026-03-04');
    expect(isoFromDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
    expect(isoFromDate(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });

  it('rejects blank and impossible dates', () => {
    for (const text of ['', '2026-02-30', '2026-13-01', '26-03-04', 'x']) {
      expect(dateFromIso(text), text).toBeNull();
    }
    expect(isoFromDate(null)).toBe('');
    expect(isoFromDate(new Date(Number.NaN))).toBe('');
  });
});

describe('DateField', () => {
  it('loads on demand and is a group named by the field label with Month, Day and Year parts', async () => {
    renderUi(<Birth />);
    const group = await screen.findByRole('group', { name: /^Birth date/ });
    expect(within(group).getByRole('spinbutton', { name: 'Month' })).toBeTruthy();
    expect(within(group).getByRole('spinbutton', { name: 'Day' })).toBeTruthy();
    expect(within(group).getByRole('spinbutton', { name: 'Year' })).toBeTruthy();
    expect(within(group).getByRole('spinbutton', { name: 'Day' }).textContent).toBe('04');
  });

  it('follows the app language for the order and the labels', async () => {
    await useTestLocale('pt-BR');
    renderUi(<Birth />);
    const group = await screen.findByRole('group', { name: /^Birth date/ });
    const parts = within(group)
      .getAllByRole('spinbutton')
      .map((part) => part.getAttribute('aria-label'));
    expect(parts).toEqual(['Dia', 'Mês', 'Ano']);
    expect(group.querySelector<HTMLInputElement>('input[aria-hidden="true"]')!.value).toBe(
      '04/03/2026',
    );
  });

  it('accepts a typed date (through the field input) and reports it as yyyy-mm-dd', async () => {
    renderUi(<Birth />);
    await setDateField(/^Birth date/, '2026-09-01');
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('2026-09-01'));
  });

  it('accepts a typed date in Portuguese order', async () => {
    await useTestLocale('pt-BR');
    renderUi(<Birth />);
    await setDateField(/^Birth date/, '2026-09-21', 'pt-BR');
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('2026-09-21'));
  });

  it('opens a themed dialog on small screens and picks a day', async () => {
    renderUi(<Birth max="2026-10-21" />);
    await screen.findByRole('group', { name: /^Birth date/ });
    fireEvent.click(screen.getByRole('button', { name: /^Choose date/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('gridcell', { name: '15' }));
    await waitFor(() => expect(screen.getByTestId('value').textContent).toBe('2026-03-15'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('disables days after the maximum in the calendar', async () => {
    renderUi(<Birth initial="2026-10-10" max="2026-10-21" />);
    await screen.findByRole('group', { name: /^Birth date/ });
    fireEvent.click(screen.getByRole('button', { name: /^Choose date/ }));
    const dialog = await screen.findByRole('dialog');
    expect(
      (within(dialog).getByRole('gridcell', { name: '22' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (within(dialog).getByRole('gridcell', { name: '21' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
