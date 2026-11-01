import { describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { endAccountSession } from './endSession';

function fakeDb(order: string[]): BabyRoutineDb {
  return {
    delete: async () => {
      order.push('db');
    },
  } as unknown as BabyRoutineDb;
}

describe('endAccountSession', () => {
  it('releases the push device first, while the access token still works', async () => {
    const order: string[] = [];
    await endAccountSession(
      fakeDb(order),
      async () => {
        order.push('logout');
      },
      async () => {
        order.push('push');
      },
    );
    expect(order).toEqual(['push', 'db', 'logout']);
  });

  it('signs out even when releasing the device fails', async () => {
    const order: string[] = [];
    await endAccountSession(
      fakeDb(order),
      async () => {
        order.push('logout');
      },
      async () => {
        throw new Error('push failed');
      },
    );
    expect(order).toEqual(['db', 'logout']);
  });
});
