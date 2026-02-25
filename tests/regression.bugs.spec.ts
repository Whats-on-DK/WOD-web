import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import { enableAdminSession, createEventToPreview } from './helpers';
import { freezeTime } from './setup.freeze-time';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesPath = path.join(__dirname, '..', 'data', 'events.json');

const readEvents = () => JSON.parse(fs.readFileSync(fixturesPath, 'utf-8'));

const isPastEvent = (event: { start?: string; end?: string }, now: Date) => {
  if (event?.end) {
    const endDate = new Date(event.end);
    return !Number.isNaN(endDate.getTime()) && endDate < now;
  }
  if (!event?.start) return false;
  const startDate = new Date(event.start);
  return !Number.isNaN(startDate.getTime()) && startDate < now;
};

test('publish persists description and prevents empty submission', async ({ page }) => {
  await freezeTime(page);
  await enableAdminSession(page);
  await createEventToPreview(page);

  await page.evaluate(() => {
    const field = document.querySelector('textarea[name="description"]') as HTMLTextAreaElement | null;
    if (!field) return;
    field.value = '';
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await page.getByRole('button', { name: /Опублікувати|Publish|Udgiv/i }).click();
  await expect(page).toHaveURL(/new-event\.html/);
  await expect(page.locator('[data-submit-status]')).toContainText(/опис/i);

  await page.evaluate(() => {
    const field = document.querySelector('textarea[name="description"]') as HTMLTextAreaElement | null;
    if (!field) return;
    field.value = 'Unique description for regression test.';
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('button', { name: /Опублікувати|Publish|Udgiv/i }).click();

  await expect(page).toHaveURL(/event-card\.html\?id=/);
  await expect(page.locator('[data-event-description]')).toHaveText(
    'Unique description for regression test.'
  );
});

test('editing a published event updates description on detail page', async ({ page }) => {
  await freezeTime(page);
  await enableAdminSession(page);
  await createEventToPreview(page);

  await page.getByRole('button', { name: /Опублікувати|Publish|Udgiv/i }).click();
  await expect(page).toHaveURL(/event-card\.html\?id=/);

  const eventId = new URL(page.url()).searchParams.get('id');
  expect(eventId).toBeTruthy();
  await page.goto(`/new-event.html?id=${eventId}`);
  await page.locator('.multi-step[data-ready="true"]').waitFor({ state: 'attached' });

  const descriptionField = page.getByLabel(/Опис|Description|Beskrivelse/i);
  await expect(descriptionField).toHaveValue('Short event description for preview.');
  await descriptionField.fill('Updated description after edit.');
  await page.getByRole('button', { name: /Далі|Next|Næste/i }).click();
  await page.getByLabel(/Початок|Start/i).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /Далі|Next|Næste/i }).click();
  await page.getByLabel(/Платно|Paid|Betalt|Безкоштовно|Free|Gratis/i).first().waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /Далі|Next|Næste/i }).click();
  await page.locator('input[name="image"]').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /Далі|Next|Næste/i }).click();

  await page.getByRole('button', { name: /Опублікувати|Publish|Udgiv/i }).click();
  await expect(page).toHaveURL(/event-card\.html\?id=/);
  await expect(page.locator('[data-event-description]')).toHaveText(
    'Updated description after edit.'
  );
});

test('filters show only active tags and include all active cities', async ({ page }) => {
  await freezeTime(page);
  const events = readEvents();
  const now = new Date('2026-01-03T12:00:00+01:00');
  const active = events.filter((event: any) => {
    if (!event || event.status !== 'published') return false;
    if (event.archived === true || event.status === 'archived') return false;
    return !isPastEvent(event, now);
  });
  const expectedTags = new Set(
    active
      .flatMap((event: any) => (event.tags || []).map((tag: any) => String(tag.label || tag)))
      .map((value: string) => value.trim().toLowerCase())
      .filter(Boolean)
  );
  const expectedCities = new Set(
    active
      .map((event: any) => String(event.city || '').trim().toLowerCase())
      .filter(Boolean)
  );

  await page.goto('/?highlights=weekly');
  const advancedToggle = page.locator('[data-action="filters-advanced"]');
  await advancedToggle.click();
  await page.locator('[data-filters-tags-list] .filters__tag').first().waitFor();

  const tagValues = await page.$$eval('[data-filters-tags-list] input[type="checkbox"]', (els) =>
    els.map((el) => String(el.getAttribute('value') || '').trim().toLowerCase()).filter(Boolean)
  );
  tagValues.forEach((value) => {
    expect(expectedTags.has(value)).toBeTruthy();
  });

  const cityValues = await page.$$eval('select[name="city"] option', (els) =>
    els.map((el) => String(el.getAttribute('value') || '').trim().toLowerCase()).filter(Boolean)
  );
  expectedCities.forEach((city) => {
    expect(cityValues.includes(city)).toBeTruthy();
  });
});

test('highlights show online label for online events', async ({ page }) => {
  await freezeTime(page);
  await page.addInitScript(() => {
    const localEvents = [
      {
        id: 'evt-online-1',
        title: 'Online Workshop',
        description: 'Remote session.',
        start: '2026-01-04T10:00:00+01:00',
        end: '2026-01-04T11:00:00+01:00',
        format: 'online',
        venue: '',
        address: 'Google Meet',
        city: 'Copenhagen',
        priceType: 'free',
        priceMin: null,
        priceMax: null,
        ticketUrl: '',
        tags: [],
        status: 'published',
        images: []
      }
    ];
    localStorage.setItem('wodLocalEvents', JSON.stringify(localEvents));
    localStorage.setItem('wodDeletedEvents', JSON.stringify([]));
  });

  await page.goto('/?highlights=weekly');
  const highlightCard = page.locator('.highlights__card', { hasText: 'Online Workshop' });
  await expect(highlightCard).toBeVisible();
  await expect(highlightCard.locator('.highlights__city')).toContainText(/Онлайн/i);
});

test('highlights only include events through Sunday of current week', async ({ page }) => {
  await freezeTime(page);
  await page.addInitScript(() => {
    const localEvents = [
      {
        id: 'evt-sun-week',
        title: 'Sunday Event',
        description: 'Within current week.',
        start: '2026-01-04T10:00:00+01:00',
        end: '2026-01-04T11:00:00+01:00',
        format: 'offline',
        venue: '',
        address: 'Copenhagen',
        city: 'Copenhagen',
        priceType: 'free',
        priceMin: null,
        priceMax: null,
        ticketUrl: '',
        tags: [],
        status: 'published',
        images: []
      },
      {
        id: 'evt-next-week',
        title: 'Next Monday Event',
        description: 'Next week event.',
        start: '2026-01-05T10:00:00+01:00',
        end: '2026-01-05T11:00:00+01:00',
        format: 'offline',
        venue: '',
        address: 'Copenhagen',
        city: 'Copenhagen',
        priceType: 'free',
        priceMin: null,
        priceMax: null,
        ticketUrl: '',
        tags: [],
        status: 'published',
        images: []
      }
    ];
    localStorage.setItem('wodLocalEvents', JSON.stringify(localEvents));
    localStorage.setItem('wodDeletedEvents', JSON.stringify([]));
  });

  await page.goto('/?highlights=weekly');
  await expect(page.locator('.highlights__card', { hasText: 'Sunday Event' })).toBeVisible();
  await expect(page.locator('.highlights__card', { hasText: 'Next Monday Event' })).toHaveCount(0);
});

test('catalog shows only city and not full address', async ({ page }) => {
  await freezeTime(page);
  await page.addInitScript(() => {
    const localEvents = [
      {
        id: 'evt-city-only-1',
        title: 'City Only Event',
        description: 'Test',
        start: '2026-01-10T10:00:00+01:00',
        end: '2026-01-10T11:00:00+01:00',
        format: 'offline',
        venue: '',
        address: 'Sankt Ansgar Kirke, Bredgade 64, Copenhagen',
        city: 'Copenhagen',
        priceType: 'free',
        priceMin: null,
        priceMax: null,
        ticketUrl: '',
        tags: [],
        status: 'published',
        images: []
      }
    ];
    localStorage.setItem('wodLocalEvents', JSON.stringify(localEvents));
    localStorage.setItem('wodDeletedEvents', JSON.stringify([]));
  });

  await page.goto('/#events');
  await page.waitForSelector('[data-testid="event-card"]');
  const card = page.locator('[data-testid="event-card"]', { hasText: 'City Only Event' });
  const location = card.locator('.event-card__location');
  await expect(location).toHaveText('Copenhagen');
  await expect(location).not.toContainText('Bredgade');
});
