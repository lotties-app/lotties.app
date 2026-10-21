import { expect, test } from '@playwright/test';
import { API_URL } from '../playwright.config';
import { accessToken, apiGet, openApp, type EventDto } from '../support/app';
import { deleteSessionSnapshot, freshSession, onlyReviewBaby, readState, startKeeper, stopKeeper } from './lib';

// Stops the review's running timer (so the test baby is left without an open event), lists what
// the review created, and deletes the token snapshot kept in output/.
test('cleanup', async ({ browser }) => {
  const { babyId, babyName, runningEventId } = readState();
  if (!babyId) return;
  await startKeeper(browser);
  const context = await browser.newContext({ storageState: await freshSession() });
  await onlyReviewBaby(context, babyId);
  const page = await context.newPage();
  await openApp(page);
  const events = await apiGet<EventDto[]>(page, `/api/v1/babies/${babyId}/events`);
  const running = events.find((e) => e.id === runningEventId);
  if (running && running.endedAt === null) {
    const response = await page.request.put(`${API_URL}/api/v1/babies/${babyId}/events/${running.id}`, {
      headers: { Authorization: `Bearer ${await accessToken(page)}` },
      data: {
        typeId: running.typeId,
        startedAt: running.startedAt,
        endedAt: new Date().toISOString(),
        payload: running.payload ?? {},
        notes: running.notes,
        updatedAt: new Date().toISOString(),
      },
    });
    expect(response.ok()).toBe(true);
  }
  const live = events.filter((e) => !e.deletedAt);
  const meds = await apiGet<{ name: string }[]>(page, `/api/v1/babies/${babyId}/medications`);
  const measurements = await apiGet<unknown[]>(page, `/api/v1/babies/${babyId}/measurements`);
  const invites = await apiGet<unknown[]>(page, `/api/v1/babies/${babyId}/invites`);
  console.log(
    JSON.stringify({ babyName, babyId, events: live.length, medications: meds.map((m) => m.name), measurements: measurements.length, pendingInvites: invites.length }),
  );
  await context.close();
  await stopKeeper();
  deleteSessionSnapshot();
});
