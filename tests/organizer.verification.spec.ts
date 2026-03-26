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

test('guest submit redirects to success page instead of 404', async ({ page }) => {
  await page.goto('/new-event.html');
  await page.locator('.multi-step[data-ready="true"]').waitFor({ state: 'attached' });

  await page.getByLabel(/Назва|Title|Titel/i).fill('Guest submitted event');
  await page.getByLabel(/Опис|Description|Beskrivelse/i).fill('Guest event description.');
  const tagsInput = page.getByLabel(/Додати тег|Add tag|Tilføj tag/i);
  await tagsInput.fill('Community');
  await tagsInput.press('Enter');
  await page.getByLabel(/Початок|Start/i).fill('2030-06-01T18:00');
  await page.locator('select[name="format"]').selectOption({ value: 'offline' });
  await page.locator('select[name="language"]').selectOption({ value: 'uk' });
  await page.getByLabel(/Адреса|Address|Adresse/i).fill('Copenhagen, Main St 10');
  await page.locator('input[name="city"]').fill('Copenhagen');
  await page.getByLabel(/Безкоштовно|Free|Gratis/i).check();
  await page.locator('input[name="image"]').setInputFiles({
    name: 'event.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P4z8DwHwAE/wJ/lYt9NwAAAABJRU5ErkJggg==',
      'base64'
    )
  });
  await page.locator('input[name="contact-name"]').fill('Guest Contact');

  await page.getByRole('button', { name: /Надіслати на модерацію/i }).click();
  await expect(page).toHaveURL(/submission-success\.html/);
  await expect(page.getByRole('heading', { name: /Подію надіслано на модерацію/i })).toBeVisible();
});
