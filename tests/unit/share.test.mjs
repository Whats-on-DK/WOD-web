import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShareText, getNetworkShareHref, getShareUrl } from '../../modules/share.mjs';

const ORIGIN = 'https://wod.example.test';

test('getShareUrl supports all channels with stable base and UTM', () => {
  const channels = [
    'instagram',
    'facebook',
    'messenger',
    'linkedin',
    'telegram',
    'whatsapp',
    'copy',
    'other'
  ];
  channels.forEach((channel) => {
    const base = `${ORIGIN}/event-card.html?id=evt-1&ref=a b`;
    const url = new URL(getShareUrl({ id: 'evt-1' }, channel, base));

    assert.equal(url.origin, ORIGIN);
    assert.equal(url.pathname, '/event-card.html');
    assert.equal(url.searchParams.get('id'), 'evt-1');
    assert.equal(url.searchParams.get('ref'), 'a b');
    assert.equal(url.searchParams.get('utm_source'), 'share');
    assert.equal(url.searchParams.get('utm_medium'), 'web');
    assert.equal(url.searchParams.get('utm_campaign'), 'event');
    assert.equal(url.searchParams.get('utm_content'), channel);
    assert.match(url.toString(), /^https:\/\/wod\.example\.test\/event-card\.html\?/);
  });
});

test('buildShareText returns compact title/date/city without link by default', () => {
  const event = {
    title: 'Community Meetup',
    start: '2026-03-10T18:00:00+01:00',
    city: 'Copenhagen'
  };
  const text = buildShareText(event);

  assert.match(text, /Community Meetup/);
  assert.match(text, /Copenhagen/);
  assert.doesNotMatch(text, /https?:\/\//);
});

test('buildShareText can include link when explicitly requested', () => {
  const event = {
    title: 'Community Meetup',
    start: '2026-03-10T18:00:00+01:00',
    city: 'Copenhagen'
  };
  const link = `${ORIGIN}/event-card.html?id=evt-1&utm_content=native`;
  const text = buildShareText(event, { shareUrl: link, includeUrl: true });

  assert.match(text, /https:\/\/wod\.example\.test\/event-card\.html/);
});

test('facebook share href uses sharer.php with encoded share url', () => {
  const shareUrl = `${ORIGIN}/.netlify/functions/share-event?id=evt-1&utm_content=facebook`;
  const href = getNetworkShareHref('facebook', shareUrl, '');
  assert.match(href, /^https:\/\/www\.facebook\.com\/sharer\/sharer\.php\?u=/);
  assert.match(href, /https%3A%2F%2Fwod\.example\.test%2F\.netlify%2Ffunctions%2Fshare-event/);
  assert.match(href, /utm_content%3Dfacebook/);
});

test('messenger share href uses stable messages url', () => {
  const shareUrl = `${ORIGIN}/.netlify/functions/share-event?id=evt-1&utm_content=messenger`;
  const href = getNetworkShareHref('messenger', shareUrl, '');
  assert.equal(href, 'https://www.facebook.com/messages/t/');
});
