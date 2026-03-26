import { test, expect } from '@playwright/test';
import { freezeTime } from './setup.freeze-time';

const routes = [
  { url: '/', key: 'home' },
  { url: '/#events', key: 'events' },
  { url: '/new-event.html', key: 'new-event' },
  { url: '/event-card.html?id=evt-006', key: 'event-card' }
];

for (const route of routes) {
  test(`visual: ${route.url}`, async ({ page }) => {
    await freezeTime(page);
    await page.addInitScript(() => {
      Math.random = () => 0.42;
    });
    await page.addInitScript(() => {
      document.documentElement.style.scrollBehavior = 'auto';
    });
    if (route.url.includes('new-event')) {
      await page.addInitScript(() => {
        const user = {
          email: 'admin@test.local',
          app_metadata: { roles: ['admin'] },
          token: { access_token: 'test-token' }
        };
        window.netlifyIdentity = {
          _handlers: {},
          on(event, cb) {
            this._handlers[event] = cb;
          },
          init() {
            if (this._handlers.init) this._handlers.init(user);
          },
          currentUser() {
            return user;
          },
          open() {},
          close() {},
          logout() {
            if (this._handlers.logout) this._handlers.logout();
          }
        };
        localStorage.setItem('wodAdminSession', '1');
      });
    }
    await page.goto(route.url);
    await page.waitForLoadState('domcontentloaded');
    if (route.key === 'home') {
      const hero = page.locator('.hero');
      const highlights = page.locator('.highlights');
      await expect(hero).toBeVisible();
      await expect(highlights).toBeVisible();
      expect(await hero.screenshot()).toMatchSnapshot('home-hero.png', { maxDiffPixels: 200 });
      expect(await highlights.screenshot()).toMatchSnapshot('home-highlights.png', { maxDiffPixels: 200 });
    }
    if (route.key === 'events') {
      const catalog = page.locator('#events');
      await catalog.scrollIntoViewIfNeeded();
      await page.waitForSelector('[data-testid="event-card"]', { timeout: 10000 });
      const filters = page.locator('.filters');
      const grid = page.locator('.catalog-grid');
      await expect(filters).toBeVisible();
      await expect(grid).toBeVisible();
      expect(await filters.screenshot()).toMatchSnapshot('events-filters.png', { maxDiffPixels: 200 });
      expect(await grid.screenshot()).toMatchSnapshot('events-grid.png', { maxDiffPixels: 200 });
    }
    if (route.key === 'new-event') {
      const form = page.locator('form.multi-step');
      await page.locator('.multi-step[data-ready="true"]').waitFor({ state: 'attached' });
      await expect(form).toBeVisible();
      await expect(page.locator('.stepper')).toHaveCount(0);
      expect(await form.screenshot()).toMatchSnapshot('new-event-form.png', { maxDiffPixels: 200 });
    }
    if (route.key === 'event-card') {
      const detail = page.locator('.event-detail');
      const sidebar = page.locator('.event-sidebar');
      await expect(detail).toBeVisible();
      await expect(sidebar).toBeVisible();
      expect(
        await detail.screenshot({
          mask: [detail.locator('.event-hero'), detail.locator('.event-article__section')]
        })
      ).toMatchSnapshot('event-detail.png', { maxDiffPixels: 200 });
      expect(await sidebar.screenshot()).toMatchSnapshot('event-sidebar.png', { maxDiffPixels: 200 });
    }
  });
}

test.describe('visual: mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('mobile events grid', async ({ page }) => {
    await freezeTime(page);
    await page.addInitScript(() => {
      Math.random = () => 0.42;
    });
    await page.addInitScript(() => {
      document.documentElement.style.scrollBehavior = 'auto';
    });
    await page.goto('/#events');
    const catalog = page.locator('#events');
    await catalog.scrollIntoViewIfNeeded();
    await page.waitForSelector('[data-testid="event-card"]', { timeout: 10000 });
    const grid = page.locator('.catalog-grid');
    await expect(grid).toBeVisible();
    await page.evaluate(async () => {
      const images = Array.from(document.querySelectorAll('.event-card__image'));
      images.forEach((img) => img.setAttribute('loading', 'eager'));
      await Promise.all(
        images.map(
          (img) =>
            img.complete ||
            new Promise((resolve) => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
            })
        )
      );
    });
    expect(await grid.screenshot()).toMatchSnapshot('events-grid-mobile.png', { maxDiffPixels: 200 });
  });
});
