// Settings model: feature toggles, presets, focus schedule, daily reminder. Pure (no chrome.*).

/** Every feature toggle, in the order the UI shows them. */
export const FEATURES = /** @type {const} */ ([
  'shorts',
  'shortsRedirect',
  'homeFeed',
  'homeRedirect',
  'related',
  'endscreen',
  'autoplayOff',
  'comments',
  'liveChat',
  'explore',
  'playables',
  'ads',
]);

/** @typedef {typeof FEATURES[number]} Feature */
/** @typedef {Record<Feature, boolean>} Features */
/** @typedef {{ enabled: boolean, days: number[], from: string, to: string }} Schedule */
/** @typedef {{ enabled: boolean, minutes: number }} Reminder */
/**
 * @typedef {{
 *   enabled: boolean,
 *   features: Features,
 *   schedule: Schedule,
 *   reminder: Reminder,
 *   remoteEnabled: boolean,
 * }} Settings
 */

/** Features a preset leaves alone: personal choices, not "distraction levels". */
export const PERSONAL = /** @type {Feature[]} */ (['comments', 'liveChat']);

/** @param {Partial<Features>} on */
function preset(on) {
  /** @type {Partial<Features>} */
  const out = {};
  for (const f of FEATURES) if (!PERSONAL.includes(f)) out[f] = Boolean(on[f]);
  return out;
}

export const PRESETS = {
  /** Light touch: no Shorts, no clutter, recommendations stay. */
  minimal: preset({ shorts: true, explore: true, playables: true, ads: true }),
  /** No Shorts, no recommendations anywhere, no autoplay. */
  focus: preset({
    shorts: true,
    shortsRedirect: true,
    homeFeed: true,
    related: true,
    endscreen: true,
    autoplayOff: true,
    explore: true,
    playables: true,
    ads: true,
  }),
  /** Like focus, and the home page opens Subscriptions. */
  subscriptions: preset({
    shorts: true,
    shortsRedirect: true,
    homeFeed: true,
    homeRedirect: true,
    related: true,
    endscreen: true,
    autoplayOff: true,
    explore: true,
    playables: true,
    ads: true,
  }),
};
/** @typedef {keyof typeof PRESETS} PresetId */
export const PRESET_IDS = /** @type {PresetId[]} */ (Object.keys(PRESETS));

/** @returns {Settings} */
export function defaultSettings() {
  const features = /** @type {Features} */ ({});
  for (const f of FEATURES) features[f] = Boolean(/** @type {any} */ (PRESETS.focus)[f]); // comments, chat: off
  return {
    enabled: true,
    features,
    schedule: { enabled: false, days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' },
    reminder: { enabled: false, minutes: 60 },
    remoteEnabled: false,
  };
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "HH:MM" → minutes since midnight, or null. */
export function parseTime(s) {
  const m = typeof s === 'string' ? TIME.exec(s) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Bring anything (old versions, partial objects, garbage) to a complete valid Settings object.
 * @param {any} raw
 * @returns {Settings}
 */
export function normalizeSettings(raw) {
  const d = defaultSettings();
  const r = raw && typeof raw === 'object' ? raw : {};
  const f = r.features && typeof r.features === 'object' ? r.features : {};
  const features = /** @type {Features} */ ({});
  for (const k of FEATURES) features[k] = typeof f[k] === 'boolean' ? f[k] : d.features[k];
  const s = r.schedule && typeof r.schedule === 'object' ? r.schedule : {};
  const days = Array.isArray(s.days) ? [...new Set(s.days.filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort() : d.schedule.days;
  const rem = r.reminder && typeof r.reminder === 'object' ? r.reminder : {};
  const minutes = Number.isInteger(rem.minutes) && rem.minutes >= 5 && rem.minutes <= 24 * 60 ? rem.minutes : d.reminder.minutes;
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    features,
    schedule: {
      enabled: typeof s.enabled === 'boolean' ? s.enabled : d.schedule.enabled,
      days,
      from: parseTime(s.from) !== null ? s.from : d.schedule.from,
      to: parseTime(s.to) !== null ? s.to : d.schedule.to,
    },
    reminder: { enabled: typeof rem.enabled === 'boolean' ? rem.enabled : d.reminder.enabled, minutes },
    remoteEnabled: typeof r.remoteEnabled === 'boolean' ? r.remoteEnabled : d.remoteEnabled,
  };
}

/**
 * Apply a preset: it sets every non-personal feature; comments and live chat stay as they are.
 * @param {Settings} settings
 * @param {PresetId} id
 * @returns {Settings}
 */
export function applyPreset(settings, id) {
  const p = PRESETS[id];
  if (!p) return settings;
  return { ...settings, features: { ...settings.features, ...p } };
}

/**
 * Which preset the features match exactly (personal toggles ignored), or null for "custom".
 * @param {Features} features
 * @returns {PresetId | null}
 */
export function matchPreset(features) {
  for (const id of PRESET_IDS) {
    const p = PRESETS[id];
    if (Object.entries(p).every(([k, v]) => features[/** @type {Feature} */ (k)] === v)) return id;
  }
  return null;
}

/**
 * Is the focus schedule active at this moment? Windows may cross midnight (22:00 → 02:00 belongs
 * to the day it starts on). from == to means the whole day.
 * @param {Schedule} schedule
 * @param {Date} date
 */
export function inSchedule(schedule, date) {
  if (!schedule || !schedule.enabled || !schedule.days.length) return false;
  const from = parseTime(schedule.from);
  const to = parseTime(schedule.to);
  if (from === null || to === null) return false;
  const day = date.getDay();
  const prev = (day + 6) % 7;
  const m = date.getHours() * 60 + date.getMinutes();
  if (from === to) return schedule.days.includes(day);
  if (from < to) return schedule.days.includes(day) && m >= from && m < to;
  return (schedule.days.includes(day) && m >= from) || (schedule.days.includes(prev) && m < to);
}

/**
 * The next moment (minute precision) the schedule switches on or off, within 8 days, or null.
 * @param {Schedule} schedule
 * @param {Date} date
 * @returns {Date | null}
 */
export function nextScheduleChange(schedule, date) {
  if (!schedule || !schedule.enabled) return null;
  const now = inSchedule(schedule, date);
  const t = new Date(date.getTime());
  t.setSeconds(0, 0);
  for (let i = 0; i < 8 * 24 * 60; i++) {
    t.setMinutes(t.getMinutes() + 1);
    if (inSchedule(schedule, t) !== now) return t;
  }
  return null;
}

/**
 * Features in force right now. Off when the extension is paused; during the focus schedule the
 * focus preset is added on top (it only hides more, it never brings anything back).
 * @param {Settings} settings
 * @param {Date} date
 * @returns {{ features: Features, focusActive: boolean }}
 */
export function effectiveFeatures(settings, date) {
  const features = /** @type {Features} */ ({});
  if (!settings.enabled) {
    for (const k of FEATURES) features[k] = false;
    return { features, focusActive: false };
  }
  const focusActive = inSchedule(settings.schedule, date);
  for (const k of FEATURES) features[k] = settings.features[k] || (focusActive && Boolean(/** @type {any} */ (PRESETS.focus)[k]));
  return { features, focusActive };
}

/**
 * Immutable update of one dotted path ("features.shorts", "schedule.from", "enabled").
 * @param {Settings} settings
 * @param {string} path
 * @param {any} value
 * @returns {Settings}
 */
export function withSetting(settings, path, value) {
  const next = structuredClone(settings);
  const keys = path.split('.');
  /** @type {any} */
  let o = next;
  for (const k of keys.slice(0, -1)) {
    if (!o[k] || typeof o[k] !== 'object') return normalizeSettings(next);
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
  return normalizeSettings(next);
}
