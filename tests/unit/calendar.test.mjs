import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGoogleCalendarUrl, buildIcs } from '../../modules/calendar.mjs';

const ORIGIN = 'https://wod.example.test';

test('buildGoogleCalendarUrl includes base url, ctz and event link in details', () => {
  const event = {
    id: 'evt-100',
    title: 'Community Meetup',
    start: '2026-03-02T18:00:00+01:00',
    end: '2026-03-02T20:00:00+01:00',
    format: 'offline',
    address: 'Main St 10',
    city: 'Copenhagen',
    ticketUrl: 'https://tickets.example.com'
  };
  const eventUrl = `${ORIGIN}/event-card.html?id=evt-100`;
  const url = new URL(buildGoogleCalendarUrl(event, { eventUrl }));

  assert.equal(url.origin, 'https://calendar.google.com');
  assert.equal(url.searchParams.get('action'), 'TEMPLATE');
  assert.equal(url.searchParams.get('ctz'), 'Europe/Copenhagen');
  assert.ok(url.searchParams.get('dates')?.includes('/'));
  assert.equal(url.searchParams.get('text'), event.title);
  assert.match(url.searchParams.get('details') || '', /Event URL:/);
  assert.match(url.searchParams.get('details') || '', /wod\.example\.test/);
});

test('buildIcs outputs valid calendar event with DTSTART/DTEND/SUMMARY', () => {
  const event = {
    id: 'evt-200',
    title: 'Online Help Session',
    start: '2026-04-15T10:00:00+02:00',
    format: 'online',
    city: 'Copenhagen',
    ticketUrl: 'https://meet.example.com'
  };
  const ics = buildIcs(event, { eventUrl: `${ORIGIN}/event-card.html?id=evt-200` });

  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /SUMMARY:Online Help Session/);
  assert.match(ics, /DTSTART;TZID=Europe\/Copenhagen:/);
  assert.match(ics, /DTEND;TZID=Europe\/Copenhagen:/);
  assert.match(ics, /LOCATION:Online/);
  assert.match(ics, /END:VEVENT/);
  assert.match(ics, /END:VCALENDAR/);
});
