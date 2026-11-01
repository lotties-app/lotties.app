import { describe, expect, it } from 'vitest';
import { bottlePauseSummary } from './bottlePauses';

const bottle = (payload: Record<string, unknown>, endedAt: string | null = '2026-11-01T10:30:00.000Z') => ({
  payload: { method: 'bottle', amount_ml: 120, ...payload },
  endedAt,
});

describe('bottlePauseSummary', () => {
  it('counts the pauses and lists the level where each one happened', () => {
    const summary = bottlePauseSummary(
      bottle({ pause_count: 2, paused_seconds: 300, segments: '120>80@240;80>30@180;30>0@60' }),
    );
    expect(summary).toEqual({ count: 2, leftMl: [80, 30] });
  });

  it('leaves out a pause whose level was not given', () => {
    const summary = bottlePauseSummary(
      bottle({ pause_count: 2, paused_seconds: 300, segments: '120>?@240;?>30@180;30>0@60' }),
    );
    expect(summary).toEqual({ count: 2, leftMl: [30] });
  });

  it('counts a pause that is open now', () => {
    const summary = bottlePauseSummary(
      bottle({ paused_at: '2026-11-01T10:20:00.000Z', segments: '120>80@240' }, null),
    );
    expect(summary).toEqual({ count: 1, leftMl: [80] });
  });

  it('is null for a bottle that never paused and for other feeds', () => {
    expect(bottlePauseSummary(bottle({}))).toBeNull();
    expect(bottlePauseSummary({ payload: { method: 'breast', pause_count: 2 }, endedAt: null })).toBeNull();
  });
});
