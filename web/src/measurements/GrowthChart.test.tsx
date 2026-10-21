import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppThemeProvider } from '../theme/AppThemeProvider';
import type { MeasurementDto } from '../sync/contract';
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
