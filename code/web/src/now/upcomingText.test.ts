import { afterEach, describe, expect, it } from 'vitest';
import { activateLocale, t } from '../i18n/i18n';
import { useTestLocale } from '../test/locale';
import { rhythmLabel, upcomingClusterDetail, upcomingText } from './rhythmDetails';
import type { UpcomingItem } from './upcoming';
import {
  bellyItem,
  bottleItem,
  dirtyItem,
  medicineItem,
  upAt as at,
  wetItem,
} from './ui/upcomingKit';

/*
 * The sentences of the "next up" markers (strip, marker name, list row): estimates say so, every
 * number comes with its basis, no judgement, no advice, no alarm.
 */

const text = (item: UpcomingItem) => rhythmLabel(upcomingText(item, t));

afterEach(async () => {
  await activateLocale('en');
});

describe('upcomingText', () => {
  it('writes a feed with its fallbacks: all bottles, the age norm, nursing, none', () => {
    const all = bottleItem(at(16, 10), {
      windowStart: undefined,
      windowEnd: undefined,
      amountMl: { low: 100, typical: 100, high: 100 },
      basis: {
        kind: 'feed',
        time: { kind: 'ownGap', gapMinutes: 150, dayPart: 'afternoon', samples: 5 },
        method: 'bottle',
        dayPart: 'afternoon',
        due: false,
        amount: { kind: 'allBottles', dayPart: 'afternoon', samples: 3, days: 14, byPart: [] },
      },
    });
    expect(text(all)).toBe(
      'Next bottle about 16:10 (estimate). Usually about 100 ml. Based on 3 bottles in the last 14 days. Feeds in the afternoon usually start about every 2h 30m.',
    );
    const norm = bottleItem(at(16, 10), {
      windowStart: undefined,
      windowEnd: undefined,
      confidence: 'low',
      amountMl: { low: 90, typical: null, high: 150 },
      basis: {
        kind: 'feed',
        time: { kind: 'serverGap', gapMinutes: 180 },
        method: 'bottle',
        dayPart: 'afternoon',
        due: true,
        amount: { kind: 'ageNorm', normId: 'n' },
      },
    });
    expect(text(norm)).toBe(
      'A bottle is likely any time now (estimate). A common range at this age is 90–150 ml (published range, not a target). Feeds usually start about every 3h. Low confidence.',
    );
    const nursing = bottleItem(at(16, 10), {
      amountMl: undefined,
      basis: {
        kind: 'feed',
        time: { kind: 'ageNorm', gapMinutes: 120 },
        method: 'breast',
        dayPart: 'afternoon',
        due: false,
        amount: null,
      },
    });
    expect(text(nursing)).toBe(
      'Next feed about 16:10 (estimate). Likely between 15:40 and 16:40. Recent feeds at this time were mostly nursing. From the published time between feeds at this age, about 2h.',
    );
  });

  it('says why a feed comes earlier after a smaller bottle, in both languages', async () => {
    const partial = bottleItem(at(15, 20), {
      windowStart: undefined,
      windowEnd: undefined,
      amountMl: undefined,
      basis: {
        kind: 'feed',
        time: { kind: 'ownGap', gapMinutes: 180, dayPart: null, samples: 6 },
        partialFeed: { drunkMl: 80, usualMl: 117.5, endedBySleep: false, minutesEarlier: 30 },
        method: 'bottle',
        dayPart: 'afternoon',
        due: false,
        amount: null,
      },
    });
    expect(text(partial)).toBe(
      'Next bottle about 15:20 (estimate). The last one was smaller than usual (80 of about 120 ml), so a top-up is expected sooner. Feeds usually start about every 3h.',
    );
    await useTestLocale('pt-BR');
    expect(text(partial)).toBe(
      'Próxima mamadeira por volta das 15:20 (estimativa). A última foi menor que o habitual (80 de cerca de 120 ml), então um complemento é esperado mais cedo. As mamadas costumam começar cerca de a cada 3 h.',
    );
  });

  it('writes diapers: the wet one, a poop window, after feeds', () => {
    expect(text(wetItem(at(16, 40)))).toBe(
      'Wet diaper likely around 16:40 (estimate). Likely between 16:20 and 17:00. Usually about every 2h 30m.',
    );
    expect(text(dirtyItem(at(19)))).toBe(
      'A poop is likely between 18:00 and 20:00 (estimate). Usually about once a day. Low confidence.',
    );
    const afterFeed = dirtyItem(at(15), {
      confidence: 'medium',
      basis: {
        kind: 'diaper',
        signal: 'afterFeed',
        medianMinutes: 35,
        samples: 6,
        daily: false,
        due: false,
      },
    });
    expect(text(afterFeed)).toBe(
      'A poop is likely between 14:00 and 16:00 (estimate). Often about 35m after a feed.',
    );
  });

  it('writes patterns ahead and open now', () => {
    expect(text(bellyItem(at(18, 30)))).toBe(
      'Belly pain tends to start around 18:30. Pattern from the log, usually 18:00 to 19:30.',
    );
    const open = bellyItem(at(18, 40), {
      kind: 'fussy',
      basis: { kind: 'pattern', typicalClock: '18:30', days: 6, due: true },
    });
    expect(text(open)).toBe(
      'Fussy time tends to come around now, until about 19:40. Pattern from the log, usually 18:10 to 19:40.',
    );
  });

  it('writes medicine as prescribed, never the dose', () => {
    expect(text(medicineItem(at(20)))).toBe('Vitamin D scheduled 20:00. From the prescription.');
    const part = medicineItem(at(19), 'Colidis', {
      windowStart: at(18),
      windowEnd: at(22),
      basis: {
        kind: 'medicine',
        name: 'Colidis',
        prescriptionId: 'rx',
        schedule: 'dayPart',
        dayPart: 'evening',
        reminderAt: at(19),
      },
    });
    expect(text(part)).toBe(
      'Colidis in the evening. Any time from 18:00 to 22:00. Reminder at 19:00. From the prescription.',
    );
    const every = medicineItem(at(16), ' ', {
      basis: {
        kind: 'medicine',
        name: ' ',
        prescriptionId: 'rx',
        schedule: 'interval',
        everyMinutes: 360,
      },
    });
    expect(text(every)).toBe(
      'Medicine scheduled 16:00. Every 6h after the last dose. From the prescription.',
    );
  });

  it('writes a cluster as a count and its items', () => {
    const detail = upcomingClusterDetail([medicineItem(at(21, 5), 'B'), wetItem(at(21))]);
    expect(detail.key).toBe('up-cluster-diaperWet');
    expect(upcomingText(detail.items[0], t).title).toBe(
      'Wet diaper likely around 21:00 (estimate)',
    );
  });

  it('speaks Portuguese', async () => {
    await useTestLocale('pt-BR');
    expect(text(dirtyItem(at(19)))).toBe(
      'Um cocô é provável entre 18:00 e 20:00 (estimativa). Em geral cerca de uma vez por dia. Confiança baixa.',
    );
    expect(text(medicineItem(at(20), 'Vitamina D'))).toBe('Vitamina D às 20:00. Da receita.');
  });
});
