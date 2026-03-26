import { supabaseFetch } from './supabase';
import { uploadEventImage } from './storage';

type HandlerEvent = { body?: string; headers?: Record<string, string> };
type HandlerContext = { clientContext?: { user?: { app_metadata?: { roles?: string[] } } } };

const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 5;
const WINDOW_MS = 60_000;

const getClientIp = (headers: Record<string, string> = {}) => {
  return (
    headers['x-nf-client-connection-ip'] ||
    headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    headers['client-ip'] ||
    'unknown'
  );
};

const isRateLimited = (ip: string) => {
  const now = Date.now();
  const entry = rateLimits.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  if (entry.count >= RATE_LIMIT) {
    return true;
  }
  entry.count += 1;
  return false;
};

const isNonEmptyString = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0;

const isValidEmail = (value: unknown) =>
  typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const isValidPhone = (value: unknown) =>
  typeof value === 'string' && /^\+?\d[\d\s()-]{5,}$/.test(value);

const isValidDate = (value: unknown) => {
  if (!isNonEmptyString(value)) return false;
  const date = new Date(String(value));
  return !Number.isNaN(date.valueOf());
};

const parseTags = (value: unknown) => {
  if (!isNonEmptyString(value)) return [];
  return String(value)
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
};

const getRoles = (context: HandlerContext) => {
  const roles = context.clientContext?.user?.app_metadata?.roles;
  return Array.isArray(roles) ? roles : [];
};

const hasAdminRole = (roles: string[]) => roles.includes('admin') || roles.includes('super_admin');

const parsePriceInput = (value: unknown) => {
  const raw = String(value ?? '').trim().replace(/,/g, '.');
  if (!raw) return { min: null, max: null, hasValue: false };
  const matches = raw.match(/\d+(?:\.\d+)?/g) || [];
  const numbers = matches.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (!numbers.length) return { min: null, max: null, hasValue: true };
  if (numbers.length === 1) return { min: numbers[0], max: null, hasValue: true };
  const min = numbers[0];
  const max = numbers[1];
  if (Number.isFinite(min) && Number.isFinite(max) && max < min) {
    return { min: max, max: min, hasValue: true };
  }
  return { min, max, hasValue: true };
};

export const handler = async (event: HandlerEvent, context: HandlerContext) => {
  try {
    const payload = event.body ? JSON.parse(event.body) : {};
    const ip = getClientIp(event.headers || {});
    if (isRateLimited(ip)) {
      return {
        statusCode: 429,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'rate_limited' })
      };
    }
    if (payload.website && String(payload.website).trim()) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'honeypot' })
      };
    }
    const errors: string[] = [];
    if (!isNonEmptyString(payload.title)) errors.push('title');
    const description = String(payload.description || '').trim();
    if (!isNonEmptyString(description)) errors.push('description');
    if (!isValidDate(payload.start)) errors.push('start');
    const format = String(payload.format || '');
    if (!['offline', 'online'].includes(format)) errors.push('format');
    if (!isNonEmptyString(payload.address)) errors.push('address');
    if (format !== 'online' && !isNonEmptyString(payload.city)) errors.push('city');
    if (!['free', 'paid'].includes(String(payload['ticket-type'] || ''))) errors.push('ticket-type');
    if (!isNonEmptyString(payload['contact-name'])) errors.push('contact-name');
    if (payload['contact-email'] && !isValidEmail(payload['contact-email'])) {
      errors.push('contact-email');
    }
    if (payload['contact-phone'] && !isValidPhone(payload['contact-phone'])) {
      errors.push('contact-phone');
    }
    const tags = parseTags(payload.tags);
    if (tags.length === 0) errors.push('tags');

    if (errors.length) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, error: 'invalid_payload', fields: errors })
      };
    }

    const roles = getRoles(context);
    const isAdmin = hasAdminRole(roles);

    const id = `evt-${Date.now()}`;
    const title = payload.title || payload.name || payload.eventTitle || 'Untitled event';
    const status = isAdmin ? 'published' : 'pending';
    const contactName = String(payload['contact-name'] || '');
    const contactEmail = String(payload['contact-email'] || '');
    const contactPhone = String(payload['contact-phone'] || '');
    const contactWebsite = String(payload['contact-website'] || '');
    const contactInstagram = String(payload['contact-instagram'] || '');
    const contactFacebook = String(payload['contact-facebook'] || '');
    const contactMeta = String(payload['contact-meta'] || '');
    let organizerId: string | null = null;
    if (contactName || contactEmail || contactPhone || contactWebsite || contactInstagram || contactFacebook) {
      const organizer = (await supabaseFetch('organizers', {
        method: 'POST',
        body: [
          {
            name: contactName || 'Організатор',
            email: contactEmail || null,
            phone: contactPhone || null,
            website: contactWebsite || null,
            instagram: contactInstagram || null,
            facebook: contactFacebook || null,
            meta: contactMeta || null
          }
        ]
      })) as any[];
      organizerId = organizer?.[0]?.id || null;
    }
    const priceMin = payload['price-min'] ? Number(payload['price-min']) : null;
    const priceMax = payload['price-max'] ? Number(payload['price-max']) : null;
    const parsedPrice = parsePriceInput(payload.price);
    const resolvedMin = Number.isFinite(priceMin) ? priceMin : parsedPrice.min;
    const resolvedMax = Number.isFinite(priceMax) ? priceMax : parsedPrice.max;
    let imageUrl = payload.imageUrl || payload.image_url || null;
    if (typeof imageUrl === 'string' && imageUrl.trim().startsWith('data:')) {
      const upload = await uploadEventImage(imageUrl.trim(), `events/${id}-${Date.now()}`);
      imageUrl = upload?.url || null;
    }
    const eventRow = (await supabaseFetch('events', {
      method: 'POST',
      body: [
        {
          external_id: id,
          slug: payload.slug || id,
          title,
          description,
          city: format === 'online' ? (payload.city || '') : payload.city || payload.eventCity || '',
          address: payload.address || '',
          venue: payload.venue || payload.address || '',
          start_at: payload.start || payload.eventStart || null,
          end_at: payload.end || payload.eventEnd || null,
          language: payload.language || '',
          format: payload.format || '',
          price_type: payload['ticket-type'] || '',
          price_min: Number.isFinite(resolvedMin) ? resolvedMin : null,
          price_max: Number.isFinite(resolvedMax) ? resolvedMax : null,
          registration_url: payload['ticket-url'] || '',
          image_url: imageUrl,
          status,
          organizer_id: organizerId
        }
      ]
    })) as any[];
    const savedEvent = eventRow?.[0];
    if (savedEvent?.id && tags.length) {
      await supabaseFetch('event_tags', {
        method: 'POST',
        body: tags.map((tag) => ({
          event_id: savedEvent.id,
          tag,
          is_pending: false
        }))
      });
    }
    if (savedEvent?.id) {
      await supabaseFetch('admin_audit_log', {
        method: 'POST',
        body: [
          {
            event_id: savedEvent.id,
            action: isAdmin ? 'publish' : 'submit',
            actor: context.clientContext?.user?.email || 'guest',
            payload: { title }
          }
        ]
      });
    }
    console.log('submit-event', { id, title, status });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, id })
    };
  } catch (error) {
    console.log('submit-event error', error);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false })
    };
  }
};
