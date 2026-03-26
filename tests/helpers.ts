export async function gotoHome(page) {
  await page.goto('/');
}

export async function waitForEventsRendered(page) {
  await page.waitForSelector('[data-testid="event-card"]', { state: 'visible' });
}

export async function enableAdminSession(page) {
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

export async function createEventToPreview(page) {
  await enableAdminSession(page);
  await page.goto('/new-event.html');
  await page.locator('.multi-step').waitFor({ state: 'visible' });
  await page.locator('.multi-step').waitFor({ state: 'attached' });
  await page.locator('.multi-step[data-ready="true"]').waitFor({ state: 'attached' });

  // Basics
  await page.getByLabel(/Назва|Title|Titel/i).fill('Test meetup');
  await page.getByLabel(/Опис|Description|Beskrivelse/i).fill('Short event description for preview.');
  const tagsInput = page.getByLabel(/Додати тег|Add tag|Tilføj tag/i);
  await tagsInput.fill('Community');
  await tagsInput.press('Enter');

  // Time & location
  await page.getByLabel(/Початок|Start/i).fill('2030-05-01T18:00');
  await page.getByLabel(/Завершення|End/i).fill('2030-05-01T20:00');
  await page.locator('select[name="format"]').selectOption({ value: 'offline' });
  await page.locator('select[name="language"]').selectOption({ value: 'uk' });
  await page.getByLabel(/Адреса|Address|Adresse/i).fill('Copenhagen, Main St 10');
  await page.locator('input[name="city"]').fill('Copenhagen');

  // Tickets
  await page.getByLabel(/Платно|Paid|Betalt/i).check();
  await page.getByLabel(/Ціна квитка|Ticket price|Pris/i).fill('50–120');

  // Media + contacts
  await page.locator('input[name="image"]').waitFor({ state: 'visible' });
  await page.locator('input[name="image"]').setInputFiles({
    name: 'event.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P4z8DwHwAE/wJ/lYt9NwAAAABJRU5ErkJggg==',
      'base64'
    )
  });
  await page.getByLabel(/Організація|Organization|Organisation/i).fill('Community Hub');
}
