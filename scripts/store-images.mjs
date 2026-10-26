// Renders the Chrome Web Store images into store/:
//   screenshot-1..5.png (1280×800), promo-small.png (440×280), promo-marquee.png (1400×560).
// The extension UI is real (loaded unpacked into the installed Chromium). The video pages are the
// LOCAL fictional fixture site (e2e/fixtures/site.mjs) with the DOM structure the extension expects
// and no real logos; it is served on 127.0.0.1, which the temporary copy adds to the matches
// (same test-only patch as e2e/smoke.mjs). The real site is never contacted.
// Run: node scripts/store-images.mjs      (REVIEW_DIR=<dir> also saves raw light/dark UI shots)
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, prepareExtension, launch, hideScrollbars, dataUrl, fileDataUrl, browserWindow, stage, render, promo } from './store-kit.mjs';
import { route } from '../e2e/fixtures/site.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'store');
const REVIEW = process.env.REVIEW_DIR;
const bundled = JSON.parse(readFileSync(join(ROOT, 'extension', 'config', 'selectors.json'), 'utf8'));

const { server, port } = await startServer(async (path, _host, rawUrl) => {
  if (path.startsWith('/brand/')) return { body: '<!doctype html><title>brand</title>' };
  return route(rawUrl);
});
const O = `http://127.0.0.1:${port}`;
const local = ['http://127.0.0.1/*'];
const ext = await prepareExtension(join(ROOT, 'extension'), {
  base: `${O}/brand/`,
  patchManifest: (m) => {
    m.host_permissions = [...m.host_permissions, ...local];
    m.content_scripts[0].matches = [...m.content_scripts[0].matches, ...local];
    m.web_accessible_resources[0].matches = [...m.web_accessible_resources[0].matches, ...local];
  },
});
const { context, sw, extId } = await launch(ext.extDir, ext.profile);
const icon = await fileDataUrl(join(ROOT, 'extension', 'icons', 'icon128.png'));
const setSettings = (patch) =>
  sw.evaluate(async (p) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, ...p, features: { ...settings.features, ...(p.features || {}) } } });
  }, patch);

async function sitePage(path) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1164, height: 591 });
  await page.goto(`${O}${path}`);
  await page.waitForSelector('#yc-declutter-style', { state: 'attached', timeout: 10000 });
  await hideScrollbars(page);
  await page.waitForTimeout(3000); // autoplay switched off, health probes done
  return page;
}
async function popupFor(page, height = 600) {
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.id, page.url());
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 340, height });
  await popup.goto(`chrome-extension://${extId}/src/popup/popup.html?tabId=${tabId}`);
  await popup.waitForSelector('body[data-ready="1"]', { timeout: 10000 });
  await popup.waitForTimeout(300);
  return popup;
}
const win = async (page, popup, tab) =>
  browserWindow({ tab, page: await dataUrl(page), icon, popup: popup ? await dataUrl(popup.locator('body')) : undefined, popupWidth: 340 });

try {
  await mkdir(OUT, { recursive: true });
  for (const p of context.pages()) if (p.url().includes('/brand/')) await p.close();
  // a believable "today" counter for the popup
  await sw.evaluate(async () => {
    const d = new Date();
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await chrome.storage.local.set({ usage: { day, seconds: 37 * 60, remindedDay: '' } });
  });

  // 1 — calm home page (default Focus) + popup
  const home = await sitePage('/');
  let popup = await popupFor(home);
  await render(
    context,
    stage({
      eyebrow: 'Видео без мусора · режим «Фокус»',
      caption: 'Главная без бесконечной ленты: <mark>ни Shorts, ни рекомендаций</mark>. Поиск и подписки на месте',
      body: await win(home, popup, 'Главная — Видеохостинг'),
    }),
    join(OUT, 'screenshot-1.png'),
  );
  if (REVIEW) await popup.locator('body').screenshot({ path: join(REVIEW, 'yc-popup-light.png') });
  await popup.close();
  await home.close();

  // 2 — watch page: no "Up next", no end screens, autoplay off
  const watch = await sitePage('/watch?v=v4ddddddddd');
  await render(
    context,
    stage({
      eyebrow: 'Видео без мусора · просмотр',
      caption: 'Только то, что вы выбрали: <mark>без «Следующего»</mark>, конечных заставок и автовоспроизведения',
      body: await win(watch, null, 'Поход по Тянь-Шаню за 5 дней — Видеохостинг'),
    }),
    join(OUT, 'screenshot-2.png'),
  );
  await watch.close();

  // 3 — search in "Минимум": recommendations allowed, Shorts and promoted slots gone
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    for (const k of ['shortsRedirect', 'homeFeed', 'related', 'endscreen', 'autoplayOff']) settings.features[k] = false;
    await chrome.storage.local.set({ settings });
  });
  const search = await sitePage(`/results?search_query=${encodeURIComponent('ремонт велосипеда')}`);
  popup = await popupFor(search);
  await render(
    context,
    stage({
      eyebrow: 'Видео без мусора · режим «Минимум»',
      caption: 'Три готовых режима. В «Минимуме» рекомендации остаются, а <mark>Shorts и промо-блоки</mark> — нет',
      body: await win(search, popup, 'ремонт велосипеда — Видеохостинг'),
    }),
    join(OUT, 'screenshot-3.png'),
  );
  await popup.close();
  await search.close();

  // 4 — options: presets + schedule + reminder
  await setSettings({ schedule: { enabled: true, days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' }, reminder: { enabled: true, minutes: 60 } });
  const opt = await context.newPage();
  await opt.setViewportSize({ width: 1164, height: 591 });
  await opt.goto(`chrome-extension://${extId}/src/options/options.html`);
  await opt.waitForSelector('body[data-ready="1"]');
  await hideScrollbars(opt);
  await opt.evaluate(() => {
    const el = document.getElementById('hPresets').closest('section');
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 16);
  });
  await opt.evaluate(() => {
    const el = document.getElementById('schedulePanel');
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 24);
  });
  await opt.waitForTimeout(300);
  await render(
    context,
    stage({
      eyebrow: 'Видео без мусора · фокус по расписанию',
      caption: 'В рабочие часы — <mark>строгий «Фокус»</mark>, вечером — как настроили. И мягкое напоминание о времени',
      body: browserWindow({ tab: 'Настройки — Видео без мусора', page: await dataUrl(opt), icon }),
    }),
    join(OUT, 'screenshot-4.png'),
  );

  // 5 — rules status + the popup warning when a rule stops matching
  await sw.evaluate(async (v) => {
    const now = Date.now();
    const rec = (hit) => ({ misses: hit ? 0 : 6, firstMissAt: hit ? 0 : now - 5 * 3600e3, lastHit: now - (hit ? 600e3 : 9 * 3600e3), lastCheck: now - 300e3 });
    const records = { 'shorts:home': rec(true), 'homeFeed:home': rec(true), 'related:watch': rec(false), 'endscreen:watch': rec(true), 'autoplayOff:watch': rec(true), 'comments:watch': rec(true), 'explore:home': rec(true), 'playables:home': rec(true) };
    await chrome.storage.local.set({ health: { configVersion: v, records } });
  }, bundled.version);
  await setSettings({ features: { related: true } });
  await opt.setViewportSize({ width: 796, height: 591 });
  await opt.reload();
  await opt.waitForSelector('body[data-ready="1"]');
  await hideScrollbars(opt);
  await opt.evaluate(() => {
    const el = document.getElementById('rulesPanel');
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 16);
  });
  await opt.waitForTimeout(300);
  const blank = await context.newPage();
  await blank.goto(`${O}/watch?v=v6fffffffff`);
  popup = await popupFor(blank, 560);
  await render(
    context,
    stage({
      eyebrow: 'Видео без мусора · правила',
      caption: 'Сайт сменил разметку? <mark>Расширение само заметит</mark> и предложит обновить правила',
      body: `<div class="pair">${browserWindow({ tab: 'Настройки — Видео без мусора', page: await dataUrl(opt), icon, width: 800 })}<img class="solo" src="${await dataUrl(popup.locator('body'))}" alt=""></div>`,
      extraCss: '.pair{display:flex;gap:40px;align-items:flex-start}.solo{width:340px;margin-top:24px;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.28),0 0 0 1px rgba(0,0,0,.12)}',
    }),
    join(OUT, 'screenshot-5.png'),
  );
  if (REVIEW) await opt.screenshot({ path: join(REVIEW, 'yc-options-light.png'), fullPage: true });
  await popup.close();
  await blank.close();
  await opt.close();

  const tile = {
    icon,
    name: 'Видео без мусора',
    eyebrow: 'Честные расширения',
    tagline: 'Без Shorts, рекомендаций и <mark>автовоспроизведения</mark>',
    facts: [['Цена', '0 ₽'], ['Аккаунт', 'не нужен'], ['Реклама', '0'], ['Трекеры', '0'], ['Данные', 'на устройстве']],
  };
  await render(context, promo({ ...tile, size: 'small' }), join(OUT, 'promo-small.png'), 440, 280);
  await render(context, promo({ ...tile, size: 'marquee' }), join(OUT, 'promo-marquee.png'), 1400, 560);

  if (REVIEW) {
    const dark = await context.newPage();
    await dark.emulateMedia({ colorScheme: 'dark' });
    await dark.setViewportSize({ width: 340, height: 600 });
    await dark.goto(`chrome-extension://${extId}/src/popup/popup.html?tabId=999999`);
    await dark.waitForSelector('body[data-ready]');
    await dark.waitForTimeout(400); // let switch transitions finish
    await dark.locator('body').screenshot({ path: join(REVIEW, 'yc-popup-dark.png') });
    await dark.setViewportSize({ width: 1100, height: 800 });
    await dark.goto(`chrome-extension://${extId}/src/options/options.html`);
    await dark.waitForSelector('body[data-ready]');
    await dark.waitForTimeout(400); // let switch transitions finish
    await dark.screenshot({ path: join(REVIEW, 'yc-options-dark.png'), fullPage: true });
    await dark.close();
  }
  console.log('store images written to', OUT);
} finally {
  await context.close();
  server.close();
  await ext.cleanup();
}
