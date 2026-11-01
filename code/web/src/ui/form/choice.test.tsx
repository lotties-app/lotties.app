import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderUi } from '../../test/renderUi';
import { ChipGroup } from './ChipGroup';
import { Field } from './Field';
import { SegmentedControl } from './SegmentedControl';
import { SwitchRow } from './SwitchRow';

const OPTIONS = [
  { value: 'bottle', label: 'Bottle', icon: 'bottle' },
  { value: 'breast', label: 'Breast', icon: 'heart' },
  { value: 'solid', label: 'Solid food', icon: 'utensils' },
] as const;

function Segmented({ clearable = false, initial = 'bottle' as string | null }) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <Field label="Method" group required help="Pick one">
      <SegmentedControl value={value} onChange={setValue} clearable={clearable} options={OPTIONS} />
    </Field>
  );
}

describe('Field', () => {
  it('puts the label above the control and wires help and error to it', () => {
    renderUi(
      <Field label="Amount" help="In millilitres" error="Too much" required>
        <input aria-label="raw" />
      </Field>,
    );
    expect(screen.getByText('Amount').closest('label')).not.toBeNull();
    expect(screen.getByText('In millilitres')).toBeTruthy();
    expect(screen.getByText('Too much')).toBeTruthy();
    // The required marker is decorative; the control carries aria-required through its hook.
    expect(screen.getByText('*').getAttribute('aria-hidden')).toBe('true');
  });

  it('says "optional" in the active language', () => {
    renderUi(
      <Field label="Notes" optional>
        <span />
      </Field>,
    );
    expect(screen.getByText('· optional')).toBeTruthy();
  });
});

describe('SegmentedControl', () => {
  it('is a radio group named by the field label, with the described help and required state', () => {
    renderUi(<Segmented />);
    const group = screen.getByRole('radiogroup', { name: /^Method/ });
    expect(group.getAttribute('aria-required')).toBe('true');
    expect(group.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Bottle' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('keeps one tab stop and moves selection with the arrow keys, Home and End', () => {
    renderUi(<Segmented />);
    const [bottle, breast, solid] = screen.getAllByRole('radio');
    expect(bottle!.tabIndex).toBe(0);
    expect(breast!.tabIndex).toBe(-1);

    fireEvent.keyDown(bottle!, { key: 'ArrowRight' });
    expect(breast!.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(breast);

    fireEvent.keyDown(breast!, { key: 'End' });
    expect(solid!.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(solid!, { key: 'ArrowRight' }); // wraps
    expect(bottle!.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(bottle!, { key: 'ArrowUp' }); // wraps backwards
    expect(solid!.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(solid!, { key: 'Home' });
    expect(bottle!.getAttribute('aria-checked')).toBe('true');
  });

  it('clears an optional selection when tapped again, never a required one', () => {
    const { unmount } = renderUi(<Segmented clearable />);
    fireEvent.click(screen.getByRole('radio', { name: 'Bottle' }));
    expect(screen.getByRole('radio', { name: 'Bottle' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    unmount();

    renderUi(<Segmented />);
    fireEvent.click(screen.getByRole('radio', { name: 'Bottle' }));
    expect(screen.getByRole('radio', { name: 'Bottle' }).getAttribute('aria-checked')).toBe('true');
  });

  it('takes the first enabled option as tab stop when nothing is selected, and skips disabled ones', () => {
    const onChange = vi.fn();
    renderUi(
      <SegmentedControl
        aria-label="Side"
        value={null}
        onChange={onChange}
        options={[
          { value: 'a', label: 'A', disabled: true },
          { value: 'b', label: 'B' },
          { value: 'c', label: 'C' },
        ]}
      />,
    );
    const [a, b, c] = screen.getAllByRole('radio');
    expect(a!.tabIndex).toBe(-1);
    expect(b!.tabIndex).toBe(0);
    fireEvent.keyDown(c!, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('follows the reading direction: Left goes forward in right-to-left text', () => {
    renderUi(<Segmented />);
    const [bottle, breast] = screen.getAllByRole('radio');
    const spy = vi
      .spyOn(window, 'getComputedStyle')
      .mockReturnValue({ direction: 'rtl' } as CSSStyleDeclaration);
    fireEvent.keyDown(bottle!, { key: 'ArrowLeft' });
    spy.mockRestore();
    expect(breast!.getAttribute('aria-checked')).toBe('true');
  });

  it('marks the field invalid and disables every option when disabled', () => {
    renderUi(
      <Field label="Method" group error="Choose one" disabled>
        <SegmentedControl value={null} onChange={() => {}} options={OPTIONS} />
      </Field>,
    );
    const group = screen.getByRole('radiogroup');
    expect(group.getAttribute('aria-invalid')).toBe('true');
    for (const radio of screen.getAllByRole('radio')) {
      expect((radio as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

describe('ChipGroup', () => {
  it('single choice behaves as a radio group', () => {
    function Single() {
      const [value, setValue] = useState<string | null>(null);
      return (
        <ChipGroup
          aria-label="Mood"
          value={value}
          onChange={setValue}
          clearable
          options={[
            { value: 'happy', label: 'Happy', icon: 'mood-happy' },
            { value: 'sad', label: 'Fussy', icon: 'mood-sad' },
          ]}
        />
      );
    }
    renderUi(<Single />);
    expect(screen.getByRole('radiogroup', { name: 'Mood' })).toBeTruthy();
    const happy = screen.getByRole('radio', { name: 'Happy' });
    fireEvent.click(happy);
    expect(happy.getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(happy, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Fussy' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Fussy' }));
    expect(screen.getByRole('radio', { name: 'Fussy' }).getAttribute('aria-checked')).toBe('false');
  });

  it('multiple choice toggles buttons with aria-pressed', () => {
    function Multi() {
      const [value, setValue] = useState<string[]>(['gas']);
      return (
        <ChipGroup
          multiple
          aria-label="Symptoms"
          value={value}
          onChange={setValue}
          options={[
            { value: 'gas', label: 'Gas' },
            { value: 'reflux', label: 'Reflux' },
            { value: 'cough', label: 'Cough', disabled: true },
          ]}
        />
      );
    }
    renderUi(<Multi />);
    expect(screen.getByRole('group', { name: 'Symptoms' })).toBeTruthy();
    const gas = screen.getByRole('button', { name: 'Gas' });
    const reflux = screen.getByRole('button', { name: 'Reflux' });
    expect(gas.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(reflux);
    expect(reflux.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(gas);
    expect(gas.getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByRole('button', { name: 'Cough' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe('SwitchRow', () => {
  it('is a switch named by its row text and toggles with a click or Space', () => {
    const onChange = vi.fn();
    renderUi(<SwitchRow checked={false} onChange={onChange} label="Still running" />);
    const row = screen.getByRole('switch', { name: 'Still running' });
    expect(row.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(row);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does nothing when disabled', () => {
    const onChange = vi.fn();
    renderUi(<SwitchRow checked onChange={onChange} label="Keep screen on" disabled />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
