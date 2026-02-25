import { test, expect } from '@playwright/test';
import { freezeTime } from './setup.freeze-time';

const makeWeekEvent = (index: number) => ({
  id: `evt-week-${index}`,
  slug: `evt-week-${index}`,
  title: `Week Event ${index}`,
  description: `Event ${index}`,
  tags: [],
  start: `2026-01-${String(7 + Math.floor((index - 1) / 4)).padStart(2, '0')}T${String(
    13 + ((index - 1) % 4) * 2
  ).padStart(2, '0')}:00:00+01:00`,
  end: null,
  format: 'offline',
  venue: '',
  address: `Main St ${index}`,
  city: 'Copenhagen',
  priceType: 'free',
  priceMin: null,
  priceMax: null,
  ticketUrl: '',
  organizerId: '',
  images: [],
  status: 'published',
  language: 'uk',
  contactPerson: {
    name: '',
    email: '',
    phone: '',
    website: '',
    instagram: '',
    facebook: '',
    telegram: '',
    meta: ''
  }
});

test('weekly highlights renders all events and arrows can reach last card', async ({ page }) => {
  await page.addInitScript(() => {
    const fixed = new Date('2026-01-07T12:00:00+01:00').valueOf();
    const RealDate = Date;
    // @ts-ignore
    class FrozenDate extends RealDate {
      constructor(...args: any[]) {
        super(...(args.length ? args : [fixed]));
      }
      static now() {
        return fixed;
      }
    }
    // @ts-ignore
    window.Date = FrozenDate;
  });
  const events = Array.from({ length: 16 }, (_, index) => makeWeekEvent(index + 1));

  await page.route('**/.netlify/functions/public-events*', (route) => {
    const url = new URL(route.request().url());
    const pageParam = Number(url.searchParams.get('page') || '1');
    const body = pageParam === 1 ? events : [];
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/.netlify/functions/public-partners*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );

  await page.goto('/?serverless=1&highlights=weekly');
  await expect(page.locator('.highlights__card')).toHaveCount(16);

  const nextButton = page.locator('.highlights__button[data-action="next"]');
  for (let index = 0; index < 20; index += 1) {
    if (await nextButton.isDisabled()) break;
    await nextButton.click();
    await page.waitForTimeout(80);
  }

  await expect(page.locator('.highlights__card h3', { hasText: 'Week Event 16' })).toBeInViewport();
});

test('weekly highlights empty state is centered and arrows are hidden', async ({ page }) => {
  await freezeTime(page);
  await page.route('**/.netlify/functions/public-events*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.route('**/.netlify/functions/public-partners*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );

  await page.goto('/?serverless=1&highlights=weekly');
  const empty = page.locator('.highlights__empty');
  await expect(empty).toBeVisible();
  await expect(page.locator('.highlights__button[data-action="prev"]')).toBeHidden();
  await expect(page.locator('.highlights__button[data-action="next"]')).toBeHidden();
  await expect(page.locator('.highlights__track')).toHaveClass(/highlights__track--empty/);

  const centered = await page.evaluate(() => {
    const track = document.querySelector('.highlights__track');
    const emptyBlock = document.querySelector('.highlights__empty');
    if (!(track instanceof HTMLElement) || !(emptyBlock instanceof HTMLElement)) return false;
    const trackRect = track.getBoundingClientRect();
    const emptyRect = emptyBlock.getBoundingClientRect();
    const deltaX = Math.abs(trackRect.left + trackRect.width / 2 - (emptyRect.left + emptyRect.width / 2));
    const deltaY = Math.abs(trackRect.top + trackRect.height / 2 - (emptyRect.top + emptyRect.height / 2));
    return deltaX < 10 && deltaY < 10;
  });
  expect(centered).toBeTruthy();
});

test('catalog shows "Онлайн" for online events even without city', async ({ page }) => {
  await freezeTime(page);
  const events = [
    {
      ...makeWeekEvent(1),
      id: 'evt-online-no-city',
      title: 'Online Event',
      format: 'online',
      address: 'Zoom',
      city: ''
    }
  ];
  await page.route('**/.netlify/functions/public-events*', (route) => {
    const url = new URL(route.request().url());
    const pageParam = Number(url.searchParams.get('page') || '1');
    const body = pageParam === 1 ? events : [];
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/.netlify/functions/public-partners*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );

  await page.goto('/?serverless=1&highlights=weekly');
  await expect(page.locator('[data-testid="event-card"] .event-card__location').first()).toHaveText('Онлайн');
});
