import { test, expect } from '@playwright/test';
import { enableAdminSession } from './helpers';
import { handler as shareEventHandler } from '../netlify/functions/share-event';

type RecommendedState = {
  order: string[];
  meta: Map<string, { durationCode: string; chosenUntilAt: string; effectiveUntilAt: string }>;
};

const makeEvents = () =>
  Array.from({ length: 7 }, (_, index) => ({
    id: `evt-rec-${index + 1}`,
    title: `Recommended Event ${index + 1}`,
    description: `Description ${index + 1}`,
    tags: [],
    start: `2026-03-${String(10 + index).padStart(2, '0')}T12:00:00+01:00`,
    end: index % 2 === 0 ? `2026-03-${String(10 + index).padStart(2, '0')}T14:00:00+01:00` : null,
    format: 'offline',
    venue: 'Hall',
    address: 'Main St 1',
    city: 'Copenhagen',
    priceType: index % 3 === 0 ? 'paid' : 'free',
    priceMin: index % 3 === 0 ? 120 : null,
    priceMax: index % 3 === 0 ? 180 : null,
    ticketUrl: index % 2 === 0 ? 'https://tickets.example.com' : '',
    organizerId: '',
    images: [`https://cdn.example.com/recommended-${index + 1}.jpg`],
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
  }));

const buildRecommendedPayload = (state: RecommendedState, events: any[]) =>
  state.order
    .map((eventId, index) => {
      const event = events.find((item) => item.id === eventId);
      if (!event) return null;
      const meta = state.meta.get(eventId);
      return {
        id: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        city: event.city,
        format: event.format,
        address: event.address,
        venue: event.venue,
        registrationUrl: event.ticketUrl,
        priceType: event.priceType,
        imageUrl: event.images?.[0] || '',
        position: index + 1,
        chosenUntilAt: meta?.chosenUntilAt || new Date(Date.now() + 3 * 86400000).toISOString(),
        effectiveUntilAt: meta?.effectiveUntilAt || new Date(Date.now() + 3 * 86400000).toISOString()
      };
    })
    .filter(Boolean);

const buildAdminSlots = (state: RecommendedState, events: any[]) =>
  state.order
    .map((eventId, index) => {
      const event = events.find((item) => item.id === eventId);
      if (!event) return null;
      const meta = state.meta.get(eventId);
      return {
        slotPosition: index + 1,
        durationCode: meta?.durationCode || '3d',
        startsAt: new Date().toISOString(),
        chosenUntilAt: meta?.chosenUntilAt || new Date(Date.now() + 3 * 86400000).toISOString(),
        effectiveUntilAt: meta?.effectiveUntilAt || new Date(Date.now() + 3 * 86400000).toISOString(),
        event: {
          id: event.id,
          dbId: event.id,
          title: event.title,
          start: event.start,
          end: event.end,
          city: event.city,
          status: 'published',
          format: event.format,
          address: event.address,
          venue: event.venue,
          registrationUrl: event.ticketUrl,
          priceType: event.priceType
        }
      };
    })
    .filter(Boolean);

const configureRecommendedApi = async (
  page: Parameters<typeof test>[0]['page'],
  options: { initialOrder?: string[] } = {}
) => {
  const events = makeEvents();
  const state: RecommendedState = {
    order: [...(options.initialOrder || [])],
    meta: new Map()
  };

  await page.route('**/.netlify/functions/public-events*', async (route) => {
    const url = new URL(route.request().url());
    const pageParam = Number(url.searchParams.get('page') || '1');
    const body = pageParam === 1 ? events : [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.route('**/.netlify/functions/public-event*', async (route) => {
    const url = new URL(route.request().url());
    const id = url.searchParams.get('id');
    const event = events.find((item) => item.id === id);
    if (!event) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, event }) });
  });

  await page.route('**/.netlify/functions/admin-event*', async (route) => {
    const url = new URL(route.request().url());
    const id = url.searchParams.get('id');
    const event = events.find((item) => item.id === id);
    if (!event) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, event }) });
  });

  await page.route('**/.netlify/functions/public-recommended*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, recommended: buildRecommendedPayload(state, events) })
    });
  });

  await page.route('**/.netlify/functions/admin-recommended', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, slots: buildAdminSlots(state, events) })
      });
      return;
    }

    const payload = route.request().postDataJSON() as any;
    const action = String(payload?.action || '');

    if (action === 'place') {
      const eventId = String(payload.eventId || '');
      const durationCode = String(payload.durationCode || '3d');
      const slotPosition = Math.max(1, Math.min(6, Number(payload.slotPosition || 1)));
      const exists = state.order.includes(eventId);
      if (!exists && state.order.length >= 6) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, error: 'max_slots_reached' })
        });
        return;
      }
      state.order = state.order.filter((id) => id !== eventId);
      state.order.splice(slotPosition - 1, 0, eventId);
      const chosenUntilAt = new Date(Date.now() + 3 * 86400000).toISOString();
      state.meta.set(eventId, {
        durationCode,
        chosenUntilAt,
        effectiveUntilAt: chosenUntilAt
      });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, slots: buildAdminSlots(state, events) })
      });
      return;
    }

    if (action === 'remove') {
      const eventId = String(payload.eventId || '');
      state.order = state.order.filter((id) => id !== eventId);
      state.meta.delete(eventId);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, slots: buildAdminSlots(state, events) })
      });
      return;
    }

    if (action === 'reorder') {
      const order = Array.isArray(payload.order) ? payload.order.map((value: string) => String(value || '')) : [];
      const unique = order.filter((id, idx) => id && order.indexOf(id) === idx);
      const remaining = state.order.filter((id) => !unique.includes(id));
      state.order = [...unique, ...remaining].slice(0, 6);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, slots: buildAdminSlots(state, events) })
      });
      return;
    }

    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'invalid_action' })
    });
  });

  return { events, state };
};

test('admin sets event as recommended and it appears on homepage', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await enableAdminSession(page);
  await configureRecommendedApi(page);

  await page.goto('/event-card.html?id=evt-rec-1&serverless=1');
  await page.locator('[data-admin-recommended]').waitFor({ state: 'visible' });
  await page.locator('[data-recommended-duration]').selectOption('7d');
  await page.locator('[data-recommended-position]').fill('1');
  await page.locator('[data-action="recommended-save"]').click();
  await expect(page.locator('[data-recommended-status]')).toContainText(/saved/i);

  await page.goto('/?serverless=1');
  await expect(page.locator('.highlights__button[data-action="prev"]')).toBeHidden();
  await expect(page.locator('.highlights__button[data-action="next"]')).toBeHidden();
  const recommendedCard = page.locator('.highlights__card', { hasText: 'Recommended Event 1' }).first();
  await expect(recommendedCard).toBeVisible();
  await expect(recommendedCard.locator('.recommended-poster__detail-link')).toHaveAttribute(
    'href',
    /event-card\.html\?id=evt-rec-1/
  );
  const poster = recommendedCard.locator('.poster-card__media').first();
  await expect(poster).toBeVisible();
  await expect(recommendedCard.locator('.recommended-poster__img')).toBeVisible();
  const frameStyles = await poster.evaluate((element) => {
    const frame = window.getComputedStyle(element as HTMLElement);
    const img = window.getComputedStyle(
      (element as HTMLElement).querySelector('.recommended-poster__img') as HTMLElement
    );
    const overlay = window.getComputedStyle(
      (element as HTMLElement).querySelector('.recommended-poster__overlay') as HTMLElement
    );
    return {
      frameOverflow: frame.overflow,
      frameRadius: frame.borderTopLeftRadius,
      frameAspectRatio: frame.aspectRatio,
      imgObjectFit: img.objectFit,
      overlayOpacity: overlay.opacity
    };
  });
  expect(frameStyles.frameOverflow).toBe('hidden');
  expect(parseFloat(frameStyles.frameRadius)).toBeGreaterThan(0);
  expect(frameStyles.frameAspectRatio).toContain('2 / 3');
  expect(frameStyles.imgObjectFit).toBe('cover');
  expect(frameStyles.overlayOpacity).toBe('0');

  await recommendedCard.locator('.recommended-poster__detail-link').focus();
  await expect
    .poll(async () => {
      return Number(
        await recommendedCard.locator('.recommended-poster__overlay').evaluate((element) => {
          return window.getComputedStyle(element as HTMLElement).opacity;
        })
      );
    })
    .toBeGreaterThan(0.2);

  const cta = recommendedCard
    .locator('.recommended-poster__cta', { hasText: /Квитки|Реєстрація|Детальніше/ })
    .first();
  await expect(cta).toBeVisible();
  await expect(cta).toHaveAttribute('href', /tickets\.example\.com|event-card\.html/);
});

test('recommended desktop overlay is hidden by default and visible on focus-within', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await configureRecommendedApi(page, { initialOrder: ['evt-rec-1', 'evt-rec-2', 'evt-rec-3', 'evt-rec-4'] });

  await page.goto('/?serverless=1');
  const card = page.locator('.highlights__card--recommended').first();
  await expect(card).toBeVisible();
  const overlay = card.locator('.recommended-poster__overlay');
  await expect(overlay).toHaveCount(1);

  const initial = await overlay.evaluate((element) => {
    const styles = window.getComputedStyle(element as HTMLElement);
    return { opacity: styles.opacity, visibility: styles.visibility };
  });
  expect(initial.opacity).toBe('0');
  expect(initial.visibility).toBe('hidden');

  await card.locator('.recommended-poster__detail-link').focus();
  await expect
    .poll(async () => {
      const focused = await overlay.evaluate((element) => {
        const styles = window.getComputedStyle(element as HTMLElement);
        return { opacity: styles.opacity, visibility: styles.visibility };
      });
      return Number(focused.opacity);
    })
    .toBeGreaterThan(0.2);
  await expect
    .poll(async () => {
      const focused = await overlay.evaluate((element) => {
        return window.getComputedStyle(element as HTMLElement).visibility;
      });
      return focused;
    })
    .toBe('visible');
});

test('recommended mobile uses snap carousel and autoplay advances slides', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await configureRecommendedApi(page, { initialOrder: ['evt-rec-1', 'evt-rec-2', 'evt-rec-3', 'evt-rec-4'] });

  await page.goto('/?serverless=1');
  const strip = page.locator('.recommended-strip').first();
  await expect(strip).toBeVisible();

  const snapType = await strip.evaluate((element) => {
    return window.getComputedStyle(element as HTMLElement).scrollSnapType;
  });
  expect(snapType).toContain('x');

  const widths = await page.evaluate(() => {
    const stripEl = document.querySelector('.recommended-strip') as HTMLElement;
    const cardEl = document.querySelector('.highlights__card--recommended') as HTMLElement;
    return {
      stripWidth: stripEl.getBoundingClientRect().width,
      cardWidth: cardEl.getBoundingClientRect().width
    };
  });
  expect(Math.abs(widths.cardWidth - widths.stripWidth)).toBeLessThan(24);

  const overlayDisplay = await page
    .locator('.highlights__card--recommended .recommended-poster__overlay')
    .first()
    .evaluate((element) => window.getComputedStyle(element as HTMLElement).display);
  expect(overlayDisplay).toBe('none');

  const initialScroll = await strip.evaluate((element) => (element as HTMLElement).scrollLeft);
  await page.waitForTimeout(5600);
  const nextScroll = await strip.evaluate((element) => (element as HTMLElement).scrollLeft);
  expect(nextScroll).toBeGreaterThan(initialScroll + 5);
});

test('recommended mobile autoplay is disabled when prefers-reduced-motion is enabled', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await configureRecommendedApi(page, { initialOrder: ['evt-rec-1', 'evt-rec-2', 'evt-rec-3', 'evt-rec-4'] });

  await page.goto('/?serverless=1');
  const strip = page.locator('.recommended-strip').first();
  const initialScroll = await strip.evaluate((element) => (element as HTMLElement).scrollLeft);
  await page.waitForTimeout(5600);
  const nextScroll = await strip.evaluate((element) => (element as HTMLElement).scrollLeft);
  expect(Math.abs(nextScroll - initialScroll)).toBeLessThan(2);
});

test('recommended CTA labels follow paid/registration/details logic', async ({ page }) => {
  await enableAdminSession(page);
  await configureRecommendedApi(page, { initialOrder: ['evt-rec-1', 'evt-rec-2', 'evt-rec-3'] });

  await page.goto('/?serverless=1');
  const card1 = page.locator('.highlights__card', { hasText: 'Recommended Event 1' }).first();
  const card2 = page.locator('.highlights__card', { hasText: 'Recommended Event 2' }).first();
  const card3 = page.locator('.highlights__card', { hasText: 'Recommended Event 3' }).first();

  await expect(card1.locator('.recommended-poster__cta')).toHaveText(/Квитки/i);
  await expect(card2.locator('.recommended-poster__cta')).toHaveText(/Детальніше/i);
  await expect(card3.locator('.recommended-poster__cta')).toHaveText(/Реєстрація/i);
});

test('recommended manual reorder controls are disabled in admin UI', async ({ page }) => {
  await enableAdminSession(page);
  await configureRecommendedApi(page, { initialOrder: ['evt-rec-1', 'evt-rec-2'] });

  await page.goto('/event-card.html?id=evt-rec-2&serverless=1');
  await expect(page.locator('[data-action="recommended-manage"]')).toBeHidden();
  await expect(page.locator('[data-recommended-slots]')).toBeHidden();
  await expect(page.locator('[data-action="recommended-up"]')).toHaveCount(0);
  await expect(page.locator('[data-action="recommended-down"]')).toHaveCount(0);
});

test('adding seventh recommended item is blocked with a clear message', async ({ page }) => {
  await enableAdminSession(page);
  await configureRecommendedApi(page, {
    initialOrder: ['evt-rec-1', 'evt-rec-2', 'evt-rec-3', 'evt-rec-4', 'evt-rec-5', 'evt-rec-6']
  });

  await page.goto('/event-card.html?id=evt-rec-7&serverless=1');
  await page.locator('[data-recommended-position]').fill('1');
  await page.locator('[data-action="recommended-save"]').click();
  await expect(page.locator('[data-recommended-status]')).toContainText(/Maximum 6 active recommended events reached/i);

  await page.goto('/?serverless=1');
  await expect(page.locator('.highlights__card', { hasText: 'Recommended Event 7' })).toHaveCount(0);
});

test('archived event can be opened in admin and edited without 404', async ({ page }) => {
  await enableAdminSession(page);

  await page.route('**/.netlify/functions/admin-event*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        event: {
          id: 'evt-archived-1',
          title: 'Archived Admin Event',
          description: 'Archived body',
          tags: [{ label: 'Community', status: 'approved' }],
          start: '2026-03-10T10:00:00+01:00',
          end: '2026-03-10T11:00:00+01:00',
          format: 'offline',
          venue: 'Hall',
          address: 'Main St 1',
          city: 'Copenhagen',
          priceType: 'free',
          priceMin: null,
          priceMax: null,
          ticketUrl: '',
          organizerId: '',
          images: [],
          status: 'archived',
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
        }
      })
    });
  });

  await page.route('**/.netlify/functions/public-event*', async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ ok: false }) });
  });

  await page.goto('/new-event.html?id=evt-archived-1&serverless=1');
  await expect(page.locator('input[name="title"]')).toHaveValue('Archived Admin Event');
});

test('share endpoint OG output contains required tags', async ({ page }) => {
  await page.route('**/.netlify/functions/share-event*', async (route) => {
    const result = await shareEventHandler({
      queryStringParameters: {
        t: 'Fixture Event',
        d: 'Fixture description',
        i: 'https://example.com/fixture.jpg'
      },
      headers: {
        host: 'localhost:5173',
        'x-forwarded-proto': 'https',
        'user-agent': 'WhatsApp/2.25'
      }
    } as any);

    await route.fulfill({
      status: result.statusCode || 200,
      contentType: 'text/html; charset=utf-8',
      headers: result.headers as Record<string, string>,
      body: result.body || ''
    });
  });

  await page.goto('/.netlify/functions/share-event?t=Fixture%20Event&d=Fixture%20description&i=https%3A%2F%2Fexample.com%2Ffixture.jpg');
  const html = await page.content();
  expect(html).toContain('property="og:title"');
  expect(html).toContain('property="og:image"');
  expect(html).toContain('property="og:url"');
});
