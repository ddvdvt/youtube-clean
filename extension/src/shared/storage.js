// chrome.storage.local wrappers and small UI builders shared by the popup and the options page.
import { normalizeSettings, withSetting, applyPreset } from '../../lib/settings.js';

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return normalizeSettings(settings);
}

/** Set one dotted path ("features.shorts", "schedule.from", "enabled") and save. */
export async function setSetting(path, value) {
  const next = withSetting(await getSettings(), path, value);
  await chrome.storage.local.set({ settings: next });
  return next;
}

/** @param {import('../../lib/settings.js').PresetId} id */
export async function setPreset(id) {
  const next = applyPreset(await getSettings(), id);
  await chrome.storage.local.set({ settings: next });
  return next;
}

export async function saveSettings(settings) {
  const next = normalizeSettings(settings);
  await chrome.storage.local.set({ settings: next });
  return next;
}

/**
 * A labelled switch row bound to a feature.
 * @param {string} feature
 * @param {boolean} checked
 * @param {(k: string, s?: any) => string} t
 * @param {(checked: boolean) => void} onChange
 */
export function featureSwitch(feature, checked, t, onChange) {
  const label = document.createElement('label');
  label.className = 'switch-row';
  const text = document.createElement('span');
  const title = document.createElement('span');
  title.textContent = t(`feat_${feature}`);
  const small = document.createElement('small');
  small.textContent = t(`featDesc_${feature}`);
  text.append(title, small);
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'switch';
  input.id = `f-${feature}`;
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  label.append(text, input);
  return label;
}

/**
 * Preset buttons (a radio-like group of toggle buttons).
 * @param {HTMLElement} container
 * @param {string[]} ids
 * @param {string | null} current
 * @param {(k: string, s?: any) => string} t
 * @param {(id: string) => void} onPick
 */
export function renderPresets(container, ids, current, t, onPick) {
  container.textContent = '';
  for (const id of ids) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset';
    b.dataset.preset = id;
    b.setAttribute('aria-pressed', String(id === current));
    b.title = t(`presetDesc_${id}`);
    b.textContent = t(`preset_${id}`);
    b.addEventListener('click', () => onPick(id));
    container.appendChild(b);
  }
}

/** "HH:MM" of a Date in the local time zone. @param {Date} d */
export const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
