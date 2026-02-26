import { test, expect } from '@playwright/test';
import { freezeTime } from './setup.freeze-time';

async function gotoAndWaitForEvents(page, url) {
  await Promise.all([
    page.waitForResponse(/data\/events\.json/),
    page.goto(url),
  ]);
  await page.waitForSelector('[data-testid="event-card"]', { state: 'visible' });
}

test('search + weekend preset filters results and keeps URL in sync', async ({ page }) => {
  await freezeTime(page);
  await gotoAndWaitForEvents(page, '/');

  const input = page.getByTestId('search-input');
  await input.fill('music');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/q=music/);

  const weekend = page.getByTestId('filters-weekend');
  await weekend.click();
  await expect(page).toHaveURL(/weekend=1/);

  await expect(page.locator('[data-i18n="found_count"]')).toContainText(/\d+/);
});

test('go to event detail and show proper CTA for future/past', async ({ page }) => {
  await freezeTime(page);
  await gotoAndWaitForEvents(page, '/');

  const first = page.getByTestId('event-card').first();
  const detailHref = await first.locator('.poster-card__cover-link').first().getAttribute('href');
  expect(detailHref).toBeTruthy();
  await page.goto(String(detailHref));

  const ticketCTA = page.getByTestId('ticket-cta');
  const pastBanner = page.getByTestId('event-detail-banner-past');

  if (await pastBanner.isVisible()) {
    await expect(ticketCTA).toBeHidden();
    await expect(page.getByTestId('similar-cta').first()).toBeVisible();
  } else {
    await expect(ticketCTA).toBeVisible();
  }
});
