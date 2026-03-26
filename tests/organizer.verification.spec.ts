import { test, expect } from '@playwright/test';
import { enableAdminSession } from './helpers';

test('guest can open create-event page', async ({ page }) => {
  await page.goto('/new-event.html');
  await expect(page).toHaveURL(/new-event\.html$/);
  await expect(page.locator('.multi-step[data-ready="true"]')).toBeVisible();
});

test('non-admin is redirected from edit mode to admin login', async ({ page }) => {
  await page.goto('/new-event.html?id=evt-123');
  await expect(page).toHaveURL(/admin-login/);
});

test('admin can still open edit mode', async ({ page }) => {
  await enableAdminSession(page);
  await page.goto('/new-event.html?id=evt-123');
  await expect(page).toHaveURL(/new-event\.html\?id=evt-123/);
});
