import { test, expect } from '@playwright/test';
import { freezeTime } from './setup.freeze-time';
import { waitForEventsRendered } from './helpers';

test('saved events persist and favorites filter shows only saved cards', async ({ page }) => {
  await freezeTime(page);
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.removeItem('wod_saved_events');
  });
  await page.reload();
  await waitForEventsRendered(page);

  const firstCard = page.getByTestId('event-card').first();
  const savedEventId = await firstCard.getAttribute('data-event-id');
  expect(savedEventId).toBeTruthy();

  const cardStar = firstCard.locator('[data-action="toggle-saved"]');
  await cardStar.click();
  await expect(cardStar).toHaveAttribute('data-saved', 'true');
  await expect(page.locator('[data-saved-toast]')).toHaveText('Додано у вибрані');

  await page.reload();
  await waitForEventsRendered(page);

  const savedCardStar = page.locator(
    `[data-testid="event-card"][data-event-id="${savedEventId}"] [data-action="toggle-saved"]`
  );
  await expect(savedCardStar).toHaveAttribute('data-saved', 'true');

  await page.getByTestId('filters-favorites').click();
  await expect(page).toHaveURL(/favorites=1/);

  const visibleIds = await page.$$eval('[data-testid="event-card"]', (cards) =>
    cards.map((card) => card.getAttribute('data-event-id')).filter(Boolean)
  );
  expect(visibleIds).toEqual([savedEventId]);

  const detailHref = await page
    .locator(`[data-testid="event-card"][data-event-id="${savedEventId}"] .poster-card__cover-link`)
    .getAttribute('href');
  expect(detailHref).toBeTruthy();
  await page.goto(String(detailHref));
  const detailStar = page.locator('.event-article__title-row [data-event-save]');
  await expect(detailStar).toBeVisible();
  await expect(detailStar).toHaveAttribute('data-saved', 'true');
  await detailStar.click();
  await expect(page.locator('[data-saved-toast]')).toHaveText('Прибрано з вибраних');
  await expect(detailStar).toHaveAttribute('data-saved', 'false');

  await page.getByRole('link', { name: /До каталогу/i }).click();
  await waitForEventsRendered(page);
  const catalogStar = page.locator(
    `[data-testid="event-card"][data-event-id="${savedEventId}"] [data-action="toggle-saved"]`
  );
  await expect(catalogStar).toHaveAttribute('data-saved', 'false');
});
