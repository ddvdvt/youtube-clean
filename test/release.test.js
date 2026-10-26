// Release checks: brand-site links, manifest fields required by the Chrome Web Store,
// locales, permissions actually used by the code, no remote code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE, SLUG, brandUrls, welcomeUrlFor } from '../extension/lib/brand.js';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const read = (p) => readFileSync(join(EXT, p), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const LOCALES = readdirSync(join(EXT, '_locales'));

/** @returns {string[]} */
function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(EXT);
const code = files.filter((f) => /\.(js|html)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');

/** Which code proves that a permission is used. */
const USAGE = {
  storage: /chrome\.storage\.local\./,
  alarms: /chrome\.alarms\.create\(/,
};

test('brand URLs are built from one BASE', () => {
  assert.equal(SLUG, 'youtube-clean');
  assert.match(BASE, /^https:\/\/.+\/$/);
  const u = brandUrls();
  assert.equal(u.welcome, `${BASE}welcome/youtube-clean.html`);
  assert.equal(u.bye, `${BASE}bye/youtube-clean.html`);
  assert.equal(u.privacy, `${BASE}privacy/youtube-clean.html`);
  assert.equal(u.other, `${BASE}#youtube-clean`);
  assert.equal(brandUrls('https://a.example/site', 'x').welcome, 'https://a.example/site/welcome/x.html');
});

test('welcome page opens only on a fresh install', () => {
  assert.equal(welcomeUrlFor('install'), `${BASE}welcome/youtube-clean.html`);
  for (const r of ['update', 'chrome_update', 'shared_module_update', undefined]) assert.equal(welcomeUrlFor(r), null);
});

test('service worker wires the welcome and uninstall pages', () => {
  const sw = read(manifest.background.service_worker);
  assert.match(sw, /from '\.\.\/lib\/brand\.js'/);
  assert.match(sw, /welcomeUrlFor\(details/);
  assert.match(sw, /setUninstallURL\(brandUrls\(\)\.bye\)/);
});

test('"other extensions" links go to the brand site, no placeholders left', () => {
  for (const f of files.filter((x) => x.endsWith('.html'))) {
    const html = readFileSync(f, 'utf8');
    assert.ok(!html.includes('https://github.com/'), `${f} still links to the github.com placeholder`);
    for (const m of html.matchAll(/<a [^>]*data-i18n="otherExtensions"[^>]*>/g)) assert.match(m[0], /data-brand-link="other"/, f);
  }
});

test('manifest: CWS fields', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.homepage_url, BASE, 'homepage_url must equal BASE from lib/brand.js');
  assert.equal(manifest.default_locale, 'ru');
  assert.equal(manifest.content_security_policy, undefined, 'default CSP');
  for (const size of ['16', '32', '48', '128']) {
    const png = readFileSync(join(EXT, manifest.icons[size]));
    assert.equal(png.readUInt32BE(16), Number(size), `icon ${size} width`);
    assert.equal(png.readUInt32BE(20), Number(size), `icon ${size} height`);
  }
});

test('manifest: every permission is used by the code', () => {
  assert.deepEqual([...manifest.permissions].sort(), Object.keys(USAGE).sort());
  for (const p of manifest.permissions) assert.match(code, USAGE[p], `permission ${p} unused`);
  // host access only to the desktop site, the same list everywhere
  assert.deepEqual(manifest.host_permissions, ['https://www.youtube.com/*']);
  assert.deepEqual(manifest.content_scripts[0].matches, manifest.host_permissions);
  assert.deepEqual(manifest.web_accessible_resources[0].matches, manifest.host_permissions);
  assert.equal(manifest.optional_host_permissions, undefined);
  assert.equal(manifest.optional_permissions, undefined);
  assert.equal(manifest.content_scripts[0].run_at, 'document_start');
  assert.equal(manifest.content_scripts[0].all_frames, false, 'embeds and iframes are left alone');
});

test('locales: ru and en complete, CWS length limits', () => {
  assert.deepEqual(LOCALES.sort(), ['en', 'ru']);
  const all = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(read(`_locales/${l}/messages.json`))]));
  const keys = Object.keys(all.ru).sort();
  const used = new Set([...code.matchAll(/data-i18n(?:-[a-z-]+)?="([A-Za-z0-9_]+)"/g), ...code.matchAll(/\bt\('([A-Za-z0-9_]+)'[,)]/g)].map((m) => m[1]));
  for (const m of JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) used.add(m[1]);
  for (const l of LOCALES) {
    assert.deepEqual(Object.keys(all[l]).sort(), keys, `${l} keys`);
    for (const k of used) assert.ok(all[l][k], `${l}: missing ${k}`);
    assert.ok([...all[l].extName.message].length <= 75, `${l} name too long`);
    assert.ok([...all[l].extShortName.message].length <= 12, `${l} short_name too long`);
    assert.ok([...all[l].extDescription.message].length <= 132, `${l} description too long`);
  }
});

test('no remote code, eval or debug leftovers', () => {
  for (const f of files.filter((x) => /\.(js|html)$/.test(x))) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/<script[^>]+src="https?:/.test(src), `${f}: remote script`);
    assert.ok(!/\beval\(|new Function\(|debugger;/.test(src), `${f}: eval/debugger`);
    assert.ok(!/console\.log\(/.test(src), `${f}: console.log`);
    assert.ok(!/\b(TODO|FIXME)\b/.test(src) || f.endsWith('brand.js'), `${f}: TODO left`);
  }
});

test('network: the only remote URL the code fetches is the signed rules file', () => {
  const fetches = [...code.matchAll(/\bfetch\(([^,\n]+)/g)].map((m) => m[1].trim());
  for (const f of fetches) assert.ok(/^(chrome\.runtime\.getURL\(|brandUrls\(\)\.rules)/.test(f), `unexpected fetch(${f})`);
  assert.ok(fetches.some((f) => f.startsWith('brandUrls().rules')));
  const content = read('src/content/main.js') + read('src/content/loader.js');
  assert.ok(!/https?:\/\//.test(content.replace(/^\s*\/\/.*$/gm, '')), 'content scripts contain no remote URLs');
  assert.equal(brandUrls().rules, `${BASE}rules/youtube-clean/selectors.signed.json`);
});

test('background fetches the rules without cookies and verifies them before storing', () => {
  const sw = read(manifest.background.service_worker);
  assert.match(sw, /credentials: 'omit'/);
  assert.match(sw, /verifyEnvelope\(/);
  assert.ok(sw.indexOf('verifyEnvelope(') < sw.indexOf('remoteConfig: {'), 'verify before store');
});
