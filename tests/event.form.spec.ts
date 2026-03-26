import { test, expect } from '@playwright/test';
import { enableAdminSession } from './helpers';

test('create event without end time', async ({ page }) => {
  await enableAdminSession(page);
  await page.goto('/new-event.html');
  await page.locator('.multi-step[data-ready="true"]').waitFor({ state: 'attached' });
  await page.getByLabel(/Назва|Title|Titel/i).fill('Test meetup');
  await page.getByLabel(/Опис|Description|Beskrivelse/i).fill('Short event description.');
  const tagsInput = page.getByLabel(/Додати тег|Add tag|Tilføj tag/i);
  await tagsInput.fill('Community');
  await tagsInput.press('Enter');

  await page.getByLabel(/Початок|Start/i).fill('2030-05-01T18:00');
  await page.locator('select[name="format"]').selectOption({ value: 'offline' });
  await page.locator('select[name="language"]').selectOption({ value: 'uk' });
  await page.getByLabel(/Адреса|Address|Adresse/i).fill('Copenhagen, Main St 10');
  await page.locator('input[name="city"]').fill('Copenhagen');
  // Ensure timezone selector is absent
  await expect(page.locator('[name=\"timezone\"]')).toHaveCount(0);

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

  const previewTime = page.locator('#preview-time');
  await expect(previewTime).toContainText(/01\.05\.2030/);
  await expect(previewTime).not.toContainText(/–/); // no end time range
});

test('online event can be published without city', async ({ page }) => {
  await enableAdminSession(page);
  await page.goto('/new-event.html');
  await page.locator('.multi-step[data-ready="true"]').waitFor({ state: 'attached' });

  await page.getByLabel(/Назва|Title|Titel/i).fill('Online without city');
  await page.getByLabel(/Опис|Description|Beskrivelse/i).fill('Online event description.');
  const tagsInput = page.getByLabel(/Додати тег|Add tag|Tilføj tag/i);
  await tagsInput.fill('Community');
  await tagsInput.press('Enter');

  await page.getByLabel(/Початок|Start/i).fill('2030-05-02T18:00');
  await page.locator('select[name="format"]').selectOption({ value: 'online' });
  await page.locator('select[name="language"]').selectOption({ value: 'uk' });
  await page.getByLabel(/Адреса|Address|Adresse/i).fill('Zoom');
  await page.locator('input[name="city"]').fill('');

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
  await page.getByRole('button', { name: /Опублікувати|Publish|Udgiv/i }).click();

  await expect(page).toHaveURL(/event-card\.html\?id=/);
  await expect(page.locator('[data-event-location]')).toContainText('Онлайн');
});

test('tag input shows autocomplete suggestions after 2 characters', async ({ page }) => {
  const suggestionTag = 'Unicorn Meetup Tag';
  await page.goto('/');
  await page.evaluate((tag) => {
    const key = 'wodLocalEvents';
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(list) ? list : [];
    next.push({
      id: `evt-local-tag-${Date.now()}`,
      title: 'Autocomplete seed',
      status: 'published',
      tags: [{ label: tag }]
    });
    localStorage.setItem(key, JSON.stringify(next));
  }, suggestionTag);

  await enableAdminSession(page);
  await page.goto('/new-event.html');
  await page.locator('.multi-step[data-ready="true"]').waitFor({ state: 'attached' });
  const tagsInput = page.getByLabel(/Додати тег|Add tag|Tilføj tag/i);
  await tagsInput.fill('Un');
  await expect(page.locator('#tag-suggestions option[value="Unicorn Meetup Tag"]')).toHaveCount(1);
});

test('organizer socials are hidden when saved contact socials are empty', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'wodLocalEvents',
      JSON.stringify([
        {
          id: 'evt-social-clear',
          title: 'Social Clear Event',
          description: 'Description',
          tags: [{ label: 'Community', status: 'approved' }],
          start: '2030-05-01T18:00:00+02:00',
          end: '2030-05-01T20:00:00+02:00',
          format: 'offline',
          language: 'uk',
          address: 'Main St 1',
          venue: 'Main St 1',
          city: 'Copenhagen',
          priceType: 'free',
          priceMin: null,
          priceMax: null,
          ticketUrl: '',
          organizerId: 'org-1',
          images: ['https://example.com/event.png'],
          status: 'published',
          contactPerson: {
            name: 'Organizer',
            email: 'org@example.com',
            phone: '',
            website: '',
            instagram: '',
            facebook: '',
            telegram: '',
            meta: ''
          }
        }
      ])
    );
  });

  await enableAdminSession(page);
  await page.goto('/event-card.html?id=evt-social-clear');
  await page.waitForSelector('[data-event-title]');
  await expect(page.locator('[data-organizer-socials]')).toBeHidden();
});
