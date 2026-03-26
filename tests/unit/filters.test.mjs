import test from 'node:test';
import assert from 'node:assert/strict';
import { eventMatchesFilters, filterSavedEvents } from '../../modules/filters.mjs';

const helpers = {
  normalize: (value) => String(value || '').toLowerCase(),
  normalizeCity: (value) =>
    String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase(),
  isPast: (event) => Boolean(event.past),
  isArchivedEvent: (event) => Boolean(event.archived),
  getTagList: (tags) => (tags || []).map((label) => ({ label })),
  getLocalizedEventTitle: (event) => event.title,
  getLocalizedCity: (value) => value,
  getLocalizedTag: (value) => value,
  getLang: () => 'uk'
};

test('tags filter matches any selected tag', () => {
  const event = { status: 'published', tags: ['music', 'community'] };
  const filters = { tags: ['music', 'art'] };
  assert.equal(eventMatchesFilters(event, filters, helpers), true);

  const miss = { status: 'published', tags: ['sports'] };
  assert.equal(eventMatchesFilters(miss, filters, helpers), false);
});

test('city filter matches normalized city', () => {
  const event = { status: 'published', city: 'Copenhagen' };
  const filters = { city: 'copenhagen' };
  assert.equal(eventMatchesFilters(event, filters, helpers), true);
});

test('city filter ignores online events', () => {
  const event = { status: 'published', city: 'Copenhagen', format: 'online' };
  const filters = { city: 'copenhagen' };
  assert.equal(eventMatchesFilters(event, filters, helpers), false);
});

test('past filter hides past events unless showPast is set', () => {
  const event = { status: 'published', past: true };
  assert.equal(eventMatchesFilters(event, { showPast: false }, helpers), false);
  assert.equal(eventMatchesFilters(event, { showPast: true }, helpers), true);
});

test('favorites quick filter shows only saved events', () => {
  const savedIds = new Set(['evt-1']);
  const event = { id: 'evt-1', status: 'published' };
  const unsaved = { id: 'evt-2', status: 'published' };
  const favoriteHelpers = {
    ...helpers,
    isSaved: (eventId) => savedIds.has(String(eventId || ''))
  };

  assert.equal(eventMatchesFilters(event, { quickFavorites: true }, favoriteHelpers), true);
  assert.equal(eventMatchesFilters(unsaved, { quickFavorites: true }, favoriteHelpers), false);
  assert.deepEqual(
    filterSavedEvents([event, unsaved], savedIds).map((item) => item.id),
    ['evt-1']
  );
});

test('new quick filter keeps only events created in last 14 days', () => {
  const now = new Date('2026-03-26T12:00:00Z');
  const fresh = {
    id: 'evt-fresh',
    status: 'published',
    createdAt: '2026-03-20T12:00:00Z'
  };
  const stale = {
    id: 'evt-stale',
    status: 'published',
    createdAt: '2026-03-01T12:00:00Z'
  };
  const missingCreated = {
    id: 'evt-missing',
    status: 'published'
  };

  assert.equal(eventMatchesFilters(fresh, { quickNew: true }, helpers, { now }), true);
  assert.equal(eventMatchesFilters(stale, { quickNew: true }, helpers, { now }), false);
  assert.equal(eventMatchesFilters(missingCreated, { quickNew: true }, helpers, { now }), false);
});
