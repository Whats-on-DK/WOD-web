import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const readFile = (relativePath) =>
  fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('public-events uses published-only select queries', () => {
  const content = readFile('../../netlify/functions/public-events.ts');
  assert.match(content, /const statusQuery = 'eq\.published';/);
  assert.match(content, /const limit = parseLimit/);
  assert.match(content, /const page = parsePage/);
  assert.match(content, /limit:\s*String\(limit\)/);
  assert.match(content, /offset:\s*String\(offset\)/);
  assert.match(
    content,
    /select:\s*'id,external_id,slug,title,start_at,end_at,format,venue,address,city,price_type,price_min,price_max,registration_url,organizer_id,image_url,status,language'/
  );
  assert.match(
    content,
    /select:\s*'event_id,tag,is_pending'/
  );
  assert.match(
    content,
    /select:\s*'id,name,email,phone,website,instagram,facebook,meta'/
  );
  assert.doesNotMatch(content, /includeArchived/);
});

test('admin-update uses external_id lookup for non-uuid ids', () => {
  const content = readFile('../../netlify/functions/admin-update.ts');
  assert.match(content, /isUuid/);
  assert.match(content, /buildEventLookupQuery/);
  assert.match(content, /external_id\.eq/);
  assert.match(content, /id\.eq/);
});

test('update-event uses external_id lookup for non-uuid ids', () => {
  const content = readFile('../../netlify/functions/update-event.ts');
  assert.match(content, /isUuid/);
  assert.match(content, /buildEventLookupQuery/);
  assert.match(content, /external_id\.eq/);
  assert.match(content, /id\.eq/);
});

test('update-event clears organizer social fields when payload values are empty', () => {
  const content = readFile('../../netlify/functions/update-event.ts');
  assert.match(content, /organizerFieldMap/);
  assert.match(content, /contact-instagram/);
  assert.match(content, /contact-facebook/);
  assert.match(content, /value \|\| null/);
  assert.match(content, /supabaseFetch\('organizers'/);
});

test('admin-update enforces roles', () => {
  const content = readFile('../../netlify/functions/admin-update.ts');
  assert.match(content, /error:\s*'forbidden'/);
  assert.match(content, /statusCode:\s*403/);
});

test('submit-event validates required fields', () => {
  const content = readFile('../../netlify/functions/submit-event.ts');
  assert.match(content, /errors\.push\('title'\)/);
  assert.match(content, /errors\.push\('description'\)/);
  assert.match(content, /errors\.push\('start'\)/);
  assert.match(content, /errors\.push\('format'\)/);
  assert.match(content, /errors\.push\('address'\)/);
  assert.match(content, /errors\.push\('ticket-type'\)/);
  assert.match(content, /errors\.push\('contact-name'\)/);
  assert.match(content, /errors\.push\('tags'\)/);
  assert.match(content, /const isAdmin = hasAdminRole\(roles\);/);
  assert.match(content, /const status = isAdmin \? 'published' : 'pending';/);
  assert.doesNotMatch(content, /error:\s*'forbidden'/);
});

test('homepage hero CTA points to create-event page', () => {
  const content = readFile('../../index.html');
  assert.match(content, /href=\"\.\/new-event\.html\"/);
  assert.match(content, /data-i18n=\"cta_add_event\"/);
});

test('admin-event fetches by id or external_id and enforces admin access', () => {
  const content = readFile('../../netlify/functions/admin-event.ts');
  assert.match(content, /error:\s*'forbidden'/);
  assert.match(content, /buildEventLookupQuery/);
  assert.match(content, /external_id\.eq/);
  assert.match(
    content,
    /select:\s*'id,external_id,slug,title,description,start_at,end_at,format,venue,address,city,price_type,price_min,price_max,registration_url,organizer_id,image_url,status,language'/
  );
});

test('public-event fetches published event by id or external_id', () => {
  const content = readFile('../../netlify/functions/public-event.ts');
  assert.match(content, /status:\s*'eq\.published'/);
  assert.match(content, /buildEventLookupQuery/);
  assert.match(content, /external_id\.eq/);
  assert.match(
    content,
    /select:\s*'id,external_id,slug,title,description,start_at,end_at,format,venue,address,city,price_type,price_min,price_max,registration_url,organizer_id,image_url,status,language'/
  );
});

test('organizer verification uses supabase requests table', () => {
  const organizerVerify = readFile('../../netlify/functions/organizer-verification.ts');
  const adminVerify = readFile('../../netlify/functions/admin-verify.ts');
  const adminEvents = readFile('../../netlify/functions/admin-events.ts');
  assert.match(organizerVerify, /supabaseFetch\('organizer_verification_requests'/);
  assert.match(organizerVerify, /status:\s*'pending'/);
  assert.match(adminVerify, /supabaseFetch\('organizer_verification_requests'/);
  assert.match(adminVerify, /status:\s*'approved'/);
  assert.match(adminVerify, /status:\s*'rejected'/);
  assert.match(adminEvents, /supabaseFetch\('organizer_verification_requests'/);
  assert.match(adminEvents, /status:\s*'eq\.pending'/);
});

test('auto-archive runs weekly and archives past events', () => {
  const content = readFile('../../netlify/functions/auto-archive.ts');
  assert.match(content, /schedule:\s*'@weekly'/);
  assert.match(content, /end_at:\s*`lt\.\$\{cutoffEnd\}`/);
  assert.match(content, /status:\s*'eq\.published'/);
  assert.match(content, /end_at:\s*'is\.null'/);
  assert.match(content, /start_at:\s*`lt\.\$\{cutoffStart\}`/);
});

test('share-event redirects non-crawler requests to event page', () => {
  const content = readFile('../../netlify/functions/share-event.ts');
  assert.match(content, /isCrawlerRequest/);
  assert.match(content, /statusCode:\s*302/);
  assert.match(content, /Location:\s*eventUrl/);
  assert.match(content, /buildEventPageUrl/);
  assert.match(content, /key\.startsWith\('utm_'\)/);
});

test('share-event keeps OG HTML response for crawler requests', () => {
  const content = readFile('../../netlify/functions/share-event.ts');
  assert.match(content, /facebookexternalhit/i);
  assert.match(content, /instagram/i);
  assert.match(content, /linkedinbot/i);
  assert.match(content, /<meta property="og:title"/);
  assert.match(content, /<meta property="og:image"/);
  assert.match(content, /<meta property="og:url"/);
});

test('admin archive template has edit action for archived events', () => {
  const content = readFile('../../admin-page.html');
  assert.match(content, /data-action=\"edit-archive\"/);
});
