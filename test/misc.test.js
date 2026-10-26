import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageType, shortsToWatch, redirectTarget, videoId } from '../extension/lib/routes.js';
import { normalizeHealth, healthKey, shouldCheck, recordCheck, isStale, staleFeatures, CHECK_INTERVAL_MS, STALE_MISSES, STALE_SPAN_MS } from '../extension/lib/health.js';
import { dayKey, normalizeUsage, addUsage, shouldRemind, minutesOf } from '../extension/lib/usage.js';

const Y = 'https://www.youtube.com';

test('pageType', () => {
  const cases = {
    [`${Y}/`]: 'home',
    [`${Y}/?app=desktop`]: 'home',
    [`${Y}/watch?v=abc123def45`]: 'watch',
    [`${Y}/results?search_query=x`]: 'search',
    [`${Y}/shorts/abc123def45`]: 'shorts',
    [`${Y}/feed/subscriptions`]: 'subscriptions',
    [`${Y}/@SomeChannel`]: 'channel',
    [`${Y}/@SomeChannel/shorts`]: 'channel',
    [`${Y}/channel/UC123/videos`]: 'channel',
    [`${Y}/c/name`]: 'channel',
    [`${Y}/user/name`]: 'channel',
    [`${Y}/feed/history`]: 'other',
    [`${Y}/playlist?list=PL1`]: 'other',
    'http://127.0.0.1:8080/watch?v=x': 'watch',
    'not a url': 'other',
  };
  for (const [u, want] of Object.entries(cases)) assert.equal(pageType(u), want, u);
});

test('shortsToWatch', () => {
  assert.equal(shortsToWatch(`${Y}/shorts/QRn8XR3PMAI`), `${Y}/watch?v=QRn8XR3PMAI`);
  assert.equal(shortsToWatch(`${Y}/shorts/QRn8XR3PMAI/?feature=share`), `${Y}/watch?v=QRn8XR3PMAI`);
  assert.equal(shortsToWatch('http://127.0.0.1:5000/shorts/abc_DEF-12'), 'http://127.0.0.1:5000/watch?v=abc_DEF-12');
  for (const u of [`${Y}/shorts/`, `${Y}/shorts/a"b<c`, `${Y}/@x/shorts`, `${Y}/watch?v=x`, 'junk']) assert.equal(shortsToWatch(u), null, u);
});

test('redirectTarget respects the features', () => {
  const s = `${Y}/shorts/QRn8XR3PMAI`;
  assert.equal(redirectTarget(s, { shortsRedirect: true }), `${Y}/watch?v=QRn8XR3PMAI`);
  assert.equal(redirectTarget(s, { shortsRedirect: false, homeRedirect: true }), null);
  assert.equal(redirectTarget(`${Y}/`, { homeRedirect: true }), `${Y}/feed/subscriptions`);
  assert.equal(redirectTarget(`${Y}/`, { homeRedirect: false }), null);
  assert.equal(redirectTarget(`${Y}/feed/subscriptions`, { homeRedirect: true, shortsRedirect: true }), null, 'no loop');
  assert.equal(redirectTarget(`${Y}/watch?v=QRn8XR3PMAI`, { homeRedirect: true, shortsRedirect: true }), null);
});

test('videoId', () => {
  assert.equal(videoId(`${Y}/watch?v=abc&t=10`), 'abc');
  assert.equal(videoId(`${Y}/shorts/abc`), '');
  assert.equal(videoId('x'), '');
});

test('health: misses must repeat over time before a rule is called stale', () => {
  const key = healthKey('related', 'watch');
  assert.equal(key, 'related:watch');
  let h = normalizeHealth(undefined, 3);
  assert.deepEqual(h, { configVersion: 3, records: {} });
  const t0 = 1_000_000_000_000;
  assert.equal(shouldCheck(h, key, t0), true);
  h = recordCheck(h, key, true, t0);
  assert.equal(shouldCheck(h, key, t0 + 1000), false, 'throttled');
  let t = t0;
  for (let i = 1; i <= STALE_MISSES; i++) {
    t += CHECK_INTERVAL_MS;
    assert.equal(shouldCheck(h, key, t), true);
    h = recordCheck(h, key, false, t);
  }
  const rec = h.records[key];
  assert.equal(rec.misses, STALE_MISSES);
  assert.equal(rec.lastHit, t0);
  assert.equal(rec.firstMissAt, t0 + CHECK_INTERVAL_MS);
  // 5 misses within 50 minutes: not yet (span < 1 h)
  assert.equal(isStale(rec, t), false);
  assert.equal(isStale(rec, rec.firstMissAt + STALE_SPAN_MS), true);
  const later = rec.firstMissAt + STALE_SPAN_MS;
  assert.deepEqual(staleFeatures(h, { related: true }, later), ['related']);
  assert.deepEqual(staleFeatures(h, { related: false }, later), [], 'disabled features are not reported');
  // one hit resets
  h = recordCheck(h, key, true, later);
  assert.equal(h.records[key].misses, 0);
  assert.deepEqual(staleFeatures(h, { related: true }, later + 1), []);
});

test('health: a new config version starts fresh', () => {
  const h = recordCheck(normalizeHealth(null, 1), 'shorts:home', false, 5);
  assert.equal(Object.keys(normalizeHealth(h, 1).records).length, 1);
  assert.deepEqual(normalizeHealth(h, 2).records, {});
  assert.deepEqual(normalizeHealth({ configVersion: 1 }, 1).records, {});
  assert.equal(isStale(undefined, 1), false);
});

test('usage: per local day, capped ticks, one reminder a day', () => {
  const d1 = new Date(2026, 9, 26, 10, 0);
  const d2 = new Date(2026, 9, 27, 0, 1);
  assert.equal(dayKey(d1), '2026-10-26');
  assert.deepEqual(normalizeUsage(null, d1), { day: '2026-10-26', seconds: 0, remindedDay: '' });
  let u = addUsage(null, 30, d1);
  u = addUsage(u, 30, d1);
  assert.equal(u.seconds, 60);
  assert.equal(addUsage(u, 99999, d1).seconds, 180, 'a long sleep adds at most 2 minutes');
  assert.equal(addUsage(u, -50, d1).seconds, 60);
  assert.equal(addUsage(u, 30, d2).seconds, 30, 'new day resets');
  const rem = { enabled: true, minutes: 1 };
  assert.equal(shouldRemind(u, rem, d1), true);
  assert.equal(shouldRemind(u, { enabled: false, minutes: 1 }, d1), false);
  assert.equal(shouldRemind(u, { enabled: true, minutes: 2 }, d1), false);
  assert.equal(shouldRemind({ ...u, remindedDay: u.day }, rem, d1), false, 'once a day');
  assert.equal(shouldRemind(u, rem, d2), false, 'yesterday’s counter');
  assert.equal(minutesOf(119), 1);
  assert.equal(minutesOf(-5), 0);
});
