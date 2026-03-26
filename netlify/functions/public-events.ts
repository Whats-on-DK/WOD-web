import { supabaseFetch } from './supabase';

const mapTag = (tag: { tag: string; is_pending?: boolean }) => ({
  label: tag.tag,
  status: tag.is_pending ? 'pending' : 'approved'
});

const mapOrganizer = (organizer?: {
  name?: string;
  email?: string;
  phone?: string;
  website?: string;
  instagram?: string;
  facebook?: string;
  telegram?: string;
  meta?: string;
}) => {
  if (!organizer) return null;
  return {
    name: organizer.name || '',
    email: organizer.email || '',
    phone: organizer.phone || '',
    website: organizer.website || '',
    instagram: organizer.instagram || '',
    facebook: organizer.facebook || '',
    telegram: organizer.telegram || '',
    meta: organizer.meta || ''
  };
};

const sanitizeImageUrl = (value?: string) => {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:')) return '';
  if (trimmed.length > 2048) return '';
  return trimmed;
};

type HandlerEvent = { queryStringParameters?: Record<string, string> };
type HandlerContext = { clientContext?: { user?: { app_metadata?: { roles?: string[] } } } };

const parseLimit = (value?: string) => {
  const numeric = Number.parseInt(value || '', 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return 25;
  return Math.min(numeric, 50);
};

const parsePage = (value?: string) => {
  const numeric = Number.parseInt(value || '', 10);
  if (!Number.isFinite(numeric) || numeric <= 0) return 1;
  return numeric;
};

export const handler = async (event: HandlerEvent, _context: HandlerContext) => {
  try {
    const limit = parseLimit(event.queryStringParameters?.limit);
    const page = parsePage(event.queryStringParameters?.page);
    const offset = (page - 1) * limit;
    const statusQuery = 'eq.published';
    const events = (await supabaseFetch('events', {
      query: {
        status: statusQuery,
        order: 'start_at.asc',
        limit: String(limit),
        offset: String(offset),
        select:
          'id,external_id,slug,title,start_at,end_at,format,venue,address,city,price_type,price_min,price_max,registration_url,organizer_id,image_url,status,language,created_at'
      }
    })) as any[];
    const eventIds = events.map((event) => event.id).filter(Boolean);
    const organizerIds = events
      .map((event) => event.organizer_id)
      .filter(Boolean);
    const tags =
      eventIds.length > 0
        ? ((await supabaseFetch('event_tags', {
            query: {
              event_id: `in.(${eventIds.join(',')})`,
              select: 'event_id,tag,is_pending'
            }
          })) as any[])
        : [];
    const organizers =
      organizerIds.length > 0
        ? ((await supabaseFetch('organizers', {
            query: {
              id: `in.(${organizerIds.join(',')})`,
              select: 'id,name,email,phone,website,instagram,facebook,meta'
            }
          })) as any[])
        : [];

    const tagsByEvent = new Map<string, any[]>();
    tags.forEach((tag) => {
      const list = tagsByEvent.get(tag.event_id) || [];
      list.push(tag);
      tagsByEvent.set(tag.event_id, list);
    });
    const organizersById = new Map(
      organizers.map((organizer) => [organizer.id, organizer])
    );

    const response = events.map((event) => {
      const eventTags = tagsByEvent.get(event.id) || [];
      const organizer = organizersById.get(event.organizer_id);
      const contactPerson = mapOrganizer(organizer);
      const imageUrl = sanitizeImageUrl(event.image_url);
      return {
        id: event.external_id || event.id,
        slug: event.slug || event.external_id || event.id,
        title: event.title || 'Untitled event',
        description: '',
        tags: eventTags.map(mapTag),
        start: event.start_at || '',
        end: event.end_at || null,
        format: event.format || 'offline',
        venue: event.venue || event.address || '',
        address: event.address || '',
        city: event.city || '',
        priceType: event.price_type || 'paid',
        priceMin: event.price_min ?? null,
        priceMax: event.price_max ?? null,
        ticketUrl: event.registration_url || '',
        organizerId: event.organizer_id || '',
        images: imageUrl ? [imageUrl] : [],
        status: event.status || 'published',
        language: event.language || '',
        createdAt: event.created_at || '',
        forUkrainians: true,
        familyFriendly: false,
        volunteer: false,
        contactPerson: contactPerson || {
          name: '',
          email: '',
          phone: '',
          website: '',
          instagram: '',
          facebook: '',
          telegram: '',
          meta: ''
        }
      };
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };
  } catch (error) {
    console.log('public-events error', error);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([])
    };
  }
};
