export const defaultNormalize = (value) => String(value || '').toLowerCase();
export const defaultNormalizeCity = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
const COPENHAGEN_TIME_ZONE = 'Europe/Copenhagen';
const ONLINE_PATTERN = /zoom|google meet|meet\.google|teams\.microsoft|teams|online|webinar/i;
const NEW_EVENTS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const COPENHAGEN_DATE_PARTS_FORMATTER = new Intl.DateTimeFormat('sv-SE', {
  timeZone: COPENHAGEN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

const COPENHAGEN_WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: COPENHAGEN_TIME_ZONE,
  weekday: 'short'
});

const WEEKDAY_TO_INDEX = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 7
};

const getCopenhagenDateParts = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const map = Object.fromEntries(
    COPENHAGEN_DATE_PARTS_FORMATTER
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second
  };
};

const getCopenhagenOffsetMs = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  const parts = getCopenhagenDateParts(date);
  if (!parts) return 0;
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0
  );
  return asUtc - date.getTime();
};

const buildCopenhagenDate = (year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) => {
  let timestamp = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  for (let index = 0; index < 3; index += 1) {
    const offset = getCopenhagenOffsetMs(timestamp);
    const next = Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - offset;
    if (Math.abs(next - timestamp) < 1) {
      timestamp = next;
      break;
    }
    timestamp = next;
  }
  return new Date(timestamp);
};

const addCalendarDays = (year, month, day, diffDays) => {
  const utcDate = new Date(Date.UTC(year, month - 1, day + diffDays, 12, 0, 0, 0));
  return {
    year: utcDate.getUTCFullYear(),
    month: utcDate.getUTCMonth() + 1,
    day: utcDate.getUTCDate()
  };
};

const getCopenhagenWeekday = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 1;
  const label = COPENHAGEN_WEEKDAY_FORMATTER.format(date).slice(0, 3).toLowerCase();
  return WEEKDAY_TO_INDEX[label] || 1;
};

const isOnlineEvent = (event, normalize = defaultNormalize) => {
  const formatValue = normalize(event?.format);
  if (formatValue.includes('online')) return true;
  const locationText = [event?.address, event?.venue].filter(Boolean).join(' ');
  return ONLINE_PATTERN.test(String(locationText || ''));
};

export const buildFilters = (formData, searchQuery, helpers = {}) => {
  const normalize = helpers.normalize || defaultNormalize;
  const normalizeCity = helpers.normalizeCity || normalize;
  const getValue = (key) => (formData && typeof formData.get === 'function' ? formData.get(key) : '');
  const getAll = (key) => (formData && typeof formData.getAll === 'function' ? formData.getAll(key) : []);

  return {
    dateFrom: getValue('date-from') || '',
    dateTo: getValue('date-to') || '',
    city: normalizeCity(getValue('city')),
    price: normalize(getValue('price')),
    format: normalize(getValue('format')),
    quickToday: Boolean(getValue('quick-today')),
    quickWeekend: Boolean(getValue('quick-weekend')),
    quickNew: Boolean(getValue('quick-new')),
    quickFavorites: Boolean(getValue('quick-favorites')),
    showPast: Boolean(getValue('show-past')),
    tags: getAll('tags').map((tag) => normalize(tag)).filter(Boolean),
    searchQuery: normalize(searchQuery || '')
  };
};

export const eventMatchesFilters = (event, filters, helpers = {}, options = {}) => {
  const normalize = helpers.normalize || defaultNormalize;
  const isPast = helpers.isPast || (() => false);
  const isArchivedEvent = helpers.isArchivedEvent || (() => false);
  const normalizeCity = helpers.normalizeCity || defaultNormalizeCity;
  const getTagList = helpers.getTagList || ((tags) => (tags || []).map((label) => ({ label })));
  const getLocalizedEventTitle = helpers.getLocalizedEventTitle || ((data) => data?.title || '');
  const getLocalizedCity = helpers.getLocalizedCity || ((value) => value || '');
  const getLocalizedTag = helpers.getLocalizedTag || ((value) => value || '');
  const getLang = helpers.getLang || (() => 'uk');
  const isSaved = helpers.isSaved || (() => false);

  const ignorePastToggle = options.ignorePastToggle;
  if (isArchivedEvent(event)) return false;
  if (event.status !== 'published') return false;
  if (!filters) return true;

  if (!ignorePastToggle) {
    if (filters.showPast) {
      if (!isPast(event)) return false;
    } else if (isPast(event)) {
      return false;
    }
  } else if (isPast(event)) {
    return false;
  }

  const startDate = new Date(event.start);
  if (filters.dateFrom) {
    const from = new Date(filters.dateFrom);
    if (startDate < from) return false;
  }
  if (filters.dateTo) {
    const to = new Date(filters.dateTo);
    to.setHours(23, 59, 59, 999);
    if (startDate > to) return false;
  }
  if (filters.quickToday) {
    const today = new Date();
    if (
      startDate.getFullYear() !== today.getFullYear() ||
      startDate.getMonth() !== today.getMonth() ||
      startDate.getDate() !== today.getDate()
    ) {
      return false;
    }
  }
  if (filters.quickWeekend) {
    const day = startDate.getDay();
    if (day !== 0 && day !== 6) {
      return false;
    }
  }
  if (filters.quickNew) {
    const createdRaw = event?.createdAt || event?.created_at;
    const createdAt = createdRaw ? new Date(createdRaw) : null;
    const now = options.now instanceof Date ? options.now : new Date();
    if (!(createdAt instanceof Date) || Number.isNaN(createdAt.getTime())) {
      return false;
    }
    const ageMs = now.getTime() - createdAt.getTime();
    if (ageMs < 0 || ageMs > NEW_EVENTS_WINDOW_MS) {
      return false;
    }
  }
  if (filters.quickFavorites && !isSaved(event?.id)) {
    return false;
  }
  if (filters.city) {
    if (isOnlineEvent(event, normalize)) return false;
    if (normalizeCity(event.city) !== filters.city) return false;
  }
  if (filters.price && normalize(event.priceType) !== filters.price) return false;
  if (filters.format && normalize(event.format) !== filters.format) return false;
  if (filters.tags && filters.tags.length) {
    const eventTags = getTagList(event.tags).map((tag) => normalize(tag.label));
    const hasAnyTag = filters.tags.some((tag) => tag && eventTags.includes(tag));
    if (!hasAnyTag) return false;
  }
  if (filters.searchQuery) {
    const lang = getLang();
    const localizedTitle = getLocalizedEventTitle(event, lang);
    const localizedCity = getLocalizedCity(event.city, lang);
    const localizedTags = getTagList(event.tags).map((tag) => getLocalizedTag(tag.label, lang));
    const haystack = [
      localizedTitle,
      event.description,
      localizedCity,
      event.venue,
      localizedTags.join(' ')
    ]
      .map(normalize)
      .join(' ');
    if (!haystack.includes(filters.searchQuery)) return false;
  }
  return true;
};

export const filterSavedEvents = (events, savedIds = new Set()) => {
  const set = savedIds instanceof Set ? savedIds : new Set(savedIds || []);
  return (events || []).filter((event) => event?.id && set.has(String(event.id)));
};

export const filterEvents = (events, filters, helpers = {}, options = {}) =>
  (events || []).filter((event) => eventMatchesFilters(event, filters, helpers, options));

export const getAvailableTags = (events, helpers = {}) => {
  const normalize = helpers.normalize || defaultNormalize;
  const getTagList = helpers.getTagList || ((tags) => (tags || []).map((label) => ({ label })));
  const getLocalizedTag = helpers.getLocalizedTag || ((value) => value || '');
  const getLang = helpers.getLang || (() => 'uk');
  const tagMap = new Map();
  (events || []).forEach((event) => {
    getTagList(event?.tags).forEach((tag) => {
      const label = tag?.label ? String(tag.label).trim() : '';
      if (!label) return;
      const normalized = normalize(label);
      if (!normalized || tagMap.has(normalized)) return;
      tagMap.set(normalized, {
        label: getLocalizedTag(label, getLang()),
        value: label
      });
    });
  });
  const locale = getLang();
  return Array.from(tagMap.values()).sort((a, b) => a.label.localeCompare(b.label, locale));
};

export const buildCityOptions = (events, helpers = {}) => {
  const normalizeCity = helpers.normalizeCity || defaultNormalizeCity;
  const isArchivedEvent = helpers.isArchivedEvent || (() => false);
  const isPast = helpers.isPast || (() => false);
  const locale = helpers.getLang ? helpers.getLang() : 'da';
  const cityMap = new Map();
  (events || []).forEach((event) => {
    if (!event || event.status !== 'published') return;
    if (isArchivedEvent(event)) return;
    if (isPast(event)) return;
    if (isOnlineEvent(event)) return;
    const rawCity = String(event.city || '').trim();
    const normalized = normalizeCity(rawCity);
    if (!normalized) return;
    if (!cityMap.has(normalized)) {
      cityMap.set(normalized, rawCity);
    }
  });
  return Array.from(cityMap.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
};

export const matchCityFromQuery = (query, cityOptions = [], helpers = {}) => {
  const normalize = helpers.normalize || defaultNormalize;
  const normalizeCity = helpers.normalizeCity || defaultNormalizeCity;
  const tokens = String(query || '')
    .split(/[\s,]+/)
    .map((token) => normalize(token))
    .filter(Boolean);
  if (!tokens.length) return '';
  for (const option of cityOptions) {
    const rawLabel = option?.label || '';
    const rawValue = option?.value || '';
    const label = normalize(rawLabel);
    const value = normalizeCity(rawValue || rawLabel);
    if (tokens.includes(label) || tokens.includes(value)) {
      return rawValue || rawLabel;
    }
  }
  return '';
};

export const getWeekRange = (now = new Date()) => {
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime())) {
    return { start: new Date(0), end: new Date(0) };
  }
  const copenhagenParts = getCopenhagenDateParts(current);
  if (!copenhagenParts) {
    return { start: new Date(0), end: new Date(0) };
  }
  const weekday = getCopenhagenWeekday(current);
  const monday = addCalendarDays(
    copenhagenParts.year,
    copenhagenParts.month,
    copenhagenParts.day,
    -(weekday - 1)
  );
  const sunday = addCalendarDays(monday.year, monday.month, monday.day, 6);
  const start = buildCopenhagenDate(monday.year, monday.month, monday.day, 0, 0, 0, 0);
  const end = buildCopenhagenDate(sunday.year, sunday.month, sunday.day, 23, 59, 59, 0);
  return { start, end };
};

export const filterWeeklyEvents = (events, now = new Date(), helpers = {}) => {
  const isArchivedEvent = helpers.isArchivedEvent || (() => false);
  const isPast = helpers.isPast || (() => false);
  const start = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(start.getTime())) return [];
  const { end } = getWeekRange(start);
  return (events || []).filter((event) => {
    if (!event || event.status !== 'published') return false;
    if (isArchivedEvent(event)) return false;
    if (isPast(event)) return false;
    const startDate = new Date(event.start);
    if (Number.isNaN(startDate.getTime())) return false;
    return startDate >= start && startDate <= end;
  });
};
