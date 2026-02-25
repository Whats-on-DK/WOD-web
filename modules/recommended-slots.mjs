export const MAX_RECOMMENDED_SLOTS = 6;

const toDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const getEventEffectiveEnd = (startAt, endAt) => {
  const start = toDate(startAt);
  if (!start) return null;
  const end = toDate(endAt);
  if (end) return end;
  return new Date(start.getTime() + 60 * 60 * 1000);
};

export const computeEffectiveUntil = ({
  now = new Date(),
  durationCode = '3d',
  eventStartAt,
  eventEndAt
} = {}) => {
  const current = toDate(now) || new Date();
  const eventEffectiveEnd = getEventEffectiveEnd(eventStartAt, eventEndAt);
  if (!eventEffectiveEnd) {
    return { ok: false, error: 'missing_event_start' };
  }

  let chosenUntil = null;
  if (durationCode === 'until_event_end') {
    chosenUntil = eventEffectiveEnd;
  } else if (durationCode === '3d' || durationCode === '7d' || durationCode === '14d') {
    const days = Number(durationCode.replace('d', ''));
    chosenUntil = new Date(current.getTime() + days * 24 * 60 * 60 * 1000);
  } else {
    return { ok: false, error: 'invalid_duration' };
  }

  const effectiveUntil = new Date(
    Math.min(chosenUntil.getTime(), eventEffectiveEnd.getTime())
  );

  if (effectiveUntil <= current) {
    return { ok: false, error: 'event_already_ended' };
  }

  return {
    ok: true,
    chosenUntil,
    effectiveUntil,
    eventEffectiveEnd
  };
};

export const closeRecommendedGaps = (items = []) =>
  [...items]
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
    .map((item, index) => ({ ...item, position: index + 1 }));

export const insertRecommendedAtPosition = (
  currentItems = [],
  newItem,
  position,
  maxSlots = MAX_RECOMMENDED_SLOTS
) => {
  const normalized = closeRecommendedGaps(currentItems).filter(Boolean);
  const existingIndex = normalized.findIndex((item) => item.id === newItem?.id);
  if (existingIndex >= 0) {
    normalized.splice(existingIndex, 1);
  }

  if (normalized.length >= maxSlots) {
    return { ok: false, error: 'max_slots_reached', items: normalized };
  }

  const target = Math.max(1, Math.min(Number(position || 1), normalized.length + 1));
  const next = [...normalized];
  next.splice(target - 1, 0, { ...newItem, position: target });

  return {
    ok: true,
    items: closeRecommendedGaps(next)
  };
};

export const removeRecommendedItem = (items = [], eventId = '') => {
  const next = closeRecommendedGaps(items).filter((item) => item.id !== eventId);
  return closeRecommendedGaps(next);
};
