import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppThemeProvider } from '../theme/AppThemeProvider';
import type { MeasurementDto } from '../sync/contract';
import { labelSize, MIN_LABEL_PX } from './chartScale';
import { GrowthChart } from './GrowthChart';
import { METRICS } from './measurementModel';

function m(date: string, weightKg: number | null): MeasurementDto {
  return {
    id: date,
    babyId: 'b',
    date,
    weightKg,
    heightCm: null,
    headCircumferenceCm: null,
    notes: null,
    createdBy: null,
    createdAt: date,
    updatedAt: date,
  };
}

const renderChart = (measurements: MeasurementDto[]) =>
  render(
    <AppThemeProvider>
      <GrowthChart metric={METRICS[0]} measurements={measurements} />
    </AppThemeProvider>,
  );

describe('GrowthChart', () => {
  it('draws a point per measurement and a line', () => {
    const { container } = renderChart([
      m('2026-09-01', 4),
      m('2026-10-01', 5),
      m('2026-10-02', null),
    ]);
    expect(screen.getAllByTestId('chart-point')).toHaveLength(2);
    expect(container.querySelector('polyline')).not.toBeNull();
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/4 kg.*5 kg/);
    expect(screen.getByText('Latest 5 kg')).toBeTruthy();
  });

  it('draws a single point without a line', () => {
    const { container } = renderChart([m('2026-10-01', 5)]);
    expect(screen.getAllByTestId('chart-point')).toHaveLength(1);
    expect(container.querySelector('polyline')).toBeNull();
  });

  it('shows an empty state when the metric has no data', () => {
    renderChart([m('2026-10-01', null)]);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('No weight measurements yet.')).toBeTruthy();
  });
});

describe('GrowthChart label size (review 05 M13)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const renderedPx = (container: HTMLElement, width: number) =>
    [...container.querySelectorAll('text')].map(
      (text) => (Number(text.getAttribute('font-size')) * width) / 480,
    );

  it.each([256, 320, 416, 480, 1200])('renders labels at 12 px or more at %i px wide', (width) => {
    expect((labelSize(width) * width) / 480).toBeGreaterThanOrEqual(MIN_LABEL_PX);
  });

  it('assumes the narrowest phone column before measuring', () => {
    const { container } = renderChart([m('2026-09-01', 4), m('2026-10-01', 5)]);
    for (const px of renderedPx(container, 256)) expect(px).toBeGreaterThanOrEqual(MIN_LABEL_PX);
  });

  it('follows the measured width', () => {
    let report: (width: number) => void = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          report = (width) =>
            callback([{ contentRect: { width } } as ResizeObserverEntry], this as never);
        }
        observe() {}
        disconnect() {}
      },
    );
    const { container } = renderChart([m('2026-09-01', 4), m('2026-10-01', 5)]);
    act(() => report(300));
    const sizes = renderedPx(container, 300);
    expect(sizes.length).toBeGreaterThan(2);
    for (const px of sizes) expect(px).toBeGreaterThanOrEqual(MIN_LABEL_PX);
    act(() => report(960));
    expect(Number(container.querySelector('text')?.getAttribute('font-size'))).toBe(11);
  });
});
