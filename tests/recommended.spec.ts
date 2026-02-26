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
  await expect(recommendedCard.locator('.highlights__card-link')).toHaveAttribute(
    'href',
    /event-card\.html\?id=evt-rec-1/
  );
  const imageFrame = recommendedCard.locator('.event-image-frame--recommended').first();
  await expect(imageFrame).toBeVisible();
  await expect(recommendedCard.locator('.event-image-frame__bg')).toBeVisible();
  await expect(recommendedCard.locator('.event-image-frame__img')).toBeVisible();
  await expect(recommendedCard.locator('.event-image-frame--recommended .highlights__overlay')).toHaveCount(0);
  await expect(recommendedCard.locator('.recommended-card__title')).toBeVisible();
  const frameStyles = await imageFrame.evaluate((element) => {
    const frame = window.getComputedStyle(element as HTMLElement);
    const bg = window.getComputedStyle(
      (element as HTMLElement).querySelector('.event-image-frame__bg') as HTMLElement
    );
    const img = window.getComputedStyle(
      (element as HTMLElement).querySelector('.event-image-frame__img') as HTMLElement
    );
    return {
      frameOverflow: frame.overflow,
      frameRadius: frame.borderTopLeftRadius,
      bgPosition: bg.position,
      imgObjectFit: img.objectFit
    };
  });
  expect(frameStyles.frameOverflow).toBe('hidden');
  expect(parseFloat(frameStyles.frameRadius)).toBeGreaterThan(0);
  expect(frameStyles.bgPosition).toBe('absolute');
  expect(frameStyles.imgObjectFit).toBe('contain');
  const cta = recommendedCard.locator('.recommended-card__cta', { hasText: /Квитки|Реєстрація|Детальніше/ }).first();
  await expect(cta).toBeVisible();
  const ctaWidths = await recommendedCard.evaluate((element) => {
    const cardRect = (element as HTMLElement).getBoundingClientRect();
    const ctaRect = ((element as HTMLElement).querySelector('.recommended-card__cta') as HTMLElement).getBoundingClientRect();
    return { cardWidth: cardRect.width, ctaWidth: ctaRect.width };
  });
  expect(ctaWidths.ctaWidth).toBeLessThan(ctaWidths.cardWidth * 0.75);
});

test('recommended marquee auto-loops with clone and pauses on hover', async ({ page }) => {
  await configureRecommendedApi(page, { initialOrder: ['evt-rec-1', 'evt-rec-2', 'evt-rec-3', 'evt-rec-4'] });

  await page.goto('/?serverless=1');
  const marquee = page.locator('.recommended-marquee--animated').first();
  await expect(marquee).toBeVisible();
  await expect(page.locator('.recommended-marquee__track--clone')).toHaveCount(1);

  const runningState = await marquee.evaluate((element) => {
    const inner = (element as HTMLElement).querySelector('.recommended-marquee__inner') as HTMLElement;
    const styles = window.getComputedStyle(inner);
    return { animationName: styles.animationName, playState: styles.animationPlayState };
  });
  expect(runningState.animationName).not.toBe('none');
  expect(runningState.playState).toBe('running');

  await marquee.hover();
  const pausedState = await marquee.evaluate((element) => {
    const inner = (element as HTMLElement).querySelector('.recommended-marquee__inner') as HTMLElement;
    return window.getComputedStyle(inner).animationPlayState;
  });
  expect(pausedState).toBe('paused');
});

test('recommended with three or fewer items stays static and does not clone', async ({ page }) => {
  await configureRecommendedApi(page, { initialOrder: ['evt-rec-1', 'evt-rec-2', 'evt-rec-3'] });

  await page.goto('/?serverless=1');
  await expect(page.locator('.recommended-marquee--static')).toBeVisible();
  await expect(page.locator('.recommended-marquee--animated')).toHaveCount(0);
  await expect(page.locator('.recommended-marquee__track--clone')).toHaveCount(0);
});

test('recommended marquee is disabled when prefers-reduced-motion is enabled', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await configureRecommendedApi(page, { initialOrder: ['evt-rec-1', 'evt-rec-2', 'evt-rec-3', 'evt-rec-4'] });

  await page.goto('/?serverless=1');
  await expect(page.locator('.recommended-marquee--static')).toBeVisible();
  await expect(page.locator('.recommended-marquee--animated')).toHaveCount(0);
  await expect(page.locator('.recommended-marquee__track--clone')).toHaveCount(0);
});

test('recommended CTA labels follow paid/registration/details logic', async ({ page }) => {
  await enableAdminSession(page);
  await configureRecommendedApi(page, { initialOrder: ['evt-rec-1', 'evt-rec-2', 'evt-rec-3'] });

  await page.goto('/?serverless=1');
  const card1 = page.locator('.highlights__card', { hasText: 'Recommended Event 1' }).first();
  const card2 = page.locator('.highlights__card', { hasText: 'Recommended Event 2' }).first();
  const card3 = page.locator('.highlights__card', { hasText: 'Recommended Event 3' }).first();

  await expect(card1.locator('.recommended-card__cta')).toHaveText(/Квитки/i);
  await expect(card2.locator('.recommended-card__cta')).toHaveText(/Детальніше/i);
  await expect(card3.locator('.recommended-card__cta')).toHaveText(/Реєстрація/i);
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
