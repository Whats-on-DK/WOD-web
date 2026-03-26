import { supabaseFetch } from './supabase';

type HandlerEvent = {
  queryStringParameters?: Record<string, string>;
  headers?: Record<string, string>;
};

const DEFAULT_IMAGE_PATH = '/static/og-placeholder-white.png';

const normalizeOrigin = (value: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return '';
  }
};

const getConfiguredOrigin = () =>
  normalizeOrigin(
    process.env.URL ||
      process.env.DEPLOY_PRIME_URL ||
      process.env.DEPLOY_URL ||
      process.env.SITE_URL ||
      ''
  );

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const escapeHtml = (value: string) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const buildOrigin = (event: HandlerEvent) => {
  const proto = event.headers?.['x-forwarded-proto'] || 'https';
  const host = event.headers?.host || process.env.URL?.replace(/^https?:\/\//, '');
  if (!host) return getConfiguredOrigin() || 'http://localhost:8888';
  return `${proto}://${host}`;
};

const buildShareUrl = (event: HandlerEvent, origin: string) => {
  const params = new URLSearchParams();
  const query = event.queryStringParameters || {};
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).length > 0) {
      params.set(key, String(value));
    }
  });
  const qs = params.toString();
  return `${origin}/.netlify/functions/share-event${qs ? `?${qs}` : ''}`;
};

const SHARE_BOT_UA_PATTERNS = [
  /facebookexternalhit/i,
  /facebot/i,
  /meta-externalagent/i,
  /meta-inspector/i,
  /linkedinbot/i,
  /twitterbot/i,
  /telegrambot/i,
  /whatsapp/i,
  /instagram/i,
  /slackbot/i,
  /discordbot/i,
  /skypeuripreview/i,
  /pinterest/i,
  /vkshare/i
];

const isCrawlerRequest = (event: HandlerEvent) => {
  const userAgent = String(event.headers?.['user-agent'] || '').trim();
  if (!userAgent) return false;
  return SHARE_BOT_UA_PATTERNS.some((pattern) => pattern.test(userAgent));
};

const buildEventPageUrl = (event: HandlerEvent, origin: string, id: string) => {
  const params = new URLSearchParams();
  if (id) {
    params.set('id', id);
  }
  const query = event.queryStringParameters || {};
  Object.entries(query).forEach(([key, value]) => {
    if (!value || key === 'id') return;
    if (key.startsWith('utm_') || key === 'fbclid') {
      params.set(key, String(value));
    }
  });
  const qs = params.toString();
  return `${origin}/event-card.html${qs ? `?${qs}` : ''}`;
};

const fetchPublishedEvent = async (id: string) => {
  const query: Record<string, string> = {
    status: 'eq.published',
    select: 'id,external_id,title,description,city,image_url,start_at,end_at',
    limit: '1'
  };
  if (isUuid(id)) {
    query.id = `eq.${id}`;
  } else {
    query.external_id = `eq.${id}`;
  }
  const rows = (await supabaseFetch('events', { query })) as any[];
  return Array.isArray(rows) && rows.length ? rows[0] : null;
};

const toAbsoluteImageUrl = (image: string, origin: string) => {
  const value = String(image || '').trim();
  if (!value || value.startsWith('data:')) return `${origin}${DEFAULT_IMAGE_PATH}`;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${origin}${value}`;
  return `${origin}/${value.replace(/^\.?\//, '')}`;
};

export const handler = async (event: HandlerEvent) => {
  const id = String(event.queryStringParameters?.id || '').trim();
  const fallbackTitle = String(event.queryStringParameters?.t || '').trim();
  const fallbackDescription = String(event.queryStringParameters?.d || '').trim();
  const fallbackImage = String(event.queryStringParameters?.i || '').trim();
  const origin = buildOrigin(event);
  const shareUrl = buildShareUrl(event, origin);
  const eventUrl = buildEventPageUrl(event, origin, id);

  if (!isCrawlerRequest(event)) {
    return {
      statusCode: 302,
      headers: {
        Location: eventUrl,
        'Cache-Control': 'no-store'
      },
      body: ''
    };
  }

  try {
    let row: any = null;
    if (id) {
      row = await fetchPublishedEvent(id);
    }

    const rawTitle = String(row?.title || fallbackTitle || 'Подія').trim();
    const title = `${rawTitle} — What’s on DK`;
    const description =
      String(row?.description || fallbackDescription || '').trim() || 'Деталі події в Данії.';
    const image = toAbsoluteImageUrl(
      String(row?.images?.[0] || row?.image_url || fallbackImage || '').trim() || DEFAULT_IMAGE_PATH,
      origin
    );

    const html = `<!doctype html>
<html lang="uk">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(image)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:url" content="${escapeHtml(eventUrl)}" />
    <meta property="og:locale" content="uk_UA" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />
    <link rel="canonical" href="${escapeHtml(shareUrl)}" />
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(description)}</p>
      <p><a href="${escapeHtml(eventUrl)}">Відкрити подію</a></p>
    </main>
  </body>
</html>`;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      body: html
    };
  } catch (error) {
    const html = `<!doctype html>
<html lang="uk">
  <head>
    <meta charset="utf-8" />
    <title>Подія — What’s on DK</title>
    <meta property="og:title" content="Подія — What’s on DK" />
    <meta property="og:description" content="Деталі події в Данії." />
    <meta property="og:type" content="website" />
    <meta property="og:image" content="${escapeHtml(`${origin}${DEFAULT_IMAGE_PATH}`)}" />
    <meta property="og:url" content="${escapeHtml(eventUrl)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Подія — What’s on DK" />
    <meta name="twitter:description" content="Деталі події в Данії." />
    <meta name="twitter:image" content="${escapeHtml(`${origin}${DEFAULT_IMAGE_PATH}`)}" />
    <link rel="canonical" href="${escapeHtml(shareUrl)}" />
  </head>
  <body></body>
</html>`;
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      body: html
    };
  }
};
