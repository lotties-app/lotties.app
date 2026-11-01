import { describe, expect, it } from 'vitest';
import { clearAccountDeviceState } from '../session/deviceState';
import { localPushDeviceRecord } from './pushDeviceRecord';
import { readPromptDismissedAt, writePromptDismissedAt } from './reminderPrompt';

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/x';

describe('localPushDeviceRecord', () => {
  it('round-trips the opt-in and reads anything malformed as not opted in', () => {
    expect(localPushDeviceRecord.read()).toBeNull();
    localPushDeviceRecord.write({ endpoint: ENDPOINT, id: null });
    expect(localPushDeviceRecord.read()).toEqual({ endpoint: ENDPOINT, id: null });
    localPushDeviceRecord.write({ endpoint: ENDPOINT, id: 'abc' });
    expect(localPushDeviceRecord.read()?.id).toBe('abc');
    window.localStorage.setItem('baby-routine.push-device', '{"endpoint":42}');
    expect(localPushDeviceRecord.read()).toBeNull();
    window.localStorage.setItem('baby-routine.push-device', 'not json');
    expect(localPushDeviceRecord.read()).toBeNull();
  });

  it('is cleared with the account, together with the reminder card dismissal', () => {
    localPushDeviceRecord.write({ endpoint: ENDPOINT, id: 'abc' });
    writePromptDismissedAt(new Date());
    clearAccountDeviceState();
    expect(localPushDeviceRecord.read()).toBeNull();
    expect(readPromptDismissedAt()).toBeNull();
  });
});
