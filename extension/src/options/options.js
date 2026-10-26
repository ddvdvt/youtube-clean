// Options page: presets, every toggle, focus schedule, reminder, rule updates and rule status.
import { t, applyI18n } from '../shared/i18n.js';
import { wireBrandLinks } from '../shared/brand-link.js';
import { getSettings, setSetting, setPreset, saveSettings, featureSwitch, hhmm } from '../shared/storage.js';
import { PRESET_IDS, matchPreset, inSchedule, nextScheduleChange, defaultSettings, parseTime } from '../../lib/settings.js';
import { chooseConfig, probedFeatures } from '../../lib/config.js';
import { normalizeHealth, isStale } from '../../lib/health.js';
import { normalizeUsage, minutesOf } from '../../lib/usage.js';

const GROUPS = {
  gShorts: ['shorts', 'shortsRedirect'],
  gRecs: ['homeFeed', 'homeRedirect', 'related', 'endscreen', 'autoplayOff'],
  gOther: ['comments', 'liveChat', 'explore', 'playables', 'ads'],
};
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

/** @type {any} */
let bundled = null;

const fmtDate = (/** @type {number} */ ms) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function renderPresetCards(settings) {
  const box = $('presetCards');
  const current = matchPreset(settings.features);
  if (box.children.length) {
    for (const b of box.children) b.setAttribute('aria-pressed', String(b.dataset.preset === current));
    return;
  }
  for (const id of PRESET_IDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset-card';
    b.dataset.preset = id;
    b.setAttribute('aria-pressed', String(id === current));
    const title = document.createElement('b');
    title.textContent = t(`preset_${id}`);
    const desc = document.createElement('span');
    desc.textContent = t(`presetDesc_${id}`);
    b.append(title, desc);
    b.addEventListener('click', async () => render(await setPreset(/** @type {any} */ (id))));
    box.appendChild(b);
  }
}

function renderFeatures(settings) {
  for (const [id, list] of Object.entries(GROUPS)) {
    const box = $(id);
    if (box.children.length) {
      for (const f of list) $(`f-${f}`).checked = settings.features[f];
      continue;
    }
    for (const f of list) box.appendChild(featureSwitch(f, settings.features[f], t, async (checked) => render(await setSetting(`features.${f}`, checked))));
  }
}

function renderSchedule(settings) {
  const s = settings.schedule;
  $('scheduleEnabled').checked = s.enabled;
  if (document.activeElement !== $('scheduleFrom')) $('scheduleFrom').value = s.from;
  if (document.activeElement !== $('scheduleTo')) $('scheduleTo').value = s.to;
  const days = $('days');
  if (days.children.length) for (const input of days.querySelectorAll('input')) input.checked = s.days.includes(Number(input.value));
  else for (const d of DAY_ORDER) {
    const label = document.createElement('label');
    label.className = 'day';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = String(d);
    input.checked = s.days.includes(d);
    input.addEventListener('change', async () => {
      const cur = await getSettings();
      const next = input.checked ? [...cur.schedule.days, d] : cur.schedule.days.filter((x) => x !== d);
      render(await setSetting('schedule.days', next));
    });
    const span = document.createElement('span');
    span.textContent = t(`day${d}`);
    label.append(input, span);
    days.appendChild(label);
  }
  const st = $('scheduleStatus');
  st.className = 'small';
  if (!s.enabled) st.textContent = '';
  else if (!s.days.length) {
    st.textContent = t('scheduleNoDays');
    st.classList.add('err');
  } else {
    const now = new Date();
    const on = inSchedule(s, now);
    const next = nextScheduleChange(s, now);
    st.textContent = (on ? t('scheduleStatusOn') : t('scheduleStatusOff')) + (next ? ` ${t(on ? 'focusNow' : 'focusNext', hhmm(next))}.` : '');
    if (on) st.classList.add('on');
  }
}

async function renderRules(settings) {
  const store = await chrome.storage.local.get(['remoteConfig', 'remoteStatus', 'health']);
  const active = settings.remoteEnabled ? chooseConfig(bundled, store.remoteConfig && store.remoteConfig.config) : bundled;
  $('rulesBundled').textContent = t('rulesBundled', [String(bundled.version), bundled.updated || '']);
  $('rulesActive').textContent = t('rulesActive', String(active.version));
  $('remoteEnabled').checked = settings.remoteEnabled;
  $('checkNow').disabled = !settings.remoteEnabled;
  const rs = store.remoteStatus;
  $('remoteStatus').textContent = !settings.remoteEnabled
    ? ''
    : !rs
      ? t('remoteNever')
      : rs.ok
        ? t('remoteStatusOk', [fmtDate(rs.at), String(rs.version)])
        : t('remoteStatusErr', [fmtDate(rs.at), rs.error]);

  const health = normalizeHealth(store.health, active.version);
  const now = Date.now();
  const list = $('health');
  list.textContent = '';
  for (const f of probedFeatures(active)) {
    const recs = Object.entries(health.records).filter(([k]) => k.startsWith(`${f}:`)).map(([, r]) => r);
    const li = document.createElement('li');
    li.dataset.feature = f;
    const name = document.createElement('span');
    name.textContent = t(`feat_${f}`);
    const st = document.createElement('span');
    st.className = 'st';
    if (!recs.length) st.textContent = t('healthUnknown');
    else if (recs.some((r) => isStale(r, now))) {
      st.textContent = t('healthStale');
      st.classList.add('stale');
    } else {
      const last = Math.max(...recs.map((r) => r.lastHit || 0));
      st.textContent = last ? `${t('healthOk')} · ${t('healthLastHit', fmtDate(last))}` : t('healthUnknown');
      if (last) st.classList.add('ok');
    }
    li.append(name, st);
    list.appendChild(li);
  }
}

async function render(settings) {
  const s = settings || (await getSettings());
  $('enabled').checked = s.enabled;
  renderPresetCards(s);
  renderFeatures(s);
  renderSchedule(s);
  $('reminderEnabled').checked = s.reminder.enabled;
  if (document.activeElement !== $('reminderMinutes')) $('reminderMinutes').value = String(s.reminder.minutes);
  const { usage } = await chrome.storage.local.get('usage');
  $('usageToday').textContent = t('todayUsage', String(minutesOf(normalizeUsage(usage, new Date()).seconds)));
  await renderRules(s);
}

async function init() {
  applyI18n();
  wireBrandLinks();
  document.title = t('optionsTitle');
  bundled = await (await fetch(chrome.runtime.getURL('config/selectors.json'))).json();

  $('enabled').addEventListener('change', async (e) => render(await setSetting('enabled', e.target.checked)));
  $('scheduleEnabled').addEventListener('change', async (e) => render(await setSetting('schedule.enabled', e.target.checked)));
  for (const id of ['scheduleFrom', 'scheduleTo']) {
    $(id).addEventListener('change', async (e) => {
      if (parseTime(e.target.value) === null) return;
      render(await setSetting(id === 'scheduleFrom' ? 'schedule.from' : 'schedule.to', e.target.value));
    });
  }
  $('reminderEnabled').addEventListener('change', async (e) => render(await setSetting('reminder.enabled', e.target.checked)));
  $('reminderMinutes').addEventListener('change', async (e) => {
    const n = Math.round(Number(e.target.value));
    if (!Number.isFinite(n) || n < 5 || n > 1440) {
      e.target.value = String((await getSettings()).reminder.minutes);
      return;
    }
    render(await setSetting('reminder.minutes', n));
  });
  $('remoteEnabled').addEventListener('change', async (e) => {
    const s = await setSetting('remoteEnabled', e.target.checked);
    await render(s);
    if (s.remoteEnabled) $('checkNow').click();
  });
  $('checkNow').addEventListener('click', async () => {
    const btn = $('checkNow');
    btn.disabled = true;
    $('remoteStatus').textContent = t('checking');
    await chrome.runtime.sendMessage({ type: 'yc:checkRemote' }).catch(() => null);
    await render();
  });
  $('reset').addEventListener('click', async () => {
    await saveSettings(defaultSettings());
    await chrome.storage.local.remove(['health', 'remoteConfig', 'remoteStatus']);
    await render();
    $('resetMsg').textContent = t('resetDone');
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.settings || changes.remoteStatus || changes.health)) render();
  });
  await render();
  document.body.dataset.ready = '1';
}

init();
