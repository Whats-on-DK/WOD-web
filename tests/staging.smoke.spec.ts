import { test, expect } from '@playwright/test';

const menuSelector = '[data-share-menu]';
const cardSelector = '[data-testid="event-card"]';

const waitForCatalogSettled = async (page) => {
  await expect
    .poll(
      async () => {
        const cardCount = await page.locator(cardSelector).count();
        const emptyVisible = await page.locator('.catalog-empty').isVisible().catch(() => false);
        if (cardCount > 0) return 'cards';
        if (emptyVisible) return 'empty';
        return 'loading';
      },
      {
        timeout: 15000,
        message: 'Catalog should settle to either rendered cards or visible empty state'
      }
    )
    .not.toBe('loading');
};

const openFirstEventDetail = async (page) => {
  await page.goto('/#events');
  await expect(page.locator('#events')).toBeVisible();
  await waitForCatalogSettled(page);

  const cardCount = await page.locator(cardSelector).count();
  if (!cardCount) {
    return false;
  }

  const detailLink = page.locator(`${cardSelector} .poster-card__cover-link`).first();
  await expect(detailLink).toBeVisible();
  const detailHref = await detailLink.getAttribute('href');
  if (!detailHref) return false;
  await page.goto(detailHref);
  await expect(page).toHaveURL(/event-card\.html\?id=/);
  return true;
};

test('staging: homepage and catalog render', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('header.site-header')).toBeVisible();
  await expect(page.locator('#events')).toBeVisible();
  await expect(page.locator('.filters')).toBeVisible();
});

test('staging: share menu opens on event detail and has required channels', async ({ page }) => {
  const opened = await openFirstEventDetail(page);
  test.skip(!opened, 'No published events on staging right now.');

  await page.getByRole('button', { name: /Поділитися/i }).click();
  await expect(page.locator(menuSelector)).toBeVisible();

  const labels = (await page.locator(`${menuSelector} .event-share__option`).allTextContents()).map((x) =>
    x.trim()
  );

  expect(labels).toContain('Copy link');
  expect(labels).toContain('Facebook');
  expect(labels).toContain('Messenger');
  expect(labels).toContain('LinkedIn');
  expect(labels).toContain('Telegram');
  expect(labels).toContain('WhatsApp');
  expect(labels).toContain('Інше');

  const facebookIndex = labels.indexOf('Facebook');
  const messengerIndex = labels.indexOf('Messenger');
  expect(messengerIndex).toBe(facebookIndex + 1);
});

test('staging: social hrefs contain correct targets and UTM', async ({ page }) => {
  const opened = await openFirstEventDetail(page);
  test.skip(!opened, 'No published events on staging right now.');

  await page.getByRole('button', { name: /Поділитися/i }).click();

  const facebookHref = await page.locator('[data-share-channel="facebook"]').getAttribute('href');
  const messengerHref = await page.locator('[data-share-channel="messenger"]').getAttribute('href');
  const linkedinHref = await page.locator('[data-share-channel="linkedin"]').getAttribute('href');
  const telegramHref = await page.locator('[data-share-channel="telegram"]').getAttribute('href');
  const whatsappHref = await page.locator('[data-share-channel="whatsapp"]').getAttribute('href');

  expect(facebookHref || '').toContain('https://www.facebook.com/sharer/sharer.php?u=');
  expect(facebookHref || '').toContain('utm_content%3Dfacebook');

  expect(messengerHref || '').toContain('https://www.facebook.com/messages/t/');

  expect(linkedinHref || '').toContain('https://www.linkedin.com/sharing/share-offsite/?url=');
  expect(linkedinHref || '').toContain('utm_content%3Dlinkedin');

  expect(telegramHref || '').toContain('https://t.me/share/url');
  expect(telegramHref || '').toContain('utm_content%3Dtelegram');

  expect(whatsappHref || '').toContain('https://wa.me/?text=');
  expect(whatsappHref || '').toContain('utm_content%3Dwhatsapp');
});

test('staging: copy link works and shows toast', async ({ page }) => {
  const opened = await openFirstEventDetail(page);
  test.skip(!opened, 'No published events on staging right now.');

  await page.getByRole('button', { name: /Поділитися/i }).click();
  await page.getByRole('button', { name: /Copy link/i }).click();
  await expect(page.locator('[data-saved-toast]')).toContainText('Посилання скопійовано');
});

test('staging mobile: messenger present, instagram stories absent, no crash on click', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const opened = await openFirstEventDetail(page);
  test.skip(!opened, 'No published events on staging right now.');

  await page.getByRole('button', { name: /Поділитися/i }).click();

  await expect(page.locator('[data-share-channel="messenger"]')).toBeVisible();
  await expect(page.locator('[data-share-instagram]')).toHaveCount(0);

  const beforeUrl = page.url();
  await page.locator('[data-share-channel="messenger"]').click();
  await expect(page).toHaveURL(beforeUrl);
});
