import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FEATURES,
  PRESETS,
  PRESET_IDS,
  PERSONAL,
  defaultSettings,
  normalizeSettings,
  applyPreset,
  matchPreset,
  parseTime,
  inSchedule,
  nextScheduleChange,
  effectiveFeatures,
  withSetting,
} from '../extension/lib/settings.js';

/** Local date helper: 2026-10-26 is a Monday. */
const at = (day, hh, mm = 0) => new Date(2026, 9, 26 + ((day - 1 + 7) % 7), hh, mm);

test('defaults: focus preset, comments and chat visible, extras off', () => {
  const d = defaultSettings();
  assert.equal(d.enabled, true);
  assert.equal(matchPreset(d.features), 'focus');
  assert.equal(d.features.comments, false);
  assert.equal(d.features.liveChat, false);
  assert.equal(d.features.homeRedirect, false);
  assert.equal(d.schedule.enabled, false);
  assert.equal(d.reminder.enabled, false);
  assert.equal(d.remoteEnabled, false, 'network rule updates are opt-in');
  assert.deepEqual(Object.keys(d.features), [...FEATURES]);
});

test('normalizeSettings repairs garbage and keeps valid values', () => {
  assert.deepEqual(normalizeSettings(null), defaultSettings());
  assert.deepEqual(normalizeSettings('x'), defaultSettings());
  const s = normalizeSettings({
    enabled: false,
    features: { shorts: false, comments: true, bogus: true, related: 'yes' },
    schedule: { enabled: true, days: [5, 1, 1, 9, -1, 2.5], from: '25:00', to: '07:30' },
    reminder: { enabled: true, minutes: 2 },
    remoteEnabled: 1,
  });
  assert.equal(s.enabled, false);
  assert.equal(s.features.shorts, false);
  assert.equal(s.features.comments, true);
  assert.equal(s.features.related, true, 'non-boolean falls back to default');
  assert.equal(/** @type {any} */ (s.features).bogus, undefined);
  assert.deepEqual(s.schedule.days, [1, 5]);
  assert.equal(s.schedule.from, '09:00');
  assert.equal(s.schedule.to, '07:30');
  assert.equal(s.reminder.minutes, 60, 'below 5 minutes is rejected');
  assert.equal(s.remoteEnabled, false);
  assert.deepEqual(normalizeSettings({ schedule: { days: [] } }).schedule.days, []);
});

test('presets: every preset is distinct and leaves personal toggles alone', () => {
  const seen = new Set();
  for (const id of PRESET_IDS) {
    const p = PRESETS[id];
    for (const f of PERSONAL) assert.equal(/** @type {any} */ (p)[f], undefined, `${id} must not touch ${f}`);
    assert.deepEqual(Object.keys(p).sort(), FEATURES.filter((f) => !PERSONAL.includes(f)).sort());
    seen.add(JSON.stringify(p));
  }
  assert.equal(seen.size, PRESET_IDS.length);
  assert.equal(PRESETS.minimal.homeFeed, false);
  assert.equal(PRESETS.minimal.shorts, true);
  assert.equal(PRESETS.subscriptions.homeRedirect, true);
  assert.equal(PRESETS.focus.homeRedirect, false);
});

test('applyPreset / matchPreset round trip; personal toggles survive', () => {
  let s = withSetting(defaultSettings(), 'features.comments', true);
  for (const id of PRESET_IDS) {
    s = applyPreset(s, id);
    assert.equal(matchPreset(s.features), id);
    assert.equal(s.features.comments, true);
  }
  s = withSetting(s, 'features.related', false);
  assert.equal(matchPreset(s.features), null, 'custom');
  assert.equal(applyPreset(s, /** @type {any} */ ('nope')), s);
});

test('parseTime', () => {
  assert.equal(parseTime('00:00'), 0);
  assert.equal(parseTime('09:30'), 570);
  assert.equal(parseTime('23:59'), 1439);
  for (const bad of ['24:00', '9:30', '12:60', '', null, 900]) assert.equal(parseTime(bad), null, String(bad));
});

test('inSchedule: same-day window, weekdays only', () => {
  const sch = { enabled: true, days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' };
  assert.equal(inSchedule(sch, at(1, 9, 0)), true);
  assert.equal(inSchedule(sch, at(1, 17, 59)), true);
  assert.equal(inSchedule(sch, at(1, 18, 0)), false, 'end is exclusive');
  assert.equal(inSchedule(sch, at(1, 8, 59)), false);
  assert.equal(inSchedule(sch, at(6, 12)), false, 'Saturday');
  assert.equal(inSchedule({ ...sch, enabled: false }, at(1, 12)), false);
  assert.equal(inSchedule({ ...sch, days: [] }, at(1, 12)), false);
});

test('inSchedule: window across midnight belongs to the start day', () => {
  const sch = { enabled: true, days: [5], from: '22:00', to: '02:00' }; // Friday night
  assert.equal(inSchedule(sch, at(5, 23)), true);
  assert.equal(inSchedule(sch, at(6, 1, 30)), true, 'Saturday 01:30 is still Friday night');
  assert.equal(inSchedule(sch, at(6, 2, 0)), false);
  assert.equal(inSchedule(sch, at(5, 1)), false, 'Friday 01:00 belongs to Thursday');
  assert.equal(inSchedule(sch, at(6, 23)), false);
});

test('inSchedule: from == to means the whole day', () => {
  const sch = { enabled: true, days: [0], from: '00:00', to: '00:00' };
  assert.equal(inSchedule(sch, at(0, 0)), true);
  assert.equal(inSchedule(sch, at(0, 23, 59)), true);
  assert.equal(inSchedule(sch, at(1, 0)), false);
});

test('nextScheduleChange finds the next on/off moment', () => {
  const sch = { enabled: true, days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' };
  assert.deepEqual(nextScheduleChange(sch, at(1, 8, 15)), at(1, 9, 0));
  assert.deepEqual(nextScheduleChange(sch, at(1, 12, 30)), at(1, 18, 0));
  assert.deepEqual(nextScheduleChange(sch, at(5, 19)), new Date(2026, 10, 2, 9, 0), 'Friday evening → next Monday 09:00');
  assert.equal(nextScheduleChange({ ...sch, enabled: false }, at(1, 12)), null);
  assert.equal(nextScheduleChange({ ...sch, days: [] }, at(1, 12)), null);
});

test('effectiveFeatures: pause turns everything off; schedule only adds focus items', () => {
  const s = applyPreset(defaultSettings(), 'minimal');
  const off = effectiveFeatures({ ...s, enabled: false }, at(1, 12));
  assert.ok(Object.values(off.features).every((v) => v === false));
  assert.equal(effectiveFeatures(s, at(1, 12)).features.related, false);
  const sched = { ...s, schedule: { enabled: true, days: [1], from: '09:00', to: '18:00' } };
  const on = effectiveFeatures(sched, at(1, 12));
  assert.equal(on.focusActive, true);
  assert.equal(on.features.related, true);
  assert.equal(on.features.autoplayOff, true);
  assert.equal(on.features.homeRedirect, false, 'focus never adds the home redirect');
  const sub = effectiveFeatures({ ...applyPreset(s, 'subscriptions'), schedule: sched.schedule }, at(1, 12));
  assert.equal(sub.features.homeRedirect, true, 'focus never removes anything');
  assert.equal(effectiveFeatures(sched, at(1, 20)).focusActive, false);
});

test('withSetting updates a dotted path immutably and normalizes', () => {
  const d = defaultSettings();
  const s = withSetting(d, 'features.shorts', false);
  assert.equal(s.features.shorts, false);
  assert.equal(d.features.shorts, true, 'original untouched');
  assert.equal(withSetting(d, 'schedule.from', '07:15').schedule.from, '07:15');
  assert.equal(withSetting(d, 'schedule.from', 'bad').schedule.from, '09:00');
  assert.equal(withSetting(d, 'nope.deep.key', 1).enabled, true);
  assert.deepEqual(withSetting(d, 'schedule.days', [6, 0, 6]).schedule.days, [0, 6]);
});
