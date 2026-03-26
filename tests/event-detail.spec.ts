import { test, expect } from '@playwright/test';
import { enableAdminSession } from './helpers';

test('event detail shows real data and edit link', async ({ page }) => {
  const eventId = 'evt-1770121644766';
  const payload = {
    ok: true,
    event: {
      id: eventId,
      title: 'Громадська зустріч у Копенгагені',
      description: 'Real event description for detail page.',
      tags: [
        { label: 'Design', status: 'approved' },
        { label: 'Community', status: 'pending' }
      ],
      start: '2026-02-04T18:00:00+01:00',
      end: '2026-02-04T20:00:00+01:00',
      format: 'online',
      venue: '',
      address: 'Zoom',
      city: 'Copenhagen',
      priceType: 'paid',
      priceMin: 350,
      priceMax: 520,
      ticketUrl: 'https://tickets.example.com',
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
        meta: ''
      }
    }
  };

  await enableAdminSession(page);
  await page.route('**/.netlify/functions/public-events*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.route('**/.netlify/functions/public-event*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
  );
  await page.route('**/.netlify/functions/admin-event*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
  );

  await page.goto(`/event-card.html?id=${eventId}&serverless=1`);
  await page.waitForSelector('[data-event-title]');

  await expect(page.locator('[data-event-title]')).toHaveText(payload.event.title);
  await expect(page.locator('[data-event-language]')).toHaveText('Українська');

  const tags = page.locator('[data-event-tags] .event-tag');
  await expect(tags).toHaveCount(2);
  await expect(tags.nth(0)).toHaveText('дизайн');
  await expect(tags.nth(1)).toHaveText('спільнота');

  const meta = page.locator('[data-event-start]');
  await expect(meta).toContainText('04.02.2026');
  await expect(meta).toContainText('Онлайн');

  await expect(page.locator('[data-event-location]')).toHaveText('Онлайн · Zoom');
  await expect(page.locator('[data-price-type]')).toContainText('Ціна: 350 - 520 DKK');

  await page.locator('[data-action="admin-edit"]').click();
  await expect(page).toHaveURL(new RegExp(`new-event\\.html\\?id=${eventId}`));
});

test('non-archived event does not show archived admin controls', async ({ page }) => {
  const eventId = 'evt-1770121644767';
  const payload = {
    ok: true,
    event: {
      id: eventId,
      title: 'Active Event',
      description: 'Active event description.',
      tags: [],
      start: '2026-02-05T18:00:00+01:00',
      end: '2026-02-05T20:00:00+01:00',
      format: 'offline',
      venue: 'Venue',
      address: 'Main St 10',
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
        meta: ''
      }
    }
  };

  await enableAdminSession(page);
  await page.route('**/.netlify/functions/public-events*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.route('**/.netlify/functions/public-event*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
  );
  await page.route('**/.netlify/functions/admin-event*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
  );

  await page.goto(`/event-card.html?id=${eventId}&serverless=1`);
  await page.waitForSelector('[data-event-title]');

  await expect(page.locator('[data-admin-archived-badge]')).toBeHidden();
  await expect(page.locator('[data-action="admin-restore"]')).toBeHidden();
  await expect(page.locator('[data-action="admin-archive"]')).toBeVisible();
});

test('event detail shows address as google maps link', async ({ page }) => {
  const eventId = 'evt-1770121644768';
  const address = 'Sankt Ansgar Kirke, Bredgade 64';
  const city = 'Copenhagen';
  const expectedLocation = `${address}, ${city}`;
  const payload = {
    ok: true,
    event: {
      id: eventId,
      title: 'Address Event',
      description: 'Address event description.',
      tags: [],
      start: '2026-02-06T18:00:00+01:00',
      end: '2026-02-06T20:00:00+01:00',
      format: 'offline',
      venue: '',
      address,
      city,
      priceType: 'free',
      priceMin: null,
      priceMax: null,
      ticketUrl: '',
      organizerId: '',
      images: [],
      status: 'published',
      language: 'en',
      contactPerson: {
        name: '',
        email: '',
        phone: '',
        website: '',
        instagram: '',
        facebook: '',
        meta: ''
      }
    }
  };

  await enableAdminSession(page);
  await page.route('**/.netlify/functions/public-events*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.route('**/.netlify/functions/public-event*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
  );

  await page.goto(`/event-card.html?id=${eventId}&serverless=1`);
  const location = page.locator('[data-event-location]');
  await expect(location).toHaveText(expectedLocation);
  await expect(location).toHaveAttribute(
    'href',
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(expectedLocation)}`
  );
  await expect(location).toHaveAttribute('target', '_blank');
});
