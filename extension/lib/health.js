// "Did a rule stop matching?" bookkeeping. Pure.
//
// After a page settles, the content script checks each probe of the config for that page type
// (see config.rules[*].probes) and records a hit or a miss here. A feature is reported as
// "YouTube may have changed its markup" only after several misses in a row spread over time,
// so a single odd page never raises a false alarm.

export const CHECK_INTERVAL_MS = 10 * 60 * 1000; // at most one check per feature+page per 10 min
export const STALE_MISSES = 5;
export const STALE_SPAN_MS = 60 * 60 * 1000;

/** @typedef {{ misses: number, firstMissAt: number, lastHit: number, lastCheck: number }} HealthRecord */
/** @typedef {{ configVersion: number, records: Record<string, HealthRecord> }} Health */

/** @param {string} feature @param {string} page */
export const healthKey = (feature, page) => `${feature}:${page}`;

/**
 * @param {any} raw
 * @param {number} configVersion
 * @returns {Health} health for this config version (records of another version are dropped)
 */
export function normalizeHealth(raw, configVersion) {
  if (!raw || typeof raw !== 'object' || raw.configVersion !== configVersion || !raw.records || typeof raw.records !== 'object') {
    return { configVersion, records: {} };
  }
  return { configVersion, records: { ...raw.records } };
}

/**
 * Should this feature+page be checked now?
 * @param {Health} health
 * @param {string} key
 * @param {number} now
 */
export function shouldCheck(health, key, now) {
  const r = health.records[key];
  return !r || now - (r.lastCheck || 0) >= CHECK_INTERVAL_MS;
}

/**
 * Record one check.
 * @param {Health} health
 * @param {string} key
 * @param {boolean} matched
 * @param {number} now
 * @returns {Health}
 */
export function recordCheck(health, key, matched, now) {
  const prev = health.records[key] || { misses: 0, firstMissAt: 0, lastHit: 0, lastCheck: 0 };
  const rec = matched
    ? { misses: 0, firstMissAt: 0, lastHit: now, lastCheck: now }
    : { misses: prev.misses + 1, firstMissAt: prev.misses ? prev.firstMissAt : now, lastHit: prev.lastHit, lastCheck: now };
  return { configVersion: health.configVersion, records: { ...health.records, [key]: rec } };
}

/** @param {HealthRecord | undefined} r @param {number} now */
export function isStale(r, now) {
  return Boolean(r && r.misses >= STALE_MISSES && now - r.firstMissAt >= STALE_SPAN_MS);
}

/**
 * Features (of those enabled) whose probes keep missing.
 * @param {Health} health
 * @param {Record<string, boolean>} enabled
 * @param {number} now
 * @returns {string[]}
 */
export function staleFeatures(health, enabled, now) {
  const out = new Set();
  for (const [key, r] of Object.entries(health.records || {})) {
    const feature = key.split(':')[0];
    if (enabled[feature] && isStale(r, now)) out.add(feature);
  }
  return [...out];
}
