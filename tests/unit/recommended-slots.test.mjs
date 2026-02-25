import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEffectiveUntil,
  insertRecommendedAtPosition,
  removeRecommendedItem
} from '../../modules/recommended-slots.mjs';

test('insert at position K shifts following items down', () => {
  const current = [
    { id: 'evt-1', position: 1 },
    { id: 'evt-2', position: 2 },
    { id: 'evt-3', position: 3 }
  ];
  const result = insertRecommendedAtPosition(current, { id: 'evt-new' }, 2);
  assert.equal(result.ok, true);
  assert.deepEqual(
    result.items.map((item) => item.id),
    ['evt-1', 'evt-new', 'evt-2', 'evt-3']
  );
  assert.deepEqual(
    result.items.map((item) => item.position),
    [1, 2, 3, 4]
  );
});

test('insert blocks when six slots are already active', () => {
  const current = Array.from({ length: 6 }, (_, index) => ({
    id: `evt-${index + 1}`,
    position: index + 1
  }));
  const result = insertRecommendedAtPosition(current, { id: 'evt-7' }, 4);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'max_slots_reached');
});

test('gap closes after removal', () => {
  const current = [
    { id: 'evt-1', position: 1 },
    { id: 'evt-2', position: 2 },
    { id: 'evt-3', position: 3 }
  ];
  const next = removeRecommendedItem(current, 'evt-2');
  assert.deepEqual(
    next.map((item) => ({ id: item.id, position: item.position })),
    [
      { id: 'evt-1', position: 1 },
      { id: 'evt-3', position: 2 }
    ]
  );
});

test('effective_until_at is capped by event end', () => {
  const now = new Date('2026-02-25T10:00:00Z');
  const result = computeEffectiveUntil({
    now,
    durationCode: '14d',
    eventStartAt: '2026-02-26T12:00:00Z',
    eventEndAt: '2026-03-01T12:00:00Z'
  });
  assert.equal(result.ok, true);
  assert.equal(result.effectiveUntil.toISOString(), '2026-03-01T12:00:00.000Z');
});

test('effective end uses start_at +1h when end_at is missing', () => {
  const now = new Date('2026-02-25T10:00:00Z');
  const result = computeEffectiveUntil({
    now,
    durationCode: 'until_event_end',
    eventStartAt: '2026-02-25T11:00:00Z',
    eventEndAt: null
  });
  assert.equal(result.ok, true);
  assert.equal(result.eventEffectiveEnd.toISOString(), '2026-02-25T12:00:00.000Z');
  assert.equal(result.effectiveUntil.toISOString(), '2026-02-25T12:00:00.000Z');
});
