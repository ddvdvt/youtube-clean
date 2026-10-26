// Popup: master switch, presets, quick toggles, live status of the current tab, stale-rule warning.
import { t, applyI18n } from '../shared/i18n.js';
import { wireBrandLinks } from '../shared/brand-link.js';
import { getSettings, setSetting, setPreset, featureSwitch, renderPresets, hhmm } from '../shared/storage.js';
import { PRESET_IDS, matchPreset, effectiveFeatures, nextScheduleChange } from '../../lib/settings.js';
import { normalizeHealth, staleFeatures } from '../../lib/health.js';
import { chooseConfig } from '../../lib/config.js';
import { normalizeUsage, minutesOf } from '../../lib/usage.js';

const QUICK = ['shorts', 'homeFeed', 'related', 'endscreen', 'autoplayOff', 'comments'];
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @type {any} */
let bundled = null;

async function activeTab() {
  const id = Number(new URLSearchParams(location.search).get('tabId'));
  if (id) return chrome.tabs.get(id).catch(() => null);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function renderTab() {
  const tab = await activeTab();
  const el = $('tabStatus');
  /** @type {any} */
  let stats = null;
  if (tab && tab.id !== undefined) stats = await chrome.tabs.sendMessage(tab.id, { type: 'yc:stats' }).catch(() => null);
  if (stats && stats.ok) {
    el.textContent = t('hiddenHere', String(stats.total));
    el.dataset.total = String(stats.total);
  } else if (tab && /^https:\/\/www\.youtube\.com\//.test(tab.url || '')) {
    el.textContent = t('reloadHint');
  } else {
    el.textContent = t('notYoutube');
  }
}

/**
 * Access to youtube.com. Chrome grants it at install; in Firefox (MV3) the user can withhold or
 * revoke it, and then the content script does not run. Shown with a button that asks again.
 */
const YT = { origins: chrome.runtime.getManifest().host_permissions || [] };
async function renderAccess() {
  const ok = await chrome.permissions.contains(YT).catch(() => true);
  $('access').classList.toggle('hidden', ok);
  return ok;
}

async function render() {
  const settings = await getSettings();
  const store = await chrome.storage.local.get(['health', 'usage', 'remoteConfig']);
  const now = new Date();
  document.body.classList.toggle('paused', !settings.enabled);
  /** @type {HTMLInputElement} */ ($('enabled')).checked = settings.enabled;
  $('paused').classList.toggle('hidden', settings.enabled);

  const current = matchPreset(settings.features);
  const presets = $('presets');
  if (presets.children.length) for (const b of presets.children) b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.preset === current));
  else
    renderPresets(presets, PRESET_IDS, current, t, async (id) => {
      await setPreset(/** @type {any} */ (id));
      render();
    });
  $('presetDesc').textContent = current ? t(`presetDesc_${current}`) : t('presetCustom');

  const box = $('switches');
  if (box.children.length) for (const f of QUICK) /** @type {HTMLInputElement} */ ($(`f-${f}`)).checked = settings.features[/** @type {any} */ (f)];
  else for (const f of QUICK) {
    box.appendChild(
      featureSwitch(f, settings.features[/** @type {any} */ (f)], t, async (checked) => {
        await setSetting(`features.${f}`, checked);
        render();
      }),
    );
  }

  // schedule status
  const { features, focusActive } = effectiveFeatures(settings, now);
  const next = nextScheduleChange(settings.schedule, now);
  const focus = $('focusStatus');
  focus.classList.toggle('hidden', !settings.enabled || !settings.schedule.enabled || !next);
  if (next) focus.textContent = t(focusActive ? 'focusNow' : 'focusNext', hhmm(next));

  const usage = normalizeUsage(store.usage, now);
  $('usageStatus').textContent = t('todayUsage', String(minutesOf(usage.seconds)));

  // stale rules warning
  const config = settings.remoteEnabled ? chooseConfig(bundled, store.remoteConfig && store.remoteConfig.config) : bundled;
  const stale = settings.enabled ? staleFeatures(normalizeHealth(store.health, config.version), features, Date.now()) : [];
  $('stale').classList.toggle('hidden', stale.length === 0);
  if (stale.length) {
    $('staleText').textContent = t('staleText', stale.map((f) => t(`feat_${f}`)).join(', '));
    const btn = /** @type {HTMLButtonElement} */ ($('staleAction'));
    btn.textContent = settings.remoteEnabled ? t('checkNow') : t('staleEnableRemote');
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = t('checking');
      if (!settings.remoteEnabled) await setSetting('remoteEnabled', true);
      await chrome.runtime.sendMessage({ type: 'yc:checkRemote' }).catch(() => null);
      btn.disabled = false;
      render();
    };
  }
}

async function init() {
  applyI18n();
  wireBrandLinks();
  bundled = await (await fetch(chrome.runtime.getURL('config/selectors.json'))).json();
  $('enabled').addEventListener('change', async (e) => {
    await setSetting('enabled', /** @type {HTMLInputElement} */ (e.target).checked);
    render();
  });
  $('allSettings').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  $('grantAccess').addEventListener('click', async () => {
    // straight from the click: permissions.request needs the user gesture
    const granted = await chrome.permissions.request(YT).catch(() => false);
    if (!granted) {
      $('accessMsg').textContent = t('accessDenied');
      return;
    }
    await renderAccess();
    const tab = await activeTab();
    if (tab && tab.id !== undefined && /^https:\/\/www\.youtube\.com\//.test(tab.url || '')) chrome.tabs.reload(tab.id).catch(() => {});
    setTimeout(renderTab, 1500);
  });
  await renderAccess();
  await render();
  await renderTab();
  document.body.dataset.ready = '1';
  // the page needs a moment to apply a change; refresh the counter afterwards
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) setTimeout(renderTab, 300);
  });
}

init();
