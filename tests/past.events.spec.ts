import { test, expect } from '@playwright/test';
import { setupPage } from './test-setup';
import { waitForEventsRendered } from './helpers';

test('past events hidden by default and banner on detail', async ({ page }) => {
  await setupPage(page);
  await page.goto('/');
  await waitForEventsRendered(page);

  // Ensure there is a toggle to show past events and it is off
  const toggle = page.locator('input[name="show-past"]');
  await expect(toggle).not.toBeChecked();

  // Enable past events
  await toggle.setChecked(true, { force: true });
  await expect(page).toHaveURL(/past=1/);

  // If there are no past events in fixtures, empty state should be visible
  const pastCards = page.locator('[data-status="past"]');
  if ((await pastCards.count()) === 0) {
    await expect(page.locator('.catalog-empty [data-i18n="empty_state"]')).toBeVisible();
  } else {
    const detailHref = await pastCards.first().locator('.poster-card__cover-link').getAttribute('href');
    expect(detailHref).toBeTruthy();
    await page.goto(String(detailHref));
  }

  // Past event detail shows banner and swaps CTA
  await setupPage(page);
  await page.goto('/event-card.html');
  await expect(page.getByTestId('event-detail-banner-past')).toBeVisible();
  // Ticket CTA replaced
  await expect(page.getByTestId('ticket-cta')).toBeHidden();
  await expect(page.getByTestId('similar-cta').first()).toBeVisible();
});
