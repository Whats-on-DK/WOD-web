import { test, expect } from '@playwright/test';
import { freezeTime } from './setup.freeze-time';
import { waitForEventsRendered } from './helpers';

test('main page renders key sections and hides add-event CTA', async ({ page }) => {
  await freezeTime(page);
  await page.goto('/');
  await waitForEventsRendered(page);

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('#events')).toBeVisible();

  const addEventLinks = page.getByRole('link', { name: /Додати подію/i });
  await expect(addEventLinks).toHaveCount(0);
});

test('hero card shows background image when available', async ({ page }) => {
  await freezeTime(page);
  await page.goto('/');
  await waitForEventsRendered(page);

  const heroMedia = page.locator('[data-hero-media]');
  await expect(heroMedia).toBeVisible();
  const backgroundImage = await heroMedia.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(backgroundImage).not.toBe('none');
});

test('hero CTA navigates to catalog anchor', async ({ page }) => {
  await freezeTime(page);
  await page.goto('/');

  const cta = page.getByRole('link', { name: /Переглянути події/i });
  await cta.click();
  await expect(page.locator('#events')).toBeInViewport();
});

test('advanced filters toggle is controlled only by the button', async ({ page }) => {
  await freezeTime(page);
  await page.goto('/');

  const advancedToggle = page.locator('[data-action="filters-advanced"]');
  const advancedPanel = page.locator('#filters-advanced');

  await expect(advancedPanel).toBeHidden();
  await expect(advancedToggle).toHaveAttribute('aria-expanded', 'false');

  await advancedToggle.click();
  await expect(advancedPanel).toBeVisible();
  await expect(advancedToggle).toHaveAttribute('aria-expanded', 'true');

  await advancedToggle.click();
  await expect(advancedPanel).toBeHidden();
  await expect(advancedToggle).toHaveAttribute('aria-expanded', 'false');
});

test('quick presets do not auto-open advanced filters', async ({ page }) => {
  await freezeTime(page);
  await page.goto('/');

  const advancedPanel = page.locator('#filters-advanced');
  const advancedToggle = page.locator('[data-action="filters-advanced"]');

  await page.getByRole('button', { name: /Онлайн/i }).click();
  await page.locator('input[name="show-past"]').setChecked(true, { force: true });

  await expect(advancedPanel).toBeHidden();
  await expect(advancedToggle).toHaveAttribute('aria-expanded', 'false');
});

test('filters update URL and reset clears selections', async ({ page }) => {
  await freezeTime(page);
  await page.goto('/');
  await waitForEventsRendered(page);

  await page.getByRole('combobox', { name: /Місто/i }).selectOption({ value: 'aarhus' });
  await expect(page).toHaveURL(/city=aarhus/);

  await page.getByRole('button', { name: /Вихідні/i }).click();
  await expect(page).toHaveURL(/weekend=1/);

  await page.locator('input[name="show-past"]').setChecked(true, { force: true });
  await expect(page).toHaveURL(/past=1/);

  await page.getByTestId('filters-reset').click();
  await expect(page).not.toHaveURL(/city=|weekend=|past=1/);
});

test('reset filters clears selected tags and keeps advanced panel open', async ({ page }) => {
  await freezeTime(page);
  await page.goto('/');
  await waitForEventsRendered(page);

  const advancedToggle = page.locator('[data-action="filters-advanced"]');
  const advancedPanel = page.locator('#filters-advanced');

  await advancedToggle.click();
  await expect(advancedPanel).toBeVisible();

  const tagLabel = await page.$$eval('[data-testid="event-card"]', (cards) => {
    for (const card of cards) {
      const tags = Array.from(card.querySelectorAll('.event-card__tag'))
        .map((tag) => tag.textContent?.trim())
        .filter(Boolean);
      if (tags.length) return tags[0];
    }
    return '';
  });
  expect(tagLabel).toBeTruthy();

  const tag = page.locator('[data-filters-tags-list] .filters__tag', { hasText: tagLabel });
  await tag.first().click();

  await expect(page).toHaveURL(/tags=/);
  await expect(
    page.locator('[data-filters-tags-list] .filters__tag--selected', { hasText: tagLabel })
  ).toHaveCount(1);

  await page.getByTestId('filters-reset').click();

  await expect(page).not.toHaveURL(/tags=/);
  await expect(page.locator('[data-filters-tags-list] .filters__tag--selected')).toHaveCount(0);
  await expect(page.locator('[data-filters-tags-list] .filters__tag', { hasText: tagLabel })).toBeVisible();
  await expect(advancedPanel).toBeVisible();
  await expect(advancedToggle).toHaveAttribute('aria-expanded', 'true');
});

test('reset filters keeps advanced panel closed when collapsed', async ({ page }) => {
  await freezeTime(page);
  await page.goto('/');
  await waitForEventsRendered(page);

  const advancedToggle = page.locator('[data-action="filters-advanced"]');
  const advancedPanel = page.locator('#filters-advanced');

  await advancedToggle.click();
  await expect(advancedPanel).toBeVisible();

  await page.locator('[data-filters-tags-list] .filters__tag').first().click();
  await expect(page).toHaveURL(/tags=/);

  await advancedToggle.click();
  await expect(advancedPanel).toBeHidden();
  await expect(advancedToggle).toHaveAttribute('aria-expanded', 'false');

  await page.getByTestId('filters-reset').click();

  await expect(page).not.toHaveURL(/tags=/);
  await expect(advancedPanel).toBeHidden();
  await expect(advancedToggle).toHaveAttribute('aria-expanded', 'false');
});

test('catalog pagination shows page numbers and switches pages', async ({ page }) => {
  await freezeTime(page);
  await page.goto('/');
  await waitForEventsRendered(page);

  const pages = page.locator('[data-catalog-pages] .catalog-page');
  await expect(pages.first()).toBeVisible();
  const pageCount = await pages.count();
  expect(pageCount).toBeGreaterThan(1);

  const firstTitle = await page.getByTestId('event-card').first().locator('.event-card__title a').innerText();
  await pages.nth(1).click();
  await expect(page).toHaveURL(/page=2/);

  const secondTitle = await page.getByTestId('event-card').first().locator('.event-card__title a').innerText();
  expect(secondTitle).not.toEqual(firstTitle);
});

test('tag filter pulls events from later pages and resets to page 1', async ({ page }) => {
  await freezeTime(page);
  await page.goto('/');
  await waitForEventsRendered(page);

  const pages = page.locator('[data-catalog-pages] .catalog-page');
  const pageCount = await pages.count();
  expect(pageCount).toBeGreaterThan(1);

  await pages.nth(1).click();
  await expect(page).toHaveURL(/page=2/);

  const secondPageCard = page.getByTestId('event-card').first();
  const cardTitle = await secondPageCard.locator('.event-card__title a').innerText();
  const tag = secondPageCard.locator('.event-card__tag').first();
  await expect(tag).toBeVisible();
  const tagLabel = await tag.innerText();

  const advancedToggle = page.locator('[data-action="filters-advanced"]');
  if ((await advancedToggle.getAttribute('aria-expanded')) !== 'true') {
    await advancedToggle.click();
  }

  await page.locator('[data-filters-tags-list] .filters__tag', { hasText: tagLabel }).first().click();

  await expect(page).not.toHaveURL(/page=2/);
  await expect(page).toHaveURL(/tags=/);
  await expect(page.locator('.event-card__title a', { hasText: cardTitle })).toBeVisible();
});

test('tag filters reorder on selection and keep URL in sync', async ({ page }) => {
  await freezeTime(page);
  await page.goto('/');
  await waitForEventsRendered(page);

  const advancedToggle = page.locator('[data-action="filters-advanced"]');
  await advancedToggle.click();

  const tagLabels = await page.$$eval('[data-testid="event-card"]', (cards) => {
    for (const card of cards) {
      const tags = Array.from(card.querySelectorAll('.event-card__tag'))
        .map((tag) => tag.textContent?.trim())
        .filter(Boolean);
      if (tags.length >= 2) return tags.slice(0, 2);
    }
    return [];
  });
  expect(tagLabels.length).toBe(2);
  const [firstLabel, secondLabel] = tagLabels;
  const tagsList = page.locator('[data-filters-tags-list] .filters__tag');
  await expect(tagsList.first()).toBeVisible();

  await page.locator('[data-filters-tags-list] .filters__tag', { hasText: secondLabel }).click();
  await expect(page).toHaveURL(/tags=/);
  await page.locator('[data-filters-tags-list] .filters__tag', { hasText: firstLabel }).click();

  const firstTagText = await tagsList.nth(0).locator('span').innerText();
  const secondTagText = await tagsList.nth(1).locator('span').innerText();
  const topTags = [firstTagText, secondTagText];
  expect(topTags).toContain(firstLabel);
  expect(topTags).toContain(secondLabel);

  await expect(
    page.locator('[data-filters-tags-list] .filters__tag--selected', { hasText: firstLabel })
  ).toHaveCount(1);
  await expect(
    page.locator('[data-filters-tags-list] .filters__tag--selected', { hasText: secondLabel })
  ).toHaveCount(1);
});

test('city dropdown and advanced button keep responsive horizontal layout until small phone', async ({ page }) => {
  const assertSameRowAtWidth = async (width: number) => {
    await page.setViewportSize({ width, height: 900 });
    await freezeTime(page);
    await page.goto('/');
    await waitForEventsRendered(page);

    const citySelect = page.locator('.filters__row--main select[name="city"]');
    const advancedButton = page.locator('.filters__row--main [data-action="filters-advanced"]');
    await expect(citySelect).toBeVisible();
    await expect(advancedButton).toBeVisible();

    const cityBox = await citySelect.boundingBox();
    const buttonBox = await advancedButton.boundingBox();
    expect(cityBox).toBeTruthy();
    expect(buttonBox).toBeTruthy();
    if (!cityBox || !buttonBox) return;

    expect(buttonBox.x).toBeGreaterThan(cityBox.x + 8);
    expect(Math.abs(buttonBox.y - cityBox.y)).toBeLessThan(18);
    expect(buttonBox.y).toBeLessThan(cityBox.y + cityBox.height - 2);
  };

  await assertSameRowAtWidth(700);
  await assertSameRowAtWidth(520);

  await page.setViewportSize({ width: 390, height: 844 });
  await freezeTime(page);
  await page.goto('/');
  await waitForEventsRendered(page);

  const citySelect = page.locator('.filters__row--main select[name="city"]');
  const advancedButton = page.locator('.filters__row--main [data-action="filters-advanced"]');
  await expect(citySelect).toBeVisible();
  await expect(advancedButton).toBeVisible();

  const cityBox = await citySelect.boundingBox();
  const buttonBox = await advancedButton.boundingBox();
  expect(cityBox).toBeTruthy();
  expect(buttonBox).toBeTruthy();
  if (!cityBox || !buttonBox) return;

  const intersects =
    cityBox.x < buttonBox.x + buttonBox.width &&
    cityBox.x + cityBox.width > buttonBox.x &&
    cityBox.y < buttonBox.y + buttonBox.height &&
    cityBox.y + cityBox.height > buttonBox.y;
  expect(intersects).toBeFalsy();
});

test('all tags modal is scrollable on mobile and keeps page scroll locked', async ({ page }) => {
  await page.route('**/.netlify/functions/public-events**', async (route) => {
    const url = new URL(route.request().url());
    const pageNum = url.searchParams.get('page') || '1';
    if (pageNum !== '1') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    const tags = Array.from({ length: 70 }, (_, index) => ({
      label: `Tag ${String(index + 1).padStart(2, '0')}`,
      status: 'approved'
    }));
    const events = [
      {
        id: 'evt-tags-modal-1',
        slug: 'evt-tags-modal-1',
        title: 'Tags Modal Event',
        description: 'Tags modal test',
        tags,
        start: '2031-01-04T12:00:00+01:00',
        end: '2031-01-04T14:00:00+01:00',
        format: 'offline',
        venue: 'Venue',
        address: 'Address 1',
        city: 'Copenhagen',
        priceType: 'free',
        priceMin: 0,
        priceMax: 0,
        ticketUrl: '',
        organizerId: 'org-1',
        images: [],
        status: 'published',
        language: 'uk',
        contactPerson: {}
      }
    ];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(events)
    });
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await waitForEventsRendered(page);

  await page.locator('[data-action="filters-advanced"]').click();
  const moreButton = page.locator('[data-filters-tags-more]');
  await expect(moreButton).toBeVisible();
  await moreButton.click();

  const modal = page.locator('[data-tags-modal]');
  const modalList = page.locator('[data-tags-modal-list]');
  await expect(modal).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/tag-modal-open/);

  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 800);
  const after = await page.evaluate(() => window.scrollY);
  expect(after).toBe(before);

  await modalList.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });

  const lastTag = modalList.locator('.filters__tag').last();
  await expect(lastTag).toBeVisible();
  await expect(lastTag).toBeInViewport();

  const panelBox = await page.locator('.tag-modal__panel').boundingBox();
  const lastTagBox = await lastTag.boundingBox();
  expect(panelBox).toBeTruthy();
  expect(lastTagBox).toBeTruthy();
  if (panelBox && lastTagBox) {
    expect(lastTagBox.y + lastTagBox.height).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1);
  }

  await page.locator('.tag-modal__close').click();
  await expect(modal).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/tag-modal-open/);
});
