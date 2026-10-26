// E2E in real Firefox: the Firefox build (scripts/firefox.mjs) in a fresh temporary profile, run
// against the LOCAL fixture pages (e2e/fixtures/site.mjs) that mimic the YouTube desktop DOM — the
// same flows as e2e/smoke.mjs, driven by puppeteer-core over WebDriver BiDi. The real site is never
// contacted.
//
// Test-only changes in the temporary copy (never in the real manifest): host_permissions /
// content_scripts / web_accessible_resources also match http://127.0.0.1/*; lib/brand.js BASE points
// at the local server (welcome page, signed rules file). Firefox-only check: access to youtube.com
// withheld by the user → the popup explains it and asks again.
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { route } from './fixtures/site.mjs';
import { writeUnpacked, SLUG } from '../scripts/firefox.mjs';
import { startFirefox } from './firefox-harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
let skipped = 0;
async function step(name, fn) {
  const r = await fn();
  if (r === 'skip') {
    skipped++;
    console.log(`skip - ${name}`);
    return;
  }
  passed++;
  console.log(`ok - ${name}`);
}

// Signed rules (see e2e/smoke.mjs): with the author's key a NEWER config is signed; otherwise a file
// with a broken signature is served and must be rejected. Verified in Firefox with WebCrypto ECDSA.
const bundled = JSON.parse(readFileSync(join(ROOT, 'extension', 'config', 'selectors.json'), 'utf8'));
const KEY = join(ROOT, 'keys', 'rules-signing.pem');
const hasKey = existsSync(KEY);
let rulesBody = '';
{
  const v2 = structuredClone(bundled);
  v2.version = bundled.version + 1;
  v2.rules.ads.hide.push('ytd-watch-metadata .desc');
  const config = JSON.stringify(v2);
  const signature = hasKey
    ? sign('sha256', Buffer.from(config), { key: createPrivateKey(readFileSync(KEY)), dsaEncoding: 'ieee-p1363' }).toString('base64')
    : Buffer.alloc(64, 1).toString('base64');
  rulesBody = JSON.stringify({ format: 1, version: v2.version, config, signature });
}
let rulesServed = 0;

const server = createServer(async (req, res) => {
  try {
    const path = (req.url || '/').split('?')[0];
    if (path === '/brand/rules/youtube-clean/selectors.signed.json') {
      rulesServed++;
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(rulesBody);
      return;
    }
    if (path.startsWith('/brand/')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><title>brand ${path}</title>`);
      return;
    }
    const r = await route(req.url || '/');
    if (!r) throw new Error('404');
    res.writeHead(200, { 'content-type': r.type || 'text/html; charset=utf-8' });
    res.end(r.body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = /** @type {any} */ (server.address()).port;
const O = `http://127.0.0.1:${port}`;

const work = await mkdtemp(join(tmpdir(), `${SLUG}-ff-e2e-`));
const extDir = writeUnpacked(join(work, 'extension'));
const manifest = JSON.parse(await readFile(join(extDir, 'manifest.json'), 'utf8'));
const local = ['http://127.0.0.1/*'];
manifest.host_permissions = [...manifest.host_permissions, ...local];
manifest.content_scripts[0].matches = [...manifest.content_scripts[0].matches, ...local];
manifest.web_accessible_resources[0].matches = [...manifest.web_accessible_resources[0].matches, ...local];
await writeFile(join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
const brandBase = `${O}/brand/`;
const brandFile = join(extDir, 'lib', 'brand.js');
const brandSrc = await readFile(brandFile, 'utf8');
const patchedBrand = brandSrc.replace(/export const BASE = '[^']*';/, `export const BASE = '${brandBase}';`);
assert.notEqual(patchedBrand, brandSrc, 'BASE constant found in lib/brand.js');
await writeFile(brandFile, patchedBrand);

const ff = await startFirefox({ extDir, addonId: manifest.browser_specific_settings.gecko.id });

/** Visible = rendered with a box (like Playwright's isVisible). */
const visible = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}, sel);
const isHidden = async (page, sel) => !(await visible(page, sel));
const waitHidden = (page, sel) => ff.waitFor(page, (s) => {
  const el = document.querySelector(s);
  return !el || el.getClientRects().length === 0 || getComputedStyle(el).visibility === 'hidden';
}, sel, 5000);
const waitVisible = (page, sel) => ff.waitFor(page, (s) => {
  const el = document.querySelector(s);
  return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}, sel, 5000);
const visibleCount = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((el) => el.getClientRects().length > 0).length, sel);
const attr = (page, sel, name) => page.$eval(sel, (el, n) => el.getAttribute(n), name);
const text = (page, sel) => page.$eval(sel, (el) => el.textContent);
const checked = (page, sel) => page.$eval(sel, (el) => el.checked);
/** Poll the address (redirects may abort an earlier navigation). */
async function waitUrl(page, want, timeout = 10000) {
  const ok = (u) => (want instanceof RegExp ? want.test(u) : u === want);
  let u = '';
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(100)) {
    u = await page.evaluate(() => location.href).catch(() => '');
    if (ok(u)) return;
  }
  throw new Error(`URL is ${u}, expected ${want}`);
}
const settled = (page) => ff.waitFor(page, () => document.getElementById('yc-declutter-style') !== null, undefined, 10000);
const goto = async (page, url) => {
  await page.goto(url, { waitUntil: 'load' }).catch(() => {}); // a redirect may abort the first navigation
};

let exitCode = 0;
try {
  const { bg } = ff;
  const storage = (keys) => bg((b, k) => b.chrome.storage.local.get(k), keys);
  const patchSettings = (patch) =>
    bg(async (b, p) => {
      const { settings } = await b.chrome.storage.local.get('settings');
      await b.chrome.storage.local.set({ settings: { ...settings, ...p } });
    }, patch);

  await step('fresh install opens the welcome page; settings are initialised', async () => {
    const found = await ff.findPage((u) => u === `${brandBase}welcome/youtube-clean.html`, 15000);
    assert.ok(found, 'welcome tab opened');
    await found.close();
    const { settings } = await storage('settings');
    assert.equal(settings.enabled, true);
    assert.equal(settings.features.shorts, true);
    assert.equal(settings.remoteEnabled, false);
  });

  const page = await ff.browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await goto(page, `${O}/`);
  await settled(page);

  await step('home (default Focus): feed, chips, Shorts entry, Explore, masthead ad hidden; calm message shown', async () => {
    await waitHidden(page, '[data-t="home-grid"]');
    for (const s of ['home-chips', 'guide-shorts', 'guide-explore', 'masthead-ad']) assert.ok(await isHidden(page, `[data-t="${s}"]`), s);
    for (const s of ['guide-home', 'guide-subs', 'guide-you']) assert.ok(await visible(page, `[data-t="${s}"]`), s);
    const msg = await page.evaluate(() => getComputedStyle(document.querySelector('ytd-browse #primary'), '::before').content);
    assert.match(msg, /Рекомендации на главной скрыты/);
  });

  const tabId = await bg(async (b, url) => (await b.chrome.tabs.query({})).find((t) => t.url === url)?.id, `${O}/`);
  assert.ok(tabId, 'fixture tab found');
  const popup = await ff.browser.newPage();
  const openPopup = async () => {
    await ff.navigate(popup, `${ff.base}src/popup/popup.html?tabId=${tabId}`);
    await ff.waitFor(popup, () => document.body.dataset.ready === '1', undefined, 10000);
  };
  await openPopup();
  /** Input goes to the foreground tab: bring the popup tab forward, then click. */
  const pclick = async (sel) => {
    await ff.front(popup);
    await popup.click(sel);
  };

  await step('popup: Focus preset active, counter for the tab, brand link, access to youtube.com granted', async () => {
    assert.equal(await attr(popup, '[data-preset="focus"]', 'aria-pressed'), 'true');
    assert.equal(await attr(popup, '[data-preset="minimal"]', 'aria-pressed'), 'false');
    assert.match(await text(popup, '#tabStatus'), /Скрыто на этой странице: \d+/);
    assert.ok(Number(await attr(popup, '#tabStatus', 'data-total')) >= 5);
    assert.equal(await checked(popup, '#f-shorts'), true);
    assert.equal(await checked(popup, '#f-comments'), false);
    assert.equal(await attr(popup, 'a[data-brand-link]', 'href'), `${brandBase}#youtube-clean`);
    assert.ok(await isHidden(popup, '#stale'));
    assert.ok(await isHidden(popup, '#access'));
  });

  await step('popup "Минимум": recommendations come back, Shorts / ads / games stay hidden', async () => {
    await pclick('[data-preset="minimal"]');
    await waitVisible(page, '[data-t="home-grid"]');
    assert.ok(await visible(page, '[data-t="feed-item"]'));
    for (const s of ['home-shorts', 'feed-ad', 'home-playables', 'guide-shorts', 'guide-explore']) assert.ok(await isHidden(page, `[data-t="${s}"]`), s);
    assert.equal(await attr(popup, '[data-preset="minimal"]', 'aria-pressed'), 'true');
    assert.equal(await checked(popup, '#f-related'), false);
  });

  await step('watch (Минимум): sidebar visible; Focus via popup hides sidebar, end screens, cards; autoplay switched off', async () => {
    await goto(page, `${O}/watch?v=v2bbbbbbbbb`);
    await settled(page);
    assert.ok(await visible(page, '[data-t="related"]'));
    assert.ok(await visible(page, '[data-t="endscreen"]'));
    assert.equal(await attr(page, '[data-t="autonav"]', 'aria-checked'), 'true', 'autoplay untouched in Минимум');
    assert.ok(await isHidden(page, '[data-t="related-shorts"]'), 'Shorts shelf in the sidebar hidden');
    assert.ok(await isHidden(page, '[data-t="player-ads"]'));
    assert.ok(await isHidden(page, '[data-t="merch"]'));
    await pclick('[data-preset="focus"]');
    await waitHidden(page, '[data-t="related"]');
    for (const s of ['endscreen', 'ce-1', 'ce-2', 'cards-teaser', 'fs-grid']) assert.ok(await isHidden(page, `[data-t="${s}"]`), s);
    await ff.waitFor(page, () => document.querySelector('[data-t="autonav"]').getAttribute('aria-checked') === 'false', undefined, 5000);
    await sleep(2500); // past the fixture player's own init, which turns autoplay back on
    assert.equal(await attr(page, '[data-t="autonav"]', 'aria-checked'), 'false', 'still off after player init');
    assert.ok(await visible(page, '[data-t="comments"]'), 'comments stay by default');
    assert.ok(await visible(page, '.html5-video-player'), 'the player itself is never hidden');
  });

  await step('autoplay: the user can switch it back on for this video', async () => {
    await ff.front(page);
    await page.click('[data-t="autonav"]');
    await sleep(1500);
    assert.equal(await attr(page, '[data-t="autonav"]', 'aria-checked'), 'true');
  });

  await step('popup toggle hides comments instantly', async () => {
    await pclick('label:has(#f-comments)');
    await waitHidden(page, '[data-t="comments"]');
    await pclick('label:has(#f-comments)');
    await waitVisible(page, '[data-t="comments"]');
  });

  await step('rule health: probes on the watch page are recorded as hits', async () => {
    let health = null;
    for (let i = 0; i < 40; i++) {
      health = (await storage('health')).health;
      if (health && health.records['related:watch']) break;
      await sleep(250);
    }
    assert.equal(health.configVersion, bundled.version);
    for (const k of ['related:watch', 'comments:watch', 'endscreen:watch', 'autoplayOff:watch']) {
      assert.ok(health.records[k], k);
      assert.equal(health.records[k].misses, 0, k);
      assert.ok(health.records[k].lastHit > 0, k);
    }
  });

  await step('search: Shorts shelf, single Shorts result and promoted slot hidden; videos visible', async () => {
    await goto(page, `${O}/results?search_query=${encodeURIComponent('ремонт велосипеда')}`);
    await settled(page);
    for (const s of ['search-shorts', 'search-short', 'search-ad']) await waitHidden(page, `[data-t="${s}"]`);
    assert.equal(await visibleCount(page, '[data-t="search-video"]'), 4);
  });

  await step('channel: Shorts tab and shelf hidden, videos visible', async () => {
    await goto(page, `${O}/@gory-ryadom`);
    await settled(page);
    await waitHidden(page, '[data-t="channel-shorts-tab"]');
    assert.ok(await isHidden(page, '[data-t="channel-shorts"]'));
    assert.equal(await visibleCount(page, 'yt-tab-shape'), 5);
    assert.ok(await visible(page, '[data-t="channel-video"]'));
  });

  await step('subscriptions: Shorts shelf hidden, videos visible', async () => {
    await goto(page, `${O}/feed/subscriptions`);
    await settled(page);
    await waitHidden(page, '[data-t="subs-shorts"]');
    assert.ok(await visible(page, '[data-t="feed-item"]'));
  });

  await step('Shorts open in the normal player: direct link, in-app navigation and link clicks', async () => {
    await goto(page, `${O}/shorts/s1aaaaaaaaa`);
    await waitUrl(page, `${O}/watch?v=s1aaaaaaaaa`);
    await settled(page);
    await page.evaluate(() => void window.__spaNavigate('/shorts/s2bbbbbbbbb')).catch(() => {});
    await waitUrl(page, `${O}/watch?v=s2bbbbbbbbb`);
    await goto(page, `${O}/results?search_query=x`);
    await settled(page);
    await page.evaluate(() => void document.querySelector('[data-t="search-short"] a').click()).catch(() => {});
    await waitUrl(page, /\/watch\?v=s3ccccccccc$/);
  });

  await step('"Только подписки": home opens Subscriptions (address bar and logo click)', async () => {
    await pclick('[data-preset="subscriptions"]');
    await sleep(300);
    await goto(page, `${O}/`);
    await waitUrl(page, `${O}/feed/subscriptions`);
    await goto(page, `${O}/watch?v=v1aaaaaaaaa`);
    await settled(page);
    await ff.front(page);
    await page.click('#logo');
    await waitUrl(page, `${O}/feed/subscriptions`);
  });

  await step('master switch: paused extension shows the page as is', async () => {
    await pclick('[data-preset="focus"]');
    await goto(page, `${O}/watch?v=v1aaaaaaaaa`);
    await settled(page);
    await waitHidden(page, '[data-t="related"]');
    await pclick('label.master');
    await waitVisible(page, '[data-t="related"]');
    assert.ok(await visible(page, '[data-t="endscreen"]'));
    assert.ok(await visible(popup, '#paused'));
    await pclick('label.master');
    await waitHidden(page, '[data-t="related"]');
  });

  await step('focus schedule adds Focus on top of "Минимум" and the popup says until when', async () => {
    await pclick('[data-preset="minimal"]');
    await waitVisible(page, '[data-t="related"]');
    await patchSettings({ schedule: { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59' } });
    await waitHidden(page, '[data-t="related"]');
    await openPopup();
    assert.match(await text(popup, '#focusStatus'), /Фокус по расписанию до 23:59/);
    assert.equal(await attr(popup, '[data-preset="minimal"]', 'aria-pressed'), 'true', 'the saved preset itself is unchanged');
    await patchSettings({ schedule: { enabled: false, days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' } });
    await waitVisible(page, '[data-t="related"]');
    await pclick('[data-preset="focus"]');
  });

  await step('stale rule warning in the popup; "turn on rule updates" downloads the signed file (WebCrypto ECDSA in Firefox)', async () => {
    const old = Date.now() - 3 * 3600 * 1000;
    await bg(
      async (b, v, t) => {
        const { health } = await b.chrome.storage.local.get('health');
        health.records['shorts:home'] = { misses: 6, firstMissAt: t, lastHit: t - 1000, lastCheck: t + 60000 };
        health.configVersion = v;
        await b.chrome.storage.local.set({ health });
      },
      bundled.version,
      old,
    );
    await openPopup();
    await waitVisible(popup, '#stale');
    assert.match(await text(popup, '#staleText'), /Скрыть Shorts/);
    assert.equal((await text(popup, '#staleAction')).trim(), 'Включить обновление правил');
    await pclick('#staleAction');
    let status = null;
    for (let i = 0; i < 40 && !status; i++) {
      status = (await storage('remoteStatus')).remoteStatus;
      if (!status) await sleep(250);
    }
    assert.ok(rulesServed >= 1, 'rules file requested from the brand site');
    assert.equal((await storage('settings')).settings.remoteEnabled, true);
    assert.ok(await bg(async (b) => !!(await b.chrome.alarms.get('yc-rules-update'))), 'daily alarm scheduled');
    if (!hasKey) {
      assert.deepEqual([status.ok, status.error], [false, 'bad signature']);
      assert.equal((await storage('remoteConfig')).remoteConfig, undefined, 'unsigned data is never stored');
      return;
    }
    assert.equal(status.ok, true, JSON.stringify(status));
    assert.equal(status.version, bundled.version + 1);
    assert.equal(status.newer, true);
    await waitHidden(page, 'ytd-watch-metadata .desc');
    await openPopup();
    assert.ok(await isHidden(popup, '#stale'), 'new rules → fresh health, no warning');
  });

  await step('a tampered signed file is rejected in Firefox too', async () => {
    const saved = rulesBody;
    const env = JSON.parse(rulesBody);
    env.config = env.config.replace('"version":', '"tampered":true,"version":');
    rulesBody = JSON.stringify(env);
    try {
      const r = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'yc:checkRemote' }));
      assert.equal(r.ok, false);
      assert.match(r.error, /signature/);
    } finally {
      rulesBody = saved;
    }
    if (hasKey) {
      const r = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'yc:checkRemote' }));
      assert.equal(r.ok, true, 'the genuine file is accepted again');
    }
  });

  await step('options page: presets, schedule, rules status, health list', async () => {
    const version = hasKey ? bundled.version + 1 : bundled.version;
    await page.reload({ waitUntil: 'load' });
    await settled(page);
    for (let i = 0; i < 40; i++) {
      const { health } = await storage('health');
      if (health && health.configVersion === version && health.records['related:watch']) break;
      await sleep(250);
    }
    const opt = await ff.open('src/options/options.html');
    await ff.waitFor(opt, () => document.body.dataset.ready === '1');
    assert.equal(await attr(opt, '.preset-card[data-preset="focus"]', 'aria-pressed'), 'true');
    assert.equal((await opt.$$('#gShorts .switch-row, #gRecs .switch-row, #gOther .switch-row')).length, 12);
    assert.equal((await opt.$$('#days input')).length, 7);
    assert.match(await text(opt, '#rulesBundled'), new RegExp(`версия ${bundled.version}`));
    if (hasKey) assert.match(await text(opt, '#rulesActive'), new RegExp(`версия ${bundled.version + 1}`));
    assert.ok((await opt.$$('#health li')).length >= 6);
    assert.match(await text(opt, '#health li[data-feature="related"]'), /работает/);
    await ff.front(opt);
    await opt.focus('#f-comments');
    await opt.keyboard.press(' ');
    await waitHidden(page, '[data-t="comments"]');
    assert.equal(await opt.evaluate(() => document.activeElement && document.activeElement.id), 'f-comments');
    await opt.keyboard.press(' ');
    await waitVisible(page, '[data-t="comments"]');
    await opt.click('label:has(#scheduleEnabled)');
    await opt.$eval('#scheduleFrom', (el) => {
      el.value = '08:30';
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await ff.waitFor(opt, async () => (await chrome.storage.local.get('settings')).settings.schedule.from === '08:30');
    assert.notEqual((await text(opt, '#scheduleStatus')).trim(), '');
    await opt.click('label:has(#scheduleEnabled)');
    await opt.click('label:has(#remoteEnabled)');
    await ff.waitFor(opt, async () => (await chrome.storage.local.get('remoteConfig')).remoteConfig === undefined);
    assert.equal(await bg(async (b) => !!(await b.chrome.alarms.get('yc-rules-update'))), false, 'alarm cleared');
    if (hasKey) await waitVisible(page, 'ytd-watch-metadata .desc');
    await opt.close();
  });

  await step('daily reminder appears once the limit is reached', async () => {
    await patchSettings({ reminder: { enabled: true, minutes: 5 } });
    await bg(async (b) => {
      const d = new Date();
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      await b.chrome.storage.local.set({ usage: { day, seconds: 299, remindedDay: '' } });
    });
    await ff.front(page);
    await goto(page, `${O}/watch?v=v3ccccccccc`);
    await settled(page);
    await sleep(2500);
    assert.equal(await attr(page, '[data-t="autonav"]', 'aria-checked'), 'false', 'autoplay re-disabled after player init');
    await ff.waitFor(page, () => !!document.getElementById('yc-declutter-toast'), undefined, 40000);
    const t = await page.evaluate(() => document.getElementById('yc-declutter-toast').shadowRoot.textContent);
    assert.match(t, /Сегодня вы уже 5 мин на YouTube/);
    const { usage } = await storage('usage');
    assert.equal(usage.remindedDay, usage.day);
  });

  await step('Firefox: access to the site withheld → popup explains it and offers "Allow"; the page stays as is', async () => {
    assert.equal(await popup.evaluate(() => chrome.permissions.remove({ origins: ['http://127.0.0.1/*', 'https://www.youtube.com/*'] })), true);
    await goto(page, `${O}/watch?v=v1aaaaaaaaa`);
    await sleep(800);
    assert.equal(await page.evaluate(() => document.getElementById('yc-declutter-style')), null, 'no content script without access');
    assert.ok(await visible(page, '[data-t="related"]'));
    await openPopup();
    assert.ok(await visible(popup, '#access'), 'access message shown');
    assert.match(await text(popup, '#access'), /нет доступа к youtube\.com/);
    // a real click: Firefox accepts the request and shows its own prompt (not automatable here);
    // without user input it would be rejected at once and "not granted" would appear
    await pclick('#grantAccess');
    await sleep(1500);
    assert.equal(await text(popup, '#accessMsg'), '', 'request pending on the Firefox prompt');
  });

  await step('no errors in the background, pages, popup or options', async () => {
    assert.deepEqual(await ff.errors(), []);
  });
} catch (e) {
  exitCode = 1;
  console.error('FAILED:', e && e.stack ? e.stack : e);
  console.error('collected errors:', await ff.errors().catch(() => []));
} finally {
  await ff.close();
  server.close();
  await rm(work, { recursive: true, force: true }).catch(() => {});
}
console.log(`\n${passed} passed, ${skipped} skipped${exitCode ? ', FAILED' : ''}`);
process.exit(exitCode);
