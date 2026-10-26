// Service worker: first-run defaults, the welcome / uninstall pages, and — only if the user turned
// it on — a daily download of the signed selector file from the brand site. No remote code.

import { normalizeSettings } from '../lib/settings.js';
import { verifyEnvelope, MAX_ENVELOPE_BYTES } from '../lib/remote.js';
import { brandUrls, welcomeUrlFor } from '../lib/brand.js';

const ALARM = 'yc-rules-update';

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return normalizeSettings(settings);
}

async function scheduleRemote() {
  const s = await getSettings();
  if (s.remoteEnabled) {
    const existing = await chrome.alarms.get(ALARM);
    if (!existing) await chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: 24 * 60 });
  } else {
    await chrome.alarms.clear(ALARM);
  }
}

/** Download, verify and store the signed rules. Returns a status object (also stored). */
async function fetchRemote() {
  const at = Date.now();
  /** @type {any} */
  let status;
  try {
    if (!(await getSettings()).remoteEnabled) throw new Error('disabled');
    const res = await fetch(brandUrls().rules, { cache: 'no-cache', credentials: 'omit', redirect: 'error' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (Number(res.headers.get('content-length') || 0) > MAX_ENVELOPE_BYTES) throw new Error('file too large');
    const r = await verifyEnvelope(await res.text());
    if (!r.ok) throw new Error(r.error);
    const bundled = await (await fetch(chrome.runtime.getURL('config/selectors.json'))).json();
    await chrome.storage.local.set({ remoteConfig: { config: r.config, fetchedAt: at } });
    status = { ok: true, at, version: r.config.version, newer: r.config.version > bundled.version };
  } catch (e) {
    status = { ok: false, at, error: String((e && /** @type {any} */ (e).message) || e) };
  }
  await chrome.storage.local.set({ remoteStatus: status });
  return status;
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const url = welcomeUrlFor(details && details.reason);
  if (url) chrome.tabs.create({ url }).catch(() => {});
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: normalizeSettings(settings) });
  await chrome.storage.local.remove('cssCache'); // regenerate with the (possibly new) bundled rules
  await scheduleRemote();
});

// Page shown after the extension is removed (a plain static page; nothing is sent to it).
try {
  chrome.runtime.setUninstallURL(brandUrls().bye).catch(() => {});
} catch {
  /* not available in this context */
}

chrome.runtime.onStartup.addListener(() => {
  scheduleRemote().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  // the cached stylesheet (applied before the content module loads) is rebuilt by the next YouTube page
  if (changes.settings || changes.remoteConfig) chrome.storage.local.remove('cssCache').catch(() => {});
  if (!changes.settings) return;
  const a = normalizeSettings(changes.settings.oldValue);
  const b = normalizeSettings(changes.settings.newValue);
  if (a.remoteEnabled !== b.remoteEnabled) {
    scheduleRemote().catch(() => {});
    if (!b.remoteEnabled) chrome.storage.local.remove(['remoteConfig', 'remoteStatus']).catch(() => {});
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) fetchRemote();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'yc:checkRemote') return;
  // privileged requests are accepted only from extension pages, never from content scripts
  const fromExtensionPage = sender.id === chrome.runtime.id && String(sender.url || '').startsWith(chrome.runtime.getURL(''));
  if (!fromExtensionPage) return;
  fetchRemote().then(sendResponse);
  return true;
});
