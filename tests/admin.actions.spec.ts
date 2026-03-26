import { test, expect } from '@playwright/test';
import { enableAdminSession, waitForEventsRendered } from './helpers';

test('admin can archive and restore event from detail page', async ({ page }) => {
  await enableAdminSession(page);
  await page.goto('/event-card.html?id=evt-006');
  await page.waitForSelector('[data-event-title]');

  const archiveBtn = page.locator('[data-action="admin-archive"]');
  const restoreBtn = page.locator('[data-action="admin-restore"]');
  const badge = page.locator('[data-admin-archived-badge]');

  await expect(archiveBtn).toBeVisible();
  await archiveBtn.click();
  await expect(badge).toBeVisible();
  await expect(restoreBtn).toBeVisible();

  await restoreBtn.click();
  await expect(badge).toBeHidden();
  await expect(archiveBtn).toBeVisible();
});

test('admin can delete event from detail page with confirm', async ({ page }) => {
  await enableAdminSession(page);
  await page.goto('/event-card.html?id=evt-006');
  await page.waitForSelector('[data-event-title]');

  page.once('dialog', async (dialog) => {
    await dialog.accept();
  });

  await page.locator('[data-action="admin-delete"]').click();
  await expect(page).toHaveURL(/admin-page\.html#archive/);
});

test('admin can restore archived event from admin archive', async ({ page }) => {
  await page.addInitScript(() => {
    const archivedEvent = {
      id: 'evt-arch-1',
      title: 'Archived Event',
      start: '2026-01-12T10:00:00',
      city: 'Copenhagen',
      archived: true,
      status: 'archived'
    };
    localStorage.setItem('wodLocalEvents', JSON.stringify([archivedEvent]));
    localStorage.setItem('wodDeletedEvents', JSON.stringify([]));
    localStorage.setItem('wodAuditLog', JSON.stringify([]));
  });
  await enableAdminSession(page);
  await page.goto('/admin-page.html');

  const card = page.locator('[data-admin-archive-card][data-event-id="evt-arch-1"]');
  await expect(page.locator('body')).toHaveAttribute('data-admin-auth', 'granted');
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.locator('[data-action="restore"]').click();
  await expect(card).toHaveCount(0);
});

test('admin can delete archived event from admin archive with confirm', async ({ page }) => {
  await page.addInitScript(() => {
    const archivedEvent = {
      id: 'evt-arch-2',
      title: 'Archived Event 2',
      start: '2026-01-15T12:00:00',
      city: 'Aarhus',
      archived: true,
      status: 'archived'
    };
    localStorage.setItem('wodLocalEvents', JSON.stringify([archivedEvent]));
    localStorage.setItem('wodDeletedEvents', JSON.stringify([]));
    localStorage.setItem('wodAuditLog', JSON.stringify([]));
  });
  await enableAdminSession(page);
  await page.goto('/admin-page.html');

  const card = page.locator('[data-admin-archive-card][data-event-id="evt-arch-2"]');
  await expect(page.locator('body')).toHaveAttribute('data-admin-auth', 'granted');
  await expect(card).toBeVisible({ timeout: 10000 });

  page.once('dialog', async (dialog) => {
    await dialog.accept();
  });

  await card.locator('[data-action="delete"]').click();
  await expect(card).toHaveCount(0);
});

test('admin can open archived event via admin-event when not in public list', async ({ page }) => {
  await enableAdminSession(page);
  let adminEventHits = 0;
  await page.route('**/.netlify/functions/public-events', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.route('**/.netlify/functions/admin-event*', (route) => {
    adminEventHits += 1;
    const payload = {
      ok: true,
      event: {
        id: 'evt-arch-remote',
        title: 'Remote Archived Event',
        description: 'Archived event loaded for admin.',
        tags: [],
        start: '2026-03-01T10:00:00Z',
        end: null,
        format: 'offline',
        venue: 'Venue',
        address: 'Address',
        city: 'Copenhagen',
        priceType: 'free',
        priceMin: null,
        priceMax: null,
        ticketUrl: '',
        organizerId: '',
        images: [],
        status: 'archived',
        language: 'uk',
        forUkrainians: true,
        familyFriendly: false,
        volunteer: false,
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
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload)
    });
  });

  await page.goto('/event-card.html?id=evt-arch-remote&serverless=1');
  await page.waitForSelector('[data-event-title]');
  await expect(page.locator('[data-event-title]')).toHaveText('Remote Archived Event');
  await expect(page.locator('[data-admin-archived-badge]')).toBeVisible();
  await expect.poll(() => adminEventHits).toBeGreaterThan(0);
});

test('admin can edit archived event opened from archive list and keep archived status until restore', async ({ page }) => {
  await page.addInitScript(() => {
    const seedEvent = {
      id: 'evt-arch-flow',
      title: 'Archive Flow Event',
      description: 'Archive flow description.',
      tags: [{ label: 'Community', status: 'approved' }],
      start: '2030-08-01T18:00:00+02:00',
      end: '2030-08-01T20:00:00+02:00',
      format: 'offline',
      venue: 'Venue',
      address: 'Main St 10',
      city: 'Copenhagen',
      priceType: 'free',
      priceMin: null,
      priceMax: null,
      ticketUrl: '',
      organizerId: '',
      images: ['https://example.com/event.png'],
      status: 'archived',
      archived: true,
      language: 'uk',
      contactPerson: {
        name: 'Admin',
        email: 'admin@example.com',
        phone: '',
        website: '',
        instagram: '',
        facebook: '',
        telegram: ''
      }
    };
    localStorage.setItem('wodLocalEvents', JSON.stringify([seedEvent]));
    localStorage.setItem('wodDeletedEvents', JSON.stringify([]));
    localStorage.setItem('wodAuditLog', JSON.stringify([]));
  });
  await enableAdminSession(page);

  await page.goto('/admin-page.html#archive');
  const card = page.locator('[data-admin-archive-card][data-event-id="evt-arch-flow"]');
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.locator('[data-admin-archive-link]').click();
  await expect(page).toHaveURL(/event-card\.html\?id=evt-arch-flow/);
  await expect(page.locator('[data-action="admin-edit"]')).toBeVisible();

  await page.locator('[data-action="admin-edit"]').click();
  await expect(page).toHaveURL(/new-event\.html\?id=evt-arch-flow/);
  await page.locator('.multi-step[data-ready="true"]').waitFor({ state: 'attached' });
  const titleField = page.getByLabel(/Назва|Title|Titel/i);
  await expect(titleField).toHaveValue('Archive Flow Event');
  await titleField.fill('Archive Flow Event Updated');
  await expect(titleField).toHaveValue('Archive Flow Event Updated');
  await page.getByLabel(/Початок|Start/i).waitFor({ state: 'visible' });
  await page.getByLabel(/Платно|Paid|Betalt|Безкоштовно|Free|Gratis/i).first().waitFor({ state: 'visible' });
  await page.locator('input[name="image"]').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /Опублікувати|Publish|Udgiv/i }).click();

  await expect(page).toHaveURL(/event-card\.html\?id=evt-arch-flow/);
  const isArchivedAfterSave = await page.evaluate(() => {
    const raw = localStorage.getItem('wodLocalEvents');
    const events = raw ? JSON.parse(raw) : [];
    const event = Array.isArray(events) ? events.find((item) => item?.id === 'evt-arch-flow') : null;
    if (!event) return false;
    return event.archived === true || String(event.status || '').toLowerCase() === 'archived';
  });
  expect(isArchivedAfterSave).toBeTruthy();

  await page.goto('/admin-page.html#archive');
  const updatedArchiveCard = page.locator('[data-admin-archive-card][data-event-id="evt-arch-flow"]');
  await expect(updatedArchiveCard).toBeVisible({ timeout: 10000 });
  await updatedArchiveCard.locator('[data-action="restore"]').click();
  await expect(updatedArchiveCard).toHaveCount(0);

  const isPublishedAfterRestore = await page.evaluate(() => {
    const raw = localStorage.getItem('wodLocalEvents');
    const events = raw ? JSON.parse(raw) : [];
    const event = Array.isArray(events) ? events.find((item) => item?.id === 'evt-arch-flow') : null;
    if (!event) return false;
    return event.archived !== true && String(event.status || '').toLowerCase() === 'published';
  });
  expect(isPublishedAfterRestore).toBeTruthy();
});

test('admin waits for delayed identity init and still opens archived detail via admin endpoint', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('wodAdminSession');
    const adminUser = {
      email: 'admin@test.local',
      app_metadata: { roles: ['admin'] },
      token: { access_token: 'test-token' }
    };
    const handlers = {};
    const addHandler = (event, cb) => {
      handlers[event] = handlers[event] || [];
      handlers[event].push(cb);
    };
    const emit = (event, payload) => {
      (handlers[event] || []).forEach((handler) => handler(payload));
    };
    let currentUser = null;
    window.netlifyIdentity = {
      on(event, cb) {
        addHandler(event, cb);
      },
      init() {
        setTimeout(() => {
          currentUser = adminUser;
          emit('init', adminUser);
        }, 250);
      },
      currentUser() {
        return currentUser;
      },
      open() {},
      close() {},
      logout() {}
    };
  });

  await page.route('**/.netlify/functions/public-event*', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'not_found' })
    })
  );
  await page.route('**/.netlify/functions/admin-event*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        event: {
          id: 'evt-arch-race',
          title: 'Delayed Identity Archived Event',
          description: 'Loaded after identity init.',
          tags: [],
          start: '2030-03-01T10:00:00Z',
          end: null,
          format: 'offline',
          venue: 'Venue',
          address: 'Address',
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
            meta: ''
          }
        }
      })
    })
  );

  await page.goto('/event-card.html?id=evt-arch-race&serverless=1');
  await page.waitForSelector('[data-event-title]');
  await expect(page).not.toHaveURL(/404\.html/);
  await expect(page.locator('[data-event-title]')).toHaveText('Delayed Identity Archived Event');
  await expect(page.locator('[data-action="admin-edit"]')).toBeVisible();
});

test('public user opening archived event url is redirected to 404', async ({ page }) => {
  await page.route('**/.netlify/functions/public-event*', (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'not_found' })
    })
  );

  await page.goto('/event-card.html?id=evt-arch-public&serverless=1');
  await expect(page).toHaveURL(/404\.html/);
});
