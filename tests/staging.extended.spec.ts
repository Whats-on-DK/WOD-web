import { test, expect } from '@playwright/test';

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

const openCatalog = async (page) => {
  await page.goto('/#events');
  await expect(page.locator('#events')).toBeVisible();
  await waitForCatalogSettled(page);
};

const openFirstEventDetail = async (page) => {
  await openCatalog(page);
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

test('staging extended: advanced filters panel toggles correctly', async ({ page }) => {
  await openCatalog(page);
  const toggle = page.locator('[data-action="filters-advanced"]');
  const panel = page.locator('#filters-advanced');

  await expect(toggle).toBeVisible();
  await expect(panel).toBeHidden();

  await toggle.click();
  await expect(panel).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await toggle.click();
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('staging extended: favorites quick filter works with local saved event', async ({ page }) => {
  await openCatalog(page);

  const firstCard = page.locator(cardSelector).first();
  const exists = (await firstCard.count()) > 0;
  test.skip(!exists, 'No published events on staging right now.');

  const eventId = await firstCard.getAttribute('data-event-id');
  expect(eventId).toBeTruthy();

  const star = firstCard.locator('[data-action="toggle-saved"]');
  await expect(star).toBeVisible();
  if ((await star.getAttribute('data-saved')) !== 'true') {
    await star.click();
  }

  const favorites = page.getByTestId('filters-favorites');
  await expect(favorites).toBeVisible();
  await favorites.click();

  const visibleIds = await page.$$eval(cardSelector, (cards) =>
    cards.map((card) => String(card.getAttribute('data-event-id') || '')).filter(Boolean)
  );

  expect(visibleIds.length).toBeGreaterThan(0);
  expect(visibleIds).toContain(String(eventId));
});

test('staging extended: event detail has share and calendar actions', async ({ page }) => {
  const opened = await openFirstEventDetail(page);
  test.skip(!opened, 'No published events on staging right now.');

  await expect(page.getByRole('button', { name: /Поділитися/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Додати в календар/i })).toBeVisible();

  await page.getByRole('button', { name: /Додати в календар/i }).click();
  await expect(page.locator('[data-calendar-menu]')).toBeVisible();
});

test('staging extended: messenger opens stable facebook messages url', async ({ page }) => {
  const opened = await openFirstEventDetail(page);
  test.skip(!opened, 'No published events on staging right now.');

  await page.getByRole('button', { name: /Поділитися/i }).click();
  const messengerHref = await page
    .locator('[data-share-channel="messenger"]')
    .getAttribute('href');

  expect(messengerHref || '').toContain('facebook.com/messages/t/');
});

test('staging extended mobile: share menu has all expected options', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const opened = await openFirstEventDetail(page);
  test.skip(!opened, 'No published events on staging right now.');

  await page.getByRole('button', { name: /Поділитися/i }).click();
  const labels = (await page.locator('[data-share-menu] .event-share__option').allTextContents()).map(
    (x) => x.trim()
  );

  expect(labels).toContain('Copy link');
  expect(labels).toContain('Facebook');
  expect(labels).toContain('Messenger');
  expect(labels).toContain('LinkedIn');
  expect(labels).toContain('Telegram');
  expect(labels).toContain('WhatsApp');
  expect(labels).toContain('Інше');
});
