import { test, expect } from '@playwright/test';
import { enableAdminSession, waitForEventsRendered } from './helpers';

test('create local event with en/da language and show it in detail and catalog', async ({ page }) => {
  await enableAdminSession(page);
  await page.goto('/new-event.html');
  await page.locator('.multi-step[data-ready="true"]').waitFor({ state: 'attached' });

  await page.getByLabel(/Назва|Title|Titel/i).fill('Language en/da Event');
  await page.getByLabel(/Опис|Description|Beskrivelse/i).fill('Language coverage test.');
  const tagsInput = page.getByLabel(/Додати тег|Add tag|Tilføj tag/i);
  await tagsInput.fill('Community');
  await tagsInput.press('Enter');

  await page.getByLabel(/Початок|Start/i).fill('2030-06-01T18:00');
  await page.getByLabel(/Завершення|End/i).fill('2030-06-01T20:00');
  await page.locator('select[name="format"]').selectOption({ value: 'offline' });
  await page.locator('select[name="language"]').selectOption({ value: 'en/da' });
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
  await page.locator('input[name="contact-name"]').fill('Olena K.');
  await page.locator('input[name="contact-email"]').fill('verify@example.com');
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/event-card\.html\?id=/);
  await expect(page.locator('[data-event-language]')).toHaveText('Англійська/Данська');
  const eventId = new URL(page.url()).searchParams.get('id');
  expect(eventId).toBeTruthy();

  await page.goto('/');
  await waitForEventsRendered(page);
  await expect(page.locator(`[data-event-id="${eventId}"] .event-card__language`)).toHaveText(
    'Англійська/Данська'
  );
});

test('legacy mixed language is shown as Ukrainian/English on catalog and detail', async ({ page }) => {
  const event = {
    id: 'evt-mixed-language',
    title: 'Legacy Mixed Event',
    description: 'Legacy language rendering.',
    tags: [],
    start: '2030-03-10T18:00:00+01:00',
    end: '2030-03-10T20:00:00+01:00',
    format: 'offline',
    venue: '',
    address: 'Main St 10',
    city: 'Copenhagen',
    priceType: 'free',
    priceMin: null,
    priceMax: null,
    ticketUrl: '',
    organizerId: '',
    images: [],
    status: 'published',
    language: 'mixed',
    contactPerson: {
      name: '',
      email: '',
      phone: '',
      website: '',
      instagram: '',
      facebook: '',
      meta: ''
    }
  };

  await page.addInitScript((seedEvent) => {
    localStorage.setItem('wodLocalEvents', JSON.stringify([seedEvent]));
  }, event);

  await page.goto('/');
  await waitForEventsRendered(page);
  await expect(page.locator(`[data-event-id="${event.id}"] .event-card__language`)).toHaveText(
    'Українська/Англійська'
  );

  await page.goto(`/event-card.html?id=${event.id}`);
  await page.waitForSelector('[data-event-title]');
  await expect(page.locator('[data-event-language]')).toHaveText('Українська/Англійська');
  await expect(page.locator('[data-event-language]')).not.toHaveText(/mixed/i);
});
