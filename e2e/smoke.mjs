// E2E smoke test: load the unpacked extension into the locally installed Chromium and run it
// against LOCAL fixture pages (e2e/fixtures/site.mjs) that mimic the YouTube desktop DOM.
// The real site is never contacted.
//
// Test-only changes, made in a temporary copy of the extension (never in the real manifest):
//  - host_permissions / content_scripts / web_accessible_resources also match http://127.0.0.1/*;
//  - lib/brand.js BASE points at this local server (welcome page, signed rules file).
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile, cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { route } from './fixtures/site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const exe =
  process.env.CHROMIUM_PATH ||
  join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1228', 'chrome-win64', 'chrome.exe');
if (!existsSync(exe)) {
  console.error(`Chromium not found at ${exe}. Set CHROMIUM_PATH.`);
  process.exit(1);
}

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

// Signed rules served by the fake brand site. With the author's key present (keys/, git-ignored)
// the test signs a NEWER config (version 2) to prove the whole update path; otherwise it serves
// a file with a broken signature, which must be rejected.
const bundled = JSON.parse(readFileSync(join(ROOT, 'extension', 'config', 'selectors.json'), 'utf8'));
const KEY = join(ROOT, 'keys', 'rules-signing.pem');
const hasKey = existsSync(KEY);
let rulesBody = '';
{
  const v2 = structuredClone(bundled);
  v2.version = bundled.version + 1;
  v2.rules.ads.hide.push('ytd-watch-metadata .desc'); // marker rule: only the downloaded config hides it
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
      res.writeHead(200, { 'content-type': 'application/json' });
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

const work = await mkdtemp(join(tmpdir(), 'youtube-clean-e2e-'));
const extDir = join(work, 'extension');
const profile = join(work, 'profile');
await cp(join(ROOT, 'extension'), extDir, { recursive: true });
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

const context = await chromium.launchPersistentContext(profile, {
  executablePath: exe,
  headless: false,
  locale: 'ru-RU',
  viewport: { width: 1280, height: 900 },
  args: [
    '--headless=new',
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--renderer-process-limit=2',
    '--lang=ru',
  ],
});

const errors = [];
const watchErrors = (p, label) => {
  p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && errors.push(`${label}: ${m.text()}`));
};
const isHidden = (page, sel) => page.locator(sel).first().isHidden();
const waitHidden = (page, sel) => page.locator(sel).first().waitFor({ state: 'hidden', timeout: 5000 });
const waitVisible = (page, sel) => page.locator(sel).first().waitFor({ state: 'visible', timeout: 5000 });
/** Poll the address (redirects may abort an earlier navigation, which waitForURL reports as an error). */
async function waitUrl(page, want, timeout = 10000) {
  const ok = (u) => (want instanceof RegExp ? want.test(u) : u === want);
  for (const end = Date.now() + timeout; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (ok(page.url())) return;
  throw new Error(`URL is ${page.url()}, expected ${want}`);
}
const settled = (page) => page.waitForFunction(() => document.getElementById('yc-declutter-style') !== null, null, { timeout: 10000 });

let exitCode = 0;
try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const storage = (keys) => sw.evaluate((k) => chrome.storage.local.get(k), keys);
  /** Shallow-merge top-level settings keys (schedule, reminder… as whole objects). */
  const patchSettings = (patch) =>
    sw.evaluate(async (p) => {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, ...p } });
    }, patch);

  await step('fresh install opens the welcome page; settings are initialised', async () => {
    const welcome = `${brandBase}welcome/youtube-clean.html`;
    let found = null;
    for (let i = 0; i < 50 && !found; i++) {
      found = context.pages().find((p) => p.url() === welcome);
      if (!found) await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(found, 'welcome tab opened');
    await found.close();
    const { settings } = await storage('settings');
    assert.equal(settings.enabled, true);
    assert.equal(settings.features.shorts, true);
    assert.equal(settings.remoteEnabled, false);
  });

  const page = await context.newPage();
  watchErrors(page, 'page');
  await page.goto(`${O}/`);
  await settled(page);

  await step('home (default Focus): feed, chips, Shorts entry, Explore, masthead ad hidden; calm message shown', async () => {
    await waitHidden(page, '[data-t="home-grid"]');
    for (const s of ['home-chips', 'guide-shorts', 'guide-explore', 'masthead-ad']) assert.ok(await isHidden(page, `[data-t="${s}"]`), s);
    for (const s of ['guide-home', 'guide-subs', 'guide-you']) assert.ok(await page.isVisible(`[data-t="${s}"]`), s);
    const msg = await page.evaluate(() => getComputedStyle(document.querySelector('ytd-browse #primary'), '::before').content);
    assert.match(msg, /Рекомендации на главной скрыты/);
  });

  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.id, `${O}/`);
  assert.ok(tabId, 'fixture tab found');
  const popup = await context.newPage();
  watchErrors(popup, 'popup');
  const openPopup = async () => {
    await popup.goto(`chrome-extension://${extId}/src/popup/popup.html?tabId=${tabId}`);
    await popup.waitForSelector('body[data-ready="1"]', { timeout: 10000 });
  };
  await openPopup();

  await step('popup: Focus preset active, counter for the tab, brand link', async () => {
    assert.equal(await popup.getAttribute('[data-preset="focus"]', 'aria-pressed'), 'true');
    assert.equal(await popup.getAttribute('[data-preset="minimal"]', 'aria-pressed'), 'false');
    assert.match(await popup.textContent('#tabStatus'), /Скрыто на этой странице: \d+/);
    assert.ok(Number(await popup.getAttribute('#tabStatus', 'data-total')) >= 5);
    assert.equal(await popup.isChecked('#f-shorts'), true);
    assert.equal(await popup.isChecked('#f-comments'), false);
    assert.equal(await popup.getAttribute('a[data-brand-link]', 'href'), `${brandBase}#youtube-clean`);
    assert.ok(await popup.isHidden('#stale'));
  });

  await step('popup "Минимум": recommendations come back, Shorts / ads / games stay hidden', async () => {
    await popup.click('[data-preset="minimal"]');
    await waitVisible(page, '[data-t="home-grid"]');
    assert.ok(await page.isVisible('[data-t="feed-item"]'));
    for (const s of ['home-shorts', 'feed-ad', 'home-playables', 'guide-shorts', 'guide-explore']) assert.ok(await isHidden(page, `[data-t="${s}"]`), s);
    assert.equal(await popup.getAttribute('[data-preset="minimal"]', 'aria-pressed'), 'true');
    assert.equal(await popup.isChecked('#f-related'), false);
  });

  await step('watch (Минимум): sidebar visible; Focus via popup hides sidebar, end screens, cards; autoplay switched off', async () => {
    await page.goto(`${O}/watch?v=v2bbbbbbbbb`);
    await settled(page);
    assert.ok(await page.isVisible('[data-t="related"]'));
    assert.ok(await page.isVisible('[data-t="endscreen"]'));
    assert.equal(await page.getAttribute('[data-t="autonav"]', 'aria-checked'), 'true', 'autoplay untouched in Минимум');
    assert.ok(await isHidden(page, '[data-t="related-shorts"]'), 'Shorts shelf in the sidebar hidden');
    assert.ok(await isHidden(page, '[data-t="player-ads"]'));
    assert.ok(await isHidden(page, '[data-t="merch"]'));
    await popup.click('[data-preset="focus"]');
    await waitHidden(page, '[data-t="related"]');
    for (const s of ['endscreen', 'ce-1', 'ce-2', 'cards-teaser', 'fs-grid']) assert.ok(await isHidden(page, `[data-t="${s}"]`), s);
    await page.waitForFunction(() => document.querySelector('[data-t="autonav"]').getAttribute('aria-checked') === 'false', null, { timeout: 5000 });
    await page.waitForTimeout(2500); // past the fixture player's own init, which turns autoplay back on
    assert.equal(await page.getAttribute('[data-t="autonav"]', 'aria-checked'), 'false', 'still off after player init');
    assert.ok(await page.isVisible('[data-t="comments"]'), 'comments stay by default');
    assert.ok(await page.isVisible('.html5-video-player'), 'the player itself is never hidden');
  });

  await step('autoplay: the user can switch it back on for this video', async () => {
    await page.click('[data-t="autonav"]');
    await page.waitForTimeout(1500);
    assert.equal(await page.getAttribute('[data-t="autonav"]', 'aria-checked'), 'true');
  });

  await step('popup toggle hides comments instantly', async () => {
    await popup.click('label:has(#f-comments)');
    await waitHidden(page, '[data-t="comments"]');
    await popup.click('label:has(#f-comments)');
    await waitVisible(page, '[data-t="comments"]');
  });

  await step('rule health: probes on the watch page are recorded as hits', async () => {
    let health = null;
    for (let i = 0; i < 40; i++) {
      health = (await storage('health')).health;
      if (health && health.records['related:watch']) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(health.configVersion, bundled.version);
    for (const k of ['related:watch', 'comments:watch', 'endscreen:watch', 'autoplayOff:watch']) {
      assert.ok(health.records[k], k);
      assert.equal(health.records[k].misses, 0, k);
      assert.ok(health.records[k].lastHit > 0, k);
    }
  });

  await step('search: Shorts shelf, single Shorts result and promoted slot hidden; videos visible', async () => {
    await page.goto(`${O}/results?search_query=${encodeURIComponent('ремонт велосипеда')}`);
    await settled(page);
    for (const s of ['search-shorts', 'search-short', 'search-ad']) await waitHidden(page, `[data-t="${s}"]`);
    assert.equal(await page.locator('[data-t="search-video"]:visible').count(), 4);
  });

  await step('channel: Shorts tab and shelf hidden, videos visible', async () => {
    await page.goto(`${O}/@gory-ryadom`);
    await settled(page);
    await waitHidden(page, '[data-t="channel-shorts-tab"]');
    assert.ok(await isHidden(page, '[data-t="channel-shorts"]'));
    assert.equal(await page.locator('yt-tab-shape:visible').count(), 5);
    assert.ok(await page.isVisible('[data-t="channel-video"]'));
  });

  await step('subscriptions: Shorts shelf hidden, videos visible', async () => {
    await page.goto(`${O}/feed/subscriptions`);
    await settled(page);
    await waitHidden(page, '[data-t="subs-shorts"]');
    assert.ok(await page.isVisible('[data-t="feed-item"]'));
  });

  await step('Shorts open in the normal player: direct link, in-app navigation and link clicks', async () => {
    await page.goto(`${O}/shorts/s1aaaaaaaaa`);
    await waitUrl(page, `${O}/watch?v=s1aaaaaaaaa`);
    await settled(page);
    await page.evaluate(() => void window.__spaNavigate('/shorts/s2bbbbbbbbb')).catch(() => {}); // the page leaves mid-call
    await waitUrl(page, `${O}/watch?v=s2bbbbbbbbb`);
    await page.goto(`${O}/results?search_query=x`);
    await settled(page);
    await page.evaluate(() => void document.querySelector('[data-t="search-short"] a').click()).catch(() => {});
    await waitUrl(page, /\/watch\?v=s3ccccccccc$/);
  });

  await step('"Только подписки": home opens Subscriptions (address bar and logo click)', async () => {
    await popup.click('[data-preset="subscriptions"]');
    await page.waitForTimeout(300);
    await page.goto(`${O}/`);
    await waitUrl(page, `${O}/feed/subscriptions`);
    await page.goto(`${O}/watch?v=v1aaaaaaaaa`);
    await settled(page);
    await page.click('#logo');
    await waitUrl(page, `${O}/feed/subscriptions`);
  });

  await step('master switch: paused extension shows the page as is', async () => {
    await popup.click('[data-preset="focus"]');
    await page.goto(`${O}/watch?v=v1aaaaaaaaa`);
    await settled(page);
    await waitHidden(page, '[data-t="related"]');
    await popup.click('label.master');
    await waitVisible(page, '[data-t="related"]');
    assert.ok(await page.isVisible('[data-t="endscreen"]'));
    assert.ok(await popup.isVisible('#paused'));
    await popup.click('label.master');
    await waitHidden(page, '[data-t="related"]');
  });

  await step('focus schedule adds Focus on top of "Минимум" and the popup says until when', async () => {
    await popup.click('[data-preset="minimal"]');
    await waitVisible(page, '[data-t="related"]');
    await patchSettings({ schedule: { enabled: true, days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59' } });
    await waitHidden(page, '[data-t="related"]');
    await openPopup();
    assert.match(await popup.textContent('#focusStatus'), /Фокус по расписанию до 23:59/);
    assert.equal(await popup.getAttribute('[data-preset="minimal"]', 'aria-pressed'), 'true', 'the saved preset itself is unchanged');
    await patchSettings({ schedule: { enabled: false, days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' } });
    await waitVisible(page, '[data-t="related"]');
    await popup.click('[data-preset="focus"]');
  });

  await step('stale rule warning in the popup; "turn on rule updates" downloads the signed file', async () => {
    const old = Date.now() - 3 * 3600 * 1000;
    await sw.evaluate(
      async ([v, t]) => {
        const { health } = await chrome.storage.local.get('health');
        health.records['shorts:home'] = { misses: 6, firstMissAt: t, lastHit: t - 1000, lastCheck: t + 60000 };
        health.configVersion = v;
        await chrome.storage.local.set({ health });
      },
      [bundled.version, old],
    );
    await openPopup();
    await waitVisible(popup, '#stale');
    assert.match(await popup.textContent('#staleText'), /Скрыть Shorts/);
    assert.equal((await popup.textContent('#staleAction')).trim(), 'Включить обновление правил');
    await popup.click('#staleAction');
    let status = null;
    for (let i = 0; i < 40 && !status; i++) {
      status = (await storage('remoteStatus')).remoteStatus;
      if (!status) await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(rulesServed >= 1, 'rules file requested from the brand site');
    assert.equal((await storage('settings')).settings.remoteEnabled, true);
    if (!hasKey) {
      assert.deepEqual([status.ok, status.error], [false, 'bad signature']);
      assert.equal((await storage('remoteConfig')).remoteConfig, undefined, 'unsigned data is never stored');
      return;
    }
    assert.equal(status.ok, true, JSON.stringify(status));
    assert.equal(status.version, bundled.version + 1);
    assert.equal(status.newer, true);
    // the downloaded (newer) config is applied to open pages; its version resets the health records
    await waitHidden(page, 'ytd-watch-metadata .desc');
    await openPopup();
    assert.ok(await popup.isHidden('#stale'), 'new rules → fresh health, no warning');
  });

  await step('options page: presets, schedule, rules status, health list; no errors', async () => {
    // health is kept per config version: re-open the watch page so the active rules get checked
    const version = hasKey ? bundled.version + 1 : bundled.version;
    await page.reload();
    await settled(page);
    await sw.evaluate(
      (v) =>
        new Promise((resolve) => {
          const done = async () => {
            const { health } = await chrome.storage.local.get('health');
            if (health && health.configVersion === v && health.records['related:watch']) resolve(true);
            else setTimeout(done, 250);
          };
          done();
        }),
      version,
    );
    const opt = await context.newPage();
    watchErrors(opt, 'options');
    await opt.goto(`chrome-extension://${extId}/src/options/options.html`);
    await opt.waitForSelector('body[data-ready="1"]');
    assert.equal(await opt.getAttribute('.preset-card[data-preset="focus"]', 'aria-pressed'), 'true');
    assert.equal(await opt.locator('#gShorts .switch-row, #gRecs .switch-row, #gOther .switch-row').count(), 12);
    assert.equal(await opt.locator('#days input').count(), 7);
    assert.match(await opt.textContent('#rulesBundled'), new RegExp(`версия ${bundled.version}`));
    if (hasKey) assert.match(await opt.textContent('#rulesActive'), new RegExp(`версия ${bundled.version + 1}`));
    assert.ok((await opt.locator('#health li').count()) >= 6);
    assert.match(await opt.textContent('#health li[data-feature="related"]'), /работает/);
    // keyboard: the comments switch toggles with Space and keeps focus after re-render
    await opt.focus('#f-comments');
    await opt.keyboard.press('Space');
    await waitHidden(page, '[data-t="comments"]');
    assert.equal(await opt.evaluate(() => document.activeElement && document.activeElement.id), 'f-comments');
    await opt.keyboard.press('Space');
    await waitVisible(page, '[data-t="comments"]');
    // schedule inputs are validated and saved
    await opt.click('label:has(#scheduleEnabled)');
    await opt.fill('#scheduleFrom', '08:30');
    await opt.locator('#scheduleFrom').dispatchEvent('change');
    await opt.waitForFunction(async () => (await chrome.storage.local.get('settings')).settings.schedule.from === '08:30');
    assert.notEqual((await opt.textContent('#scheduleStatus')).trim(), '');
    await opt.click('label:has(#scheduleEnabled)');
    // remote updates off → downloaded rules are dropped
    await opt.click('label:has(#remoteEnabled)');
    await opt.waitForFunction(async () => (await chrome.storage.local.get('remoteConfig')).remoteConfig === undefined);
    if (hasKey) await waitVisible(page, 'ytd-watch-metadata .desc');
    await opt.close();
  });

  await step('daily reminder appears once the limit is reached', async () => {
    await patchSettings({ reminder: { enabled: true, minutes: 5 } });
    await sw.evaluate(async () => {
      const d = new Date();
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      await chrome.storage.local.set({ usage: { day, seconds: 299, remindedDay: '' } });
    });
    await page.bringToFront();
    await page.goto(`${O}/watch?v=v3ccccccccc`);
    await settled(page);
    // the fixture player turns autoplay back on 1.2 s after load; the extension switches it off again
    await page.waitForTimeout(2500);
    assert.equal(await page.getAttribute('[data-t="autonav"]', 'aria-checked'), 'false', 'autoplay re-disabled after player init');
    await page.waitForSelector('#yc-declutter-toast', { state: 'attached', timeout: 40000 });
    const text = await page.evaluate(() => document.getElementById('yc-declutter-toast').shadowRoot.textContent);
    assert.match(text, /Сегодня вы уже 5 мин на YouTube/);
    const { usage } = await storage('usage');
    assert.equal(usage.remindedDay, usage.day);
  });

  await step('no errors in pages, popup or options', async () => {
    assert.deepEqual(errors, []);
  });
} catch (e) {
  exitCode = 1;
  console.error('FAILED:', e && e.stack ? e.stack : e);
  if (errors.length) console.error('page errors:', errors);
} finally {
  await context.close();
  server.close();
  await rm(work, { recursive: true, force: true }).catch(() => {});
}
console.log(`\n${passed} passed, ${skipped} skipped${exitCode ? ', FAILED' : ''}`);
process.exit(exitCode);
