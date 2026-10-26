// Content script module for www.youtube.com.
//
// CSS first: one generated stylesheet (lib/config.js buildCss) hides everything the user switched
// off. JS is kept to what CSS cannot do: URL redirects, turning autoplay off, the "rule stopped
// matching" probes, the local time counter and the popup's "hidden on this page" counter.
// YouTube is a single-page app, so pages are tracked through its yt-navigate-* events, popstate
// and a cheap URL check once a second as a fallback. Every entry point is wrapped in try/catch.

import { normalizeSettings, effectiveFeatures, nextScheduleChange } from '../../lib/settings.js';
import { chooseConfig, buildCss, probesFor, isSafeSelector, RULE_KEYS } from '../../lib/config.js';
import { pageType, redirectTarget, videoId } from '../../lib/routes.js';
import { normalizeHealth, healthKey, shouldCheck, recordCheck } from '../../lib/health.js';
import { addUsage, shouldRemind, minutesOf } from '../../lib/usage.js';

const STYLE_ID = 'yc-declutter-style';
const TOAST_ID = 'yc-declutter-toast';
const HEALTH_DELAYS_MS = [5000, 15000, 30000]; // a probe that misses is retried before it counts
const AUTOPLAY_WATCH_MS = 20000;
const USAGE_TICK_S = 30;

/** @param {string} key @param {string | string[]} [subs] */
const t = (key, subs) => {
  try {
    return chrome.i18n.getMessage(key, subs) || key;
  } catch {
    return key;
  }
};

/** @param {() => any} fn */
const safe = (fn) => {
  try {
    const r = fn();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch {
    /* never break YouTube */
  }
};

/** @type {any} */
let bundled = null;
const S = {
  settings: normalizeSettings(null),
  /** @type {any} */
  config: null,
  /** @type {Record<string, boolean>} */
  features: {},
  focusActive: false,
  lastUrl: '',
  autoplayDoneFor: '',
  lastUserClick: 0,
  /** @type {Element | null} */ lastUserTarget: null,
  /** @type {any} */ autoplayTimer: 0,
  /** @type {any} */ healthTimer: 0,
  /** @type {any} */ scheduleTimer: 0,
};

function styleEl() {
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
  }
  if (!el.isConnected) (document.head || document.documentElement).appendChild(el);
  return el;
}

/** Elements YouTube keeps for pages that are not shown right now. */
function inactiveSelector() {
  const list = S.config && Array.isArray(S.config.inactive) ? S.config.inactive.filter(isSafeSelector) : [];
  return list.join(', ');
}

/** Elements matching `sel` on the visible page (not inside a hidden, pre-rendered page). */
function activeAll(sel) {
  let nodes;
  try {
    nodes = document.querySelectorAll(sel);
  } catch {
    return [];
  }
  const inactive = inactiveSelector();
  return [...nodes].filter((el) => {
    if (!inactive) return true;
    try {
      return !el.closest(inactive);
    } catch {
      return true;
    }
  });
}

const activeExists = (/** @type {string} */ sel) => activeAll(sel).length > 0;

/** Recompute features in force (schedule!) and the stylesheet. */
function recompute() {
  const { features, focusActive } = effectiveFeatures(S.settings, new Date());
  S.features = features;
  S.focusActive = focusActive;
  const css = buildCss(S.config, features, { homeMessage: t('homeMessage') });
  const el = styleEl();
  if (el.textContent !== css) el.textContent = css;
  chrome.storage.local.get('cssCache').then(({ cssCache }) => {
    if (cssCache !== css) chrome.storage.local.set({ cssCache: css });
  });
  clearTimeout(S.scheduleTimer);
  const next = nextScheduleChange(S.settings.schedule, new Date());
  if (next) S.scheduleTimer = setTimeout(() => safe(onFeaturesChanged), Math.min(next.getTime() - Date.now() + 500, 60 * 60 * 1000));
}

/** @param {any} rawSettings @param {any} remote */
function configure(rawSettings, remote) {
  S.settings = normalizeSettings(rawSettings);
  S.config = S.settings.remoteEnabled ? chooseConfig(bundled, remote && remote.config) : bundled;
  recompute();
}

function onFeaturesChanged() {
  recompute();
  if (maybeRedirect(location.href)) return;
  if (pageType(location.href) === 'watch') {
    S.autoplayDoneFor = '';
    autoplay();
  }
}

/** @param {string} url @returns {boolean} true if the page is leaving */
function maybeRedirect(url) {
  const target = redirectTarget(url, S.features);
  if (!target || target === location.href) return false;
  location.replace(target);
  return true;
}

/**
 * Turn the autoplay toggle off for each new video. The player may still be initialising and flip
 * it back on, so for AUTOPLAY_WATCH_MS the toggle is watched and switched off again — unless the
 * user clicked it themselves (a real click just before the flip), which is always respected.
 */
function autoplay() {
  const rule = S.config && S.config.rules && S.config.rules.autoplayOff;
  const vid = videoId(location.href);
  if (S.autoplayDoneFor === vid) return; // already handled (or being handled) for this video
  clearInterval(S.autoplayTimer);
  if (!S.features.autoplayOff || !vid || !rule || !isSafeSelector(rule.click)) return;
  S.autoplayDoneFor = vid;
  const started = Date.now();
  let lastClick = 0;
  S.autoplayTimer = setInterval(() => {
    safe(() => {
      if (!S.features.autoplayOff || videoId(location.href) !== vid || Date.now() - started > AUTOPLAY_WATCH_MS) {
        clearInterval(S.autoplayTimer);
        return;
      }
      const btn = /** @type {HTMLElement | undefined} */ (activeAll(rule.click)[0]);
      if (!btn) return;
      const t = S.lastUserTarget;
      const userToggled = t && t.isConnected && (btn.contains(t) || t.contains(btn));
      if (userToggled && S.lastUserClick > lastClick && Date.now() - S.lastUserClick < 2000) {
        clearInterval(S.autoplayTimer); // the user turned it on: leave it
        return;
      }
      // a player that is still starting ignores clicks: try again after a pause
      if (Date.now() - lastClick < 1500) return;
      btn.click();
      lastClick = Date.now();
    });
  }, 250);
}

/**
 * Record whether each probed rule still finds its target on this page type. Parts of the page
 * load lazily, so a miss is only recorded after the last retry; a hit is recorded at once.
 * @param {string} page
 * @param {string} url
 * @param {number} attempt index into HEALTH_DELAYS_MS
 */
async function checkHealth(page, url, attempt) {
  if (location.href !== url) return;
  const probes = probesFor(S.config, page);
  if (!probes.length) return;
  const now = Date.now();
  const last = attempt >= HEALTH_DELAYS_MS.length - 1;
  const { health: raw } = await chrome.storage.local.get('health');
  let health = normalizeHealth(raw, S.config.version);
  let changed = false;
  let retry = false;
  /** @type {Map<string, typeof probes>} */
  const byFeature = new Map();
  for (const p of probes) byFeature.set(p.feature, [...(byFeature.get(p.feature) || []), p]);
  for (const [feature, list] of byFeature) {
    const applicable = list.filter((p) => !p.when || activeExists(p.when));
    const key = healthKey(feature, page);
    if (!shouldCheck(health, key, now)) continue;
    if (!applicable.length) {
      retry = retry || !last;
      continue;
    }
    const matched = applicable.some((p) => activeExists(p.selector));
    if (!matched && !last) {
      retry = true;
      continue;
    }
    health = recordCheck(health, key, matched, now);
    changed = true;
  }
  if (changed) await chrome.storage.local.set({ health });
  if (retry) S.healthTimer = setTimeout(() => safe(() => checkHealth(page, url, attempt + 1)), HEALTH_DELAYS_MS[attempt + 1] - HEALTH_DELAYS_MS[attempt]);
}

function onPage() {
  const url = location.href;
  S.lastUrl = url;
  if (maybeRedirect(url)) return;
  styleEl();
  const page = pageType(url);
  if (page === 'watch') autoplay();
  clearTimeout(S.healthTimer);
  S.healthTimer = setTimeout(() => safe(() => checkHealth(page, url, 0)), HEALTH_DELAYS_MS[0]);
}

/** Counts for the popup: how many elements the stylesheet hides on the visible page. */
function stats() {
  const counts = {};
  const seen = new Set();
  const rules = (S.config && S.config.rules) || {};
  for (const key of RULE_KEYS) {
    if (!S.features[key] || !rules[key] || !Array.isArray(rules[key].hide)) continue;
    let n = 0;
    for (const sel of rules[key].hide) {
      if (!isSafeSelector(sel)) continue;
      for (const el of activeAll(sel)) {
        if (seen.has(el) || [...seen].some((s) => s.contains(el))) continue;
        seen.add(el);
        n++;
      }
    }
    if (n) counts[key] = n;
  }
  return { ok: true, page: pageType(location.href), total: seen.size, counts, focusActive: S.focusActive, enabled: S.settings.enabled };
}

function showReminder(minutes) {
  if (document.getElementById(TOAST_ID)) return;
  const host = document.createElement('div');
  host.id = TOAST_ID;
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .box { position: fixed; left: 24px; bottom: 24px; z-index: 2147483647; max-width: 360px; display: flex; gap: 14px; align-items: center;
      padding: 14px 16px; border-radius: 12px; background: #1f1f1f; color: #f1f1f1; font: 14px/1.45 Roboto, Arial, sans-serif;
      box-shadow: 0 6px 24px rgba(0,0,0,.35); }
    button { flex: none; border: 0; border-radius: 18px; padding: 8px 14px; background: #f1f1f1; color: #0f0f0f; font: 500 14px Roboto, Arial, sans-serif; cursor: pointer; }
    button:focus-visible { outline: 2px solid #3ea6ff; outline-offset: 2px; }`;
  const box = document.createElement('div');
  box.className = 'box';
  box.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = t('reminderToast', String(minutes));
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = t('reminderClose');
  btn.addEventListener('click', () => host.remove());
  box.append(text, btn);
  root.append(style, box);
  document.documentElement.appendChild(host);
}

async function usageTick() {
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
  const now = new Date();
  const { usage: raw } = await chrome.storage.local.get('usage');
  let usage = addUsage(raw, USAGE_TICK_S, now);
  if (S.settings.enabled && shouldRemind(usage, S.settings.reminder, now)) {
    usage = { ...usage, remindedDay: usage.day };
    showReminder(minutesOf(usage.seconds));
  }
  await chrome.storage.local.set({ usage });
}

export async function start() {
  bundled = await (await fetch(chrome.runtime.getURL('config/selectors.json'))).json();
  const { settings, remoteConfig } = await chrome.storage.local.get(['settings', 'remoteConfig']);
  configure(settings, remoteConfig);
  if (maybeRedirect(location.href)) return;

  // Links to Shorts / home: go straight to the target instead of letting the app open them.
  window.addEventListener(
    'click',
    (e) =>
      safe(() => {
        if (e.isTrusted) {
          S.lastUserClick = Date.now();
          S.lastUserTarget = e.target instanceof Element ? e.target : null;
        }
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
        const href = a && /** @type {HTMLAnchorElement} */ (a).href;
        if (!href || new URL(href).origin !== location.origin) return;
        const target = redirectTarget(href, S.features);
        if (!target) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        location.assign(target);
      }),
    true,
  );
  window.addEventListener('yt-navigate-start', (e) =>
    safe(() => {
      const url = /** @type {any} */ (e).detail && /** @type {any} */ (e).detail.url;
      if (typeof url === 'string') maybeRedirect(new URL(url, location.origin).href);
    }),
  );
  window.addEventListener('yt-navigate-finish', () => safe(onPage));
  window.addEventListener('popstate', () => safe(onPage));
  setInterval(() => safe(() => location.href !== S.lastUrl && onPage()), 1000);
  setInterval(() => safe(usageTick), USAGE_TICK_S * 1000);

  chrome.storage.onChanged.addListener((changes, area) =>
    safe(async () => {
      if (area !== 'local' || (!changes.settings && !changes.remoteConfig)) return;
      const st = await chrome.storage.local.get(['settings', 'remoteConfig']);
      configure(st.settings, st.remoteConfig);
      onFeaturesChanged();
    }),
  );
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'yc:stats' || sender.id !== chrome.runtime.id) return;
    try {
      sendResponse(stats());
    } catch {
      sendResponse({ ok: false });
    }
  });
  onPage();
}
