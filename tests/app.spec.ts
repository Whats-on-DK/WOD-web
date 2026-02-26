import { test, expect } from '@playwright/test';
import { waitForEventsRendered } from './helpers';

const setup = async (page) => {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await waitForEventsRendered(page);
};

test('theme toggle switches and restores theme', async ({ page }) => {
  await setup(page);
  const html = page.locator('html');
  const themeButton = page.locator('.theme-toggle');

  const initialTheme = await html.getAttribute('data-theme');
  await themeButton.click();
  await expect(html).not.toHaveAttribute('data-theme', initialTheme || '');

  await themeButton.click();
  if (initialTheme) {
    await expect(html).toHaveAttribute('data-theme', initialTheme);
  } else {
    await expect(html).not.toHaveAttribute('data-theme', 'dark');
  }
});

test('UA localization renders search label', async ({ page }) => {
  await setup(page);
  const searchLabel = page.locator('label[for="header-search"][data-i18n="search_label"]');
  await expect(searchLabel).toContainText('Пошук подій');
});
