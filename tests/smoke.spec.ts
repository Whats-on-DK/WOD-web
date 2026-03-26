import { test, expect } from '@playwright/test';
import { watchConsole } from './utils/console';
import { freezeTime } from './setup.freeze-time';
import { createEventToPreview } from './helpers';

const routes = ['/', '/event-card.html'];

for (const r of routes) {
  test(`smoke: ${r} renders without console errors`, async ({ page }) => {
    await freezeTime(page);
    const errs = watchConsole(page);
    await page.goto(r);
    await expect(page).toHaveTitle(/What.?s on DK|Події|Begivenheder/i);
    const relevantErrors = errs.filter(
      (entry) => !entry.includes('Failed to load resource: the server responded with a status of 404')
    );
    expect(relevantErrors, relevantErrors.join('\n')).toHaveLength(0);
  });
}

test('smoke: create event flow reaches preview', async ({ page }) => {
  await freezeTime(page);
  await createEventToPreview(page);

  // Step 5: preview
  await expect(page.locator('#preview-title')).toContainText('Test meetup');
  await expect(page.locator('#preview-tags')).toContainText(/Community/i);
  await expect(page.locator('#preview-time')).toContainText(/01\.05\.2030/);
  await expect(page.locator('#preview-time')).toContainText('18:00');
  await expect(page.locator('#preview-time')).toContainText('20:00');
  await expect(page.locator('#preview-location')).toContainText('Copenhagen, Main St 10');
  await expect(page.locator('#preview-tickets')).toContainText(/Платно|Paid|Betalt/i);
  await expect(page.locator('#preview-tickets')).toContainText(/50–120/);
  await expect(page.locator('#preview-format')).toContainText(/Офлайн|Offline/i);
});
