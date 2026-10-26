// Firefox build: manifest transform and package contents (scripts/firefox.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firefoxManifest, firefoxFiles, MIN_FIREFOX, SLUG } from '../scripts/firefox.mjs';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const chrome = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
const ff = firefoxManifest(chrome);

test('Firefox manifest: event page instead of the service worker, same module', () => {
  assert.deepEqual(ff.background, { scripts: [chrome.background.service_worker], type: 'module' });
});

test('Firefox manifest: gecko id, minimum version, AMO data collection = none', () => {
  assert.deepEqual(ff.browser_specific_settings, {
    gecko: { id: `${SLUG}@ddvdvt.github.io`, strict_min_version: MIN_FIREFOX, data_collection_permissions: { required: ['none'] } },
    gecko_android: { strict_min_version: '142.0' },
  });
  assert.ok(Number.parseFloat(MIN_FIREFOX) >= 140, 'data_collection_permissions needs Firefox 140+');
});

test('Firefox manifest: only Chrome-only keys change; permissions, content script and web-accessible files as in Chrome', () => {
  assert.equal(ff.minimum_chrome_version, undefined);
  assert.equal(ff.content_security_policy, undefined, 'default CSP');
  for (const k of ['name', 'version', 'default_locale', 'icons', 'action', 'options_ui', 'homepage_url', 'permissions', 'host_permissions', 'content_scripts', 'web_accessible_resources']) assert.deepEqual(ff[k], chrome[k], k);
  const copy = structuredClone(chrome);
  firefoxManifest(copy);
  assert.deepEqual(copy, chrome, 'the Chrome manifest object is not modified');
});

test('Firefox package: the same files, with the Firefox manifest', () => {
  const files = firefoxFiles();
  const packed = JSON.parse(new TextDecoder().decode(files.find((f) => f.name === 'manifest.json').data));
  assert.deepEqual(packed, ff);
  for (const f of files.filter((x) => x.name !== 'manifest.json')) {
    assert.deepEqual(Buffer.from(f.data), readFileSync(join(EXT, ...f.name.split('/'))), f.name);
  }
});
