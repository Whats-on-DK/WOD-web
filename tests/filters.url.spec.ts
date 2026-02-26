import { test, expect } from '@playwright/test';
import { waitForEventsRendered } from './helpers';

test('filters update URL and back/forward restores state', async ({ page }) => {
  await page.goto('/');
  await waitForEventsRendered(page);
  await page.getByTestId('search-input').fill('music');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/q=music/);

  // Quick preset: "Вихідні"/"Weekend"
  const weekend = page.getByTestId('filters-weekend');
  await weekend.click();
  await expect(page).toHaveURL(/weekend=1/);

  // Back restores
  await page.goBack();
  await expect(page).toHaveURL(/q=music/);
});

test('page query param opens requested catalog page', async ({ page }) => {
  await page.goto('/');
  await waitForEventsRendered(page);
  await page.goto('/?page=2');
  await waitForEventsRendered(page);

  await expect(page).toHaveURL(/page=2/);

  const pagination = page.locator('[data-catalog-pages] .catalog-page');
  const pageTwo = pagination.filter({ hasText: '2' }).first();
  if (await pageTwo.count()) {
    await expect(pageTwo).toHaveAttribute('aria-current', 'page');
  }
});

test('quick date presets toggle off clears URL and date inputs', async ({ page }) => {
  await page.goto('/');
  await waitForEventsRendered(page);

  const weekend = page.getByTestId('filters-weekend');
  await weekend.click();
  await expect(page).toHaveURL(/weekend=1/);

  await weekend.click();
  await expect(page).not.toHaveURL(/weekend=1/);

  const dateFrom = page.locator('input[name="date-from"]');
  const dateTo = page.locator('input[name="date-to"]');
  await expect(dateFrom).toHaveValue('');
  await expect(dateTo).toHaveValue('');
});

test('deep-link tags applies on initial load and keeps tags in URL', async ({ page }) => {
  await page.goto('/?tags=community');
  await waitForEventsRendered(page);

  const advancedToggle = page.locator('[data-action="filters-advanced"]');
  const advancedPanel = page.locator('#filters-advanced');
  if ((await advancedPanel.isVisible()) === false) {
    await advancedToggle.click();
  }

  const communityTagInput = page.locator('[data-filters-tags-list] input[name="tags"][value="community"]').first();
  await expect(communityTagInput).toBeVisible();
  await expect(communityTagInput).toBeChecked();
  await expect(page).toHaveURL(/tags=community/);

  const cards = page.getByTestId('event-card');
  await expect(cards.first()).toBeVisible();
  const filteredCount = await cards.count();
  expect(filteredCount).toBeGreaterThan(0);

  await page.goto('/');
  await waitForEventsRendered(page);
  const totalCount = await page.getByTestId('event-card').count();
  expect(filteredCount).toBeLessThanOrEqual(totalCount);
});

test('deep-link dates and tags apply together on initial load', async ({ page }) => {
  await page.goto('/?from=2031-01-01&to=2031-01-31&tags=community');
  await waitForEventsRendered(page);

  await expect(page.locator('input[name="date-from"]')).toHaveValue('2031-01-01');
  await expect(page.locator('input[name="date-to"]')).toHaveValue('2031-01-31');
  await expect(page).toHaveURL(/from=2031-01-01/);
  await expect(page).toHaveURL(/to=2031-01-31/);
  await expect(page).toHaveURL(/tags=community/);

  const advancedToggle = page.locator('[data-action="filters-advanced"]');
  const advancedPanel = page.locator('#filters-advanced');
  if ((await advancedPanel.isVisible()) === false) {
    await advancedToggle.click();
  }
  const communityTagInput = page.locator('[data-filters-tags-list] input[name="tags"][value="community"]').first();
  await expect(communityTagInput).toBeChecked();
  const cards = page.getByTestId('event-card');
  await expect(cards.first()).toBeVisible();
  const filteredCount = await cards.count();
  expect(filteredCount).toBeGreaterThan(0);

  await page.goto('/?from=2031-01-01&to=2031-01-31');
  await waitForEventsRendered(page);
  const dateOnlyCount = await page.getByTestId('event-card').count();
  expect(filteredCount).toBeLessThanOrEqual(dateOnlyCount);
});

test('unknown deep-link tag does not crash and keeps URL param', async ({ page }) => {
  await page.goto('/?tags=nonexistenttag');
  await expect(page.locator('.catalog-empty')).toBeVisible();
  await expect(page.getByTestId('event-card')).toHaveCount(0);
  await expect(page).toHaveURL(/tags=nonexistenttag/);
});
