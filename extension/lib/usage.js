// Local "time on video today" counter for the optional daily reminder. Pure.

/** @typedef {{ day: string, seconds: number, remindedDay: string }} Usage */

/** Local calendar day "YYYY-MM-DD". @param {Date} d */
export function dayKey(d) {
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** @param {any} raw @param {Date} now @returns {Usage} today's usage (a new day starts at zero) */
export function normalizeUsage(raw, now) {
  const day = dayKey(now);
  const r = raw && typeof raw === 'object' ? raw : {};
  const remindedDay = typeof r.remindedDay === 'string' ? r.remindedDay : '';
  if (r.day !== day || !Number.isFinite(r.seconds) || r.seconds < 0) return { day, seconds: 0, remindedDay };
  return { day, seconds: Math.floor(r.seconds), remindedDay };
}

/**
 * Add active seconds (capped so a sleeping laptop never adds hours at once).
 * @param {any} raw @param {number} seconds @param {Date} now @returns {Usage}
 */
export function addUsage(raw, seconds, now) {
  const u = normalizeUsage(raw, now);
  const add = Math.max(0, Math.min(120, Math.floor(seconds)));
  return { ...u, seconds: u.seconds + add };
}

/**
 * Show the reminder now? Once a day, after the limit.
 * @param {Usage} usage @param {{ enabled: boolean, minutes: number }} reminder @param {Date} now
 */
export function shouldRemind(usage, reminder, now) {
  return Boolean(reminder && reminder.enabled && usage.day === dayKey(now) && usage.remindedDay !== usage.day && usage.seconds >= reminder.minutes * 60);
}

/** Whole minutes. @param {number} seconds */
export const minutesOf = (seconds) => Math.floor(Math.max(0, seconds) / 60);
