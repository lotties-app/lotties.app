import { fireEvent, screen } from '@testing-library/react';

/**
 * Types a date into the app's `DateField` (the MUI X field). The field keeps a hidden input that
 * takes the whole formatted date (it is what browser autofill writes to), which is the practical
 * way to enter a date in jsdom. `iso` is `yyyy-mm-dd`.
 */
export async function setDateField(name: string | RegExp, iso: string, language = 'en') {
  const group = await screen.findByRole('group', { name });
  const input = group.querySelector<HTMLInputElement>('input[aria-hidden="true"]');
  if (!input) throw new Error('The date field has no input');
  const [year, month, day] = iso.split('-');
  fireEvent.change(input, {
    target: { value: language === 'pt-BR' ? `${day}/${month}/${year}` : `${month}/${day}/${year}` },
  });
}
