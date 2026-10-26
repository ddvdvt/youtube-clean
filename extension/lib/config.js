// Selector config (extension/config/selectors.json): validation, choice between bundled and
// downloaded rules, and generation of the hiding stylesheet. Pure.
//
// The config is DATA only. Selectors are checked so they cannot break out of the CSS rule they
// are placed into: "{", "}", "@", ";", "<", "\", newlines, "url(" and comments are rejected.

export const MAX_CONFIG_BYTES = 128 * 1024;
const MAX_SELECTOR_LEN = 400;
const MAX_LIST = 120;

/** Features that may have an entry in config.rules. */
export const RULE_KEYS = ['shorts', 'homeFeed', 'related', 'endscreen', 'autoplayOff', 'comments', 'liveChat', 'explore', 'playables', 'ads'];
/** Page types a probe can be bound to (see lib/routes.js pageType). */
export const PAGE_TYPES = ['home', 'watch', 'search', 'channel', 'subscriptions', 'shorts', 'other'];

const TOP_KEYS = new Set(['$schema', 'comment', 'version', 'updated', 'inactive', 'homeMessage', 'rules']);
const RULE_FIELDS = new Set(['hide', 'click', 'probes']);
const PROBE_FIELDS = new Set(['page', 'selector', 'when']);

/**
 * Is this string safe to use as a CSS selector inside our generated stylesheet?
 * @param {unknown} s
 * @returns {s is string}
 */
export function isSafeSelector(s) {
  return (
    typeof s === 'string' &&
    s.trim().length > 0 &&
    s.length <= MAX_SELECTOR_LEN &&
    !/[<{}@;\\\r\n]/.test(s) && // ">" stays allowed: it is a combinator
    !/\/\*|url\s*\(|expression\s*\(/i.test(s)
  );
}

/**
 * Validate a config object (selectors.schema.json documents the same rules; this is the source of truth).
 * @param {any} cfg
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateConfig(cfg) {
  /** @type {string[]} */
  const errors = [];
  const err = (/** @type {string} */ m) => {
    if (errors.length < 50) errors.push(m);
  };
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { ok: false, errors: ['config must be an object'] };
  for (const k of Object.keys(cfg)) if (!TOP_KEYS.has(k)) err(`unknown key "${k}"`);
  if (!Number.isInteger(cfg.version) || cfg.version < 1 || cfg.version > 1e9) err('version must be a positive integer');
  if (cfg.updated !== undefined && (typeof cfg.updated !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(cfg.updated))) err('updated must be YYYY-MM-DD');
  if (cfg.comment !== undefined && typeof cfg.comment !== 'string') err('comment must be a string');
  const selList = (/** @type {any} */ v, /** @type {string} */ where) => {
    if (!Array.isArray(v) || !v.length || v.length > MAX_LIST) return err(`${where} must be a selector array (1..${MAX_LIST})`);
    v.forEach((s, i) => isSafeSelector(s) || err(`${where}[${i}] is not a safe selector`));
  };
  if (cfg.inactive !== undefined) selList(cfg.inactive, 'inactive');
  if (cfg.homeMessage !== undefined && !isSafeSelector(cfg.homeMessage)) err('homeMessage is not a safe selector');
  const rules = cfg.rules;
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
    err('rules must be an object');
    return { ok: false, errors };
  }
  for (const [key, r] of Object.entries(rules)) {
    const at = `rules.${key}`;
    if (!RULE_KEYS.includes(key)) {
      err(`unknown rule "${key}"`);
      continue;
    }
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      err(`${at} must be an object`);
      continue;
    }
    for (const k of Object.keys(r)) if (!RULE_FIELDS.has(k)) err(`${at}: unknown key "${k}"`);
    if (r.hide === undefined && r.click === undefined) err(`${at} needs "hide" or "click"`);
    if (r.hide !== undefined) selList(r.hide, `${at}.hide`);
    if (r.click !== undefined && !isSafeSelector(r.click)) err(`${at}.click is not a safe selector`);
    if (r.probes !== undefined) {
      if (!Array.isArray(r.probes) || r.probes.length > 20) {
        err(`${at}.probes must be an array (0..20)`);
        continue;
      }
      r.probes.forEach((/** @type {any} */ p, /** @type {number} */ i) => {
        const pat = `${at}.probes[${i}]`;
        if (!p || typeof p !== 'object' || Array.isArray(p)) return err(`${pat} must be an object`);
        for (const k of Object.keys(p)) if (!PROBE_FIELDS.has(k)) err(`${pat}: unknown key "${k}"`);
        if (!PAGE_TYPES.includes(p.page)) err(`${pat}.page must be one of ${PAGE_TYPES.join(', ')}`);
        if (!isSafeSelector(p.selector)) err(`${pat}.selector is not a safe selector`);
        if (p.when !== undefined && !isSafeSelector(p.when)) err(`${pat}.when is not a safe selector`);
      });
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Parse + validate JSON text (size-capped).
 * @param {string} text
 * @returns {{ ok: true, config: any } | { ok: false, errors: string[] }}
 */
export function parseConfigText(text) {
  if (typeof text !== 'string') return { ok: false, errors: ['not text'] };
  if (text.length > MAX_CONFIG_BYTES) return { ok: false, errors: ['config too large'] };
  let cfg;
  try {
    cfg = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['invalid JSON'] };
  }
  const v = validateConfig(cfg);
  return v.ok ? { ok: true, config: cfg } : { ok: false, errors: v.errors };
}

/**
 * The config to use: a valid downloaded config wins only if it is newer than the bundled one
 * (an extension update with fresher bundled rules always takes over).
 * @param {any} bundled
 * @param {any} remote
 */
export function chooseConfig(bundled, remote) {
  if (remote && validateConfig(remote).ok && remote.version > bundled.version) return remote;
  return bundled;
}

const LINE_BREAKS = new RegExp('[\r\n\u2028\u2029]+', 'g');

/**
 * CSS string literal (for `content:`), safe for any text.
 * @param {string} s
 */
export function cssString(s) {
  const body = String(s)
    .replace(/[\\"]/g, (c) => `\\${c}`)
    .replace(LINE_BREAKS, ' ')
    .replace(/</g, '\\3c ');
  return `"${body}"`;
}

/**
 * The hiding stylesheet for the features in force. One rule per selector, so a selector the
 * browser does not understand only disables itself.
 * @param {any} config validated config
 * @param {Record<string, boolean>} features
 * @param {{ homeMessage?: string }} [opts]
 */
export function buildCss(config, features, opts = {}) {
  const out = [];
  const rules = (config && config.rules) || {};
  for (const key of RULE_KEYS) {
    if (!features[key] || !rules[key] || !Array.isArray(rules[key].hide)) continue;
    for (const s of rules[key].hide) if (isSafeSelector(s)) out.push(`${s} { display: none !important; }`);
  }
  if (features.homeFeed && opts.homeMessage && isSafeSelector(config && config.homeMessage)) {
    out.push(
      `${config.homeMessage}::before { content: ${cssString(opts.homeMessage)}; display: block; box-sizing: border-box; ` +
        'max-width: 560px; margin: 72px auto 0; padding: 0 24px; text-align: center; white-space: pre-line; ' +
        'font: 400 16px/1.6 Roboto, Arial, sans-serif; color: var(--yt-spec-text-secondary, #606060); }',
    );
  }
  return out.join('\n');
}

/**
 * Probes that apply to a page type, grouped by feature.
 * @param {any} config
 * @param {string} page
 * @returns {{ feature: string, selector: string, when?: string }[]}
 */
export function probesFor(config, page) {
  const out = [];
  const rules = (config && config.rules) || {};
  for (const key of RULE_KEYS) {
    const r = rules[key];
    if (!r || !Array.isArray(r.probes)) continue;
    for (const p of r.probes) if (p && p.page === page && isSafeSelector(p.selector)) out.push({ feature: key, selector: p.selector, when: isSafeSelector(p.when) ? p.when : undefined });
  }
  return out;
}

/** Features that have at least one probe (only these can be reported as "may be broken"). */
export function probedFeatures(config) {
  const rules = (config && config.rules) || {};
  return RULE_KEYS.filter((k) => rules[k] && Array.isArray(rules[k].probes) && rules[k].probes.length > 0);
}
