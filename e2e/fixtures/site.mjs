// LOCAL fixture "video site" whose DOM mimics the parts of the YouTube desktop markup the
// extension relies on (custom element names, attributes, link paths), written from public
// knowledge and a look at the logged-out pages on 2026-10-26. No YouTube HTML, CSS, images or
// logos are copied; titles and channels are invented. Used by e2e/smoke.mjs and the store images.
//
// Routes: /  /watch?v=  /results?search_query=  /@channel  /shorts/<id>  /feed/subscriptions
//         /fixture/yt.css  /fixture/spa.js   (anything else → null)
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const esc = (/** @type {string} */ s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const VIDEOS = [
  ['v1aaaaaaaaa', 'Как устроен двигатель внутреннего сгорания — подробный разбор', 'Инженерные истории', '1,2 млн просмотров · 3 года назад', '18:42', 210],
  ['v2bbbbbbbbb', 'Хлеб на закваске дома: от муки до корочки', 'Кухня без спешки', '384 тыс. просмотров · 2 месяца назад', '24:10', 30],
  ['v3ccccccccc', 'Лекция: введение в линейную алгебру, часть 1', 'Открытый университет', '96 тыс. просмотров · 1 год назад', '1:12:05', 260],
  ['v4ddddddddd', 'Поход по Тянь-Шаню за 5 дней — маршрут и снаряжение', 'Горы рядом', '512 тыс. просмотров · 8 месяцев назад', '32:18', 150],
  ['v5eeeeeeeee', 'Учимся играть на гитаре: первые три аккорда', 'Музыка с нуля', '2,4 млн просмотров · 5 лет назад', '11:03', 330],
  ['v6fffffffff', 'Почему небо голубое? Физика за 10 минут', 'Наука просто', '780 тыс. просмотров · 4 года назад', '10:27', 195],
  ['v7ggggggggg', 'Ремонт велосипеда своими руками: тормоза и переключатели', 'Мастерская', '143 тыс. просмотров · 3 недели назад', '27:51', 95],
  ['v8hhhhhhhhh', 'Обзор старых карт: как рисовали мир в XVI веке', 'История картографии', '61 тыс. просмотров · 6 дней назад', '41:16', 45],
];
const SHORTS = [
  ['s1aaaaaaaaa', 'Этот трюк удивит вас 😱', '12 млн просмотров'],
  ['s2bbbbbbbbb', 'Кот против огурца, часть 48', '8,1 млн просмотров'],
  ['s3ccccccccc', 'Лайфхак за 15 секунд', '3,3 млн просмотров'],
  ['s4ddddddddd', 'Смотри до конца!!!', '22 млн просмотров'],
];

const thumb = (hue, extra = '') => `<div class="thumb" style="--h:${hue}">${extra}</div>`;

function richItem([id, title, channel, meta, dur, hue]) {
  return `<ytd-rich-item-renderer data-t="feed-item"><div id="content"><a id="thumbnail" href="/watch?v=${id}">${thumb(hue, `<span class="dur">${dur}</span>`)}</a>
  <div class="meta"><span class="avatar" style="--h:${hue}"></span><div><a class="title" id="video-title" href="/watch?v=${id}">${esc(title)}</a><div class="sub">${esc(channel)}</div><div class="sub">${esc(meta)}</div></div></div></div></ytd-rich-item-renderer>`;
}

function shortsLockup([id, title, views], i) {
  return `<ytm-shorts-lockup-view-model-v2><ytm-shorts-lockup-view-model><a class="shorts-link" href="/shorts/${id}">${thumb(300 + i * 17)}</a><div class="title">${esc(title)}</div><div class="sub">${views}</div></ytm-shorts-lockup-view-model></ytm-shorts-lockup-view-model-v2>`;
}

const shortsShelfRich = () =>
  `<ytd-rich-section-renderer data-t="home-shorts"><div id="content"><ytd-rich-shelf-renderer is-shorts><h2 class="shelf-title">Shorts</h2><div class="shorts-row">${SHORTS.map(shortsLockup).join('')}</div></ytd-rich-shelf-renderer></div></ytd-rich-section-renderer>`;

const adItem = () =>
  `<ytd-rich-item-renderer data-t="feed-ad"><div id="content"><ytd-ad-slot-renderer><ytd-in-feed-ad-layout-renderer>${thumb(50, '<span class="ad">Реклама</span>')}<div class="meta"><div><span class="title">Купите курс «Миллион за неделю»</span><div class="sub">Спонсор · promo.example</div></div></div></ytd-in-feed-ad-layout-renderer></ytd-ad-slot-renderer></div></ytd-rich-item-renderer>`;

const playablesShelf = () =>
  `<ytd-rich-section-renderer data-t="home-playables"><div id="content"><ytd-rich-shelf-renderer><h2 class="shelf-title">Игры</h2><div class="shorts-row">${[1, 2, 3]
    .map((n) => `<a class="game" href="/playables/game${n}">${thumb(120 + n * 30)}<div class="title">Мини-игра ${n}</div></a>`)
    .join('')}</div></ytd-rich-shelf-renderer></div></ytd-rich-section-renderer>`;

function guide() {
  const e = (title, href, icon, t = '') =>
    `<ytd-guide-entry-renderer${t ? ` data-t="${t}"` : ''}><a id="endpoint" ${href ? `href="${href}"` : ''} title="${esc(title)}"><span class="ico">${icon}</span><span>${esc(title)}</span></a></ytd-guide-entry-renderer>`;
  return `<tp-yt-app-drawer id="guide"><ytd-guide-renderer id="guide-renderer">
  <ytd-guide-section-renderer data-t="guide-main">${e('Главная', '/', '⌂', 'guide-home')}${e('Shorts', '', '⚡', 'guide-shorts')}${e('Подписки', '/feed/subscriptions', '▤', 'guide-subs')}</ytd-guide-section-renderer>
  <ytd-guide-section-renderer data-t="guide-you">${e('Вы', '/feed/you', '◉')}${e('История', '/feed/history', '↺')}${e('Смотреть позже', '/playlist?list=WL', '◷')}</ytd-guide-section-renderer>
  <ytd-guide-section-renderer data-t="guide-explore"><h3 class="gh">Навигатор</h3>${e('В тренде', '/feed/trending', '↗', 'guide-trending')}${e('Музыка', '/channel/UCmusic', '♪')}${e('Видеоигры', '/gaming', '◈')}${e('Игротека', '/playables', '◆', 'guide-playables')}</ytd-guide-section-renderer>
</ytd-guide-renderer></tp-yt-app-drawer>`;
}

function masthead(query = '') {
  return `<div id="masthead-ad" data-t="masthead-ad"><div class="banner">Баннер спонсора на всю ширину · promo.example</div></div>
<ytd-masthead id="masthead"><a id="logo" href="/" title="Главная"><span class="logo-mark">▶</span><span class="logo-text">Видеохостинг</span></a>
<form id="search-form" action="/results"><input name="search_query" value="${esc(query)}" placeholder="Введите запрос"><button>Поиск</button></form><span class="avatar me"></span></ytd-masthead>`;
}

/** A pre-rendered, inactive watch page like the one YouTube keeps in the DOM. */
const hiddenWatch = () => `<ytd-watch-flexy hidden><div id="secondary"><div id="related"><ytd-watch-next-secondary-results-renderer></ytd-watch-next-secondary-results-renderer></div></div><ytd-comments id="comments"></ytd-comments></ytd-watch-flexy>`;

function home() {
  const items = VIDEOS.slice(0, 4).map(richItem).join('') + adItem() + shortsShelfRich() + VIDEOS.slice(4).map(richItem).join('') + playablesShelf();
  return `<ytd-browse page-subtype="home"><ytd-two-column-browse-results-renderer><div id="primary"><ytd-rich-grid-renderer data-t="home-grid">
  <div id="header"><ytd-feed-filter-chip-bar-renderer data-t="home-chips"><div class="chips">${['Все', 'Музыка', 'Игры', 'Подкасты', 'Недавно опубликованные', 'Новое для вас'].map((c, i) => `<span class="chip${i ? '' : ' on'}">${c}</span>`).join('')}</div></ytd-feed-filter-chip-bar-renderer></div>
  <div id="contents">${items}</div></ytd-rich-grid-renderer></div></ytd-two-column-browse-results-renderer></ytd-browse>${hiddenWatch()}`;
}

function subscriptions() {
  const items = [VIDEOS[2], VIDEOS[6], VIDEOS[7], VIDEOS[1]].map(richItem).join('') + shortsShelfRich() + [VIDEOS[3], VIDEOS[5]].map(richItem).join('');
  return `<ytd-browse page-subtype="subscriptions"><ytd-two-column-browse-results-renderer><div id="primary"><h2 class="page-title">Подписки</h2><ytd-rich-grid-renderer data-t="subs-grid"><div id="contents">${items.replace('data-t="home-shorts"', 'data-t="subs-shorts"')}</div></ytd-rich-grid-renderer></div></ytd-two-column-browse-results-renderer></ytd-browse>${hiddenWatch()}`;
}

function videoRow([id, title, channel, meta, dur, hue], t = 'search-video') {
  return `<ytd-video-renderer data-t="${t}"><a id="thumbnail" href="/watch?v=${id}">${thumb(hue, `<span class="dur">${dur}</span>`)}</a><div class="text"><a class="title" id="video-title" href="/watch?v=${id}">${esc(title)}</a><div class="sub">${esc(meta)}</div><div class="sub chan"><span class="avatar" style="--h:${hue}"></span>${esc(channel)}</div><div class="sub desc">Короткое описание ролика из выдачи поиска…</div></div></ytd-video-renderer>`;
}

function search(q) {
  const shortResult = `<ytd-video-renderer data-t="search-short"><a id="thumbnail" href="/shorts/${SHORTS[2][0]}">${thumb(320)}</a><div class="text"><a class="title" href="/shorts/${SHORTS[2][0]}">${esc(SHORTS[2][1])} #shorts</a><div class="sub">${SHORTS[2][2]}</div></div></ytd-video-renderer>`;
  const gridShelf = `<grid-shelf-view-model data-t="search-shorts"><h2 class="shelf-title">Shorts</h2><div class="shorts-row">${SHORTS.slice(0, 4).map(shortsLockup).join('')}</div></grid-shelf-view-model>`;
  const ad = `<ytd-ad-slot-renderer data-t="search-ad"><ytd-in-feed-ad-layout-renderer><div class="adrow">${thumb(40, '<span class="ad">Реклама</span>')}<div class="text"><span class="title">Онлайн-школа: профессия за 3 месяца</span><div class="sub">Спонсор · school.example</div></div></div></ytd-in-feed-ad-layout-renderer></ytd-ad-slot-renderer>`;
  return `<ytd-search><ytd-two-column-search-results-renderer><div id="primary"><ytd-section-list-renderer><ytd-item-section-renderer><div id="contents">
  <div class="filters"><span class="chip on">Все</span><span class="chip">Видео</span><span class="chip">Недавно опубликованные</span><span class="chip">Просмотрено</span></div>
  ${ad}${videoRow(VIDEOS[0])}${videoRow(VIDEOS[5])}${gridShelf}${videoRow(VIDEOS[2])}${shortResult}${videoRow(VIDEOS[6])}
  </div></ytd-item-section-renderer></ytd-section-list-renderer></div></ytd-two-column-search-results-renderer><span hidden data-q="${esc(q)}"></span></ytd-search>${hiddenWatch()}`;
}

function watch(id) {
  const v = VIDEOS.find((x) => x[0] === id) || VIDEOS[0];
  const related = VIDEOS.filter((x) => x !== v)
    .slice(0, 6)
    .map(
      ([rid, title, channel, meta, dur, hue]) =>
        `<yt-lockup-view-model data-t="related-item"><a href="/watch?v=${rid}">${thumb(hue, `<span class="dur">${dur}</span>`)}</a><div class="text"><a class="title" href="/watch?v=${rid}">${esc(title)}</a><div class="sub">${esc(channel)}</div><div class="sub">${esc(meta)}</div></div></yt-lockup-view-model>`,
    )
    .join('');
  const comments = [
    ['Анна К.', 'Наконец-то понятное объяснение, спасибо!'],
    ['Дмитрий', 'На 7:40 лучший момент. Пересматриваю второй раз.'],
    ['Сауле', 'А можно продолжение про ремонт?'],
  ]
    .map(([n, c], i) => `<div class="comment"><span class="avatar" style="--h:${i * 90 + 20}"></span><div><b>${esc(n)}</b><p>${esc(c)}</p></div></div>`)
    .join('');
  return `<ytd-watch-flexy video-id="${v[0]}"><div id="columns">
  <div id="primary"><div id="player"><div class="html5-video-player" id="movie_player" style="--h:${v[5]}">
    <div class="video-surface"><span class="play">▶</span></div>
    <div class="ytp-ce-element" data-t="ce-1">${thumb(10)}<span>Следующее видео автора</span></div>
    <div class="ytp-ce-element ytp-ce-element-right" data-t="ce-2"><span class="avatar" style="--h:200"></span><span>Подписаться</span></div>
    <div class="ytp-cards-teaser" data-t="cards-teaser">Подсказка: смотрите также…</div>
    <div class="html5-endscreen videowall-endscreen" data-t="endscreen"><div class="ytp-endscreen-content">${[1, 2, 3, 4, 5, 6].map((n) => thumb(n * 50)).join('')}</div></div>
    <div class="ytp-fullscreen-grid" data-t="fs-grid"></div>
    <div class="ytp-chrome-bottom"><div class="ytp-progress"><div class="ytp-progress-done"></div></div><div class="ytp-chrome-controls">
      <span class="ctl">▶</span><span class="ctl">⏭</span><span class="ctl">🔊</span><span class="time">7:41 / ${v[4]}</span><span class="spacer"></span>
      <button class="ytp-button ytp-autonav-toggle-button" aria-checked="true" data-t="autonav" title="Автовоспроизведение"><span class="knob"></span></button>
      <span class="ctl">CC</span><span class="ctl">⚙</span><span class="ctl">⛶</span>
    </div></div>
  </div></div>
  <div id="below"><ytd-watch-metadata><h1 class="vtitle">${esc(v[1])}</h1><div class="owner"><span class="avatar" style="--h:${v[5]}"></span><div><b>${esc(v[2])}</b><div class="sub">245 тыс. подписчиков</div></div><span class="subscribe">Подписаться</span><span class="spacer"></span><span class="pill">👍 12 тыс.</span><span class="pill">Поделиться</span></div>
  <div class="desc">${esc(v[3])}<br>Описание видео: таймкоды, ссылки на источники и благодарности.</div></ytd-watch-metadata>
  <ytd-merch-shelf-renderer data-t="merch"><div class="merch">Магазин канала: футболка, кружка, стикеры</div></ytd-merch-shelf-renderer>
  <ytd-comments id="comments" data-t="comments"><h2 class="ctitle">Комментарии: 1 284</h2>${comments}</ytd-comments></div></div>
  <div id="secondary"><div id="secondary-inner">
    <div id="player-ads" data-t="player-ads"><div class="adbox">Спонсор: «Курс за 1 день» · promo.example</div></div>
    <div id="chat-container" data-t="chat"></div>
    <div id="related" data-t="related"><ytd-watch-next-secondary-results-renderer>${related}
    <ytd-reel-shelf-renderer data-t="related-shorts"><h2 class="shelf-title">Shorts</h2><div class="shorts-row">${SHORTS.slice(0, 2).map(shortsLockup).join('')}</div></ytd-reel-shelf-renderer>
    </ytd-watch-next-secondary-results-renderer></div>
  </div></div></div></ytd-watch-flexy>`;
}

function channel() {
  const tabs = ['Главная', 'Видео', 'Shorts', 'Трансляции', 'Плейлисты', 'Записи'];
  return `<ytd-browse page-subtype="channels"><div class="chan-head"><span class="avatar big" style="--h:150"></span><div><h1>Горы рядом</h1><div class="sub">@gory-ryadom · 312 тыс. подписчиков · 410 видео</div></div></div>
  <div class="tabs">${tabs.map((t, i) => `<yt-tab-shape tab-title="${t}"${t === 'Shorts' ? ' data-t="channel-shorts-tab"' : ''} class="${i ? '' : 'on'}"><div class="tab">${t}</div></yt-tab-shape>`).join('')}</div>
  <ytd-reel-shelf-renderer data-t="channel-shorts"><h2 class="shelf-title">Shorts</h2><div class="shorts-row">${SHORTS.map(shortsLockup).join('')}</div></ytd-reel-shelf-renderer>
  <div class="chan-videos">${VIDEOS.slice(0, 4)
    .map(([id, title, , meta, dur, hue]) => `<yt-lockup-view-model data-t="channel-video"><a href="/watch?v=${id}">${thumb(hue, `<span class="dur">${dur}</span>`)}</a><div class="title">${esc(title)}</div><div class="sub">${esc(meta)}</div></yt-lockup-view-model>`)
    .join('')}</div></ytd-browse>${hiddenWatch()}`;
}

function shorts(id) {
  const s = SHORTS.find((x) => x[0] === id) || SHORTS[0];
  return `<ytd-shorts><ytd-reel-video-renderer data-t="shorts-player"><div class="reel" style="--h:320">${esc(s[1])}</div></ytd-reel-video-renderer></ytd-shorts>`;
}

/**
 * Render a fixture route.
 * @param {string} rawUrl request URL (path + query)
 * @returns {Promise<{ body: string | Buffer, type?: string } | null>}
 */
export async function route(rawUrl) {
  const u = new URL(rawUrl, 'http://fixture.local');
  const p = decodeURIComponent(u.pathname);
  if (p === '/fixture/yt.css') return { body: await readFile(join(DIR, 'yt.css')), type: 'text/css; charset=utf-8' };
  if (p === '/fixture/spa.js') return { body: await readFile(join(DIR, 'spa.js')), type: 'text/javascript; charset=utf-8' };
  let title = 'Видеохостинг';
  let page = null;
  const q = u.searchParams.get('search_query') || '';
  if (p === '/') page = home();
  else if (p === '/watch') {
    page = watch(u.searchParams.get('v') || '');
    title = `${(VIDEOS.find((x) => x[0] === u.searchParams.get('v')) || VIDEOS[0])[1]} — Видеохостинг`;
  } else if (p === '/results') {
    page = search(q);
    title = `${q} — Видеохостинг`;
  } else if (p.startsWith('/@')) page = channel();
  else if (p.startsWith('/shorts/')) page = shorts(p.split('/')[2]);
  else if (p === '/feed/subscriptions') page = subscriptions();
  if (page === null) return null;
  return {
    body: `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title><link rel="stylesheet" href="/fixture/yt.css"></head>
<body><ytd-app>${masthead(q)}<div id="content-wrap">${guide()}<ytd-page-manager id="page-manager">${page}</ytd-page-manager></div></ytd-app>
<script src="/fixture/spa.js"></script></body></html>`,
  };
}
