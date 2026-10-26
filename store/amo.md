# Firefox Add-ons (AMO) — listing and review notes (Video Declutter)

Upload `dist/youtube-clean-<version>-firefox.zip` (built by `npm run zip:firefox`).
Add-on ID: `youtube-clean@ddvdvt.github.io`. Minimum version: Firefox 140.0 (Android: 142.0).
The Russian listing texts can be reused from `listing.ru.md`; the UI is localized (ru, en).

## Name

Video Declutter — no Shorts, no recommendations

(No "YouTube" in the name; compatibility is stated in the description.)

## Summary (≤ 250 characters)

Hides Shorts, recommendations, end screens, autoplay and clutter on YouTube. Three presets, a scheduled focus mode and a gentle daily reminder. No account, no tracking, works only on youtube.com.

## Description

Opened YouTube for one video and lost an hour? This add-on removes what pulls you in, and keeps what you came for.

- Hides Shorts everywhere (home, search, channels, subscriptions, sidebar) and opens Shorts links in the normal player.
- Hides home-page recommendations, the "Up next" sidebar, end screens, cards, playables, Explore and promoted slots.
- Turns autoplay off (you can still switch it on for a video).
- Three presets: Focus, Minimal, Subscriptions only. Every block can be toggled on its own.
- Scheduled focus mode (e.g. weekdays 9:00–18:00) and an optional daily-time reminder.
- Rules health: the add-on notices when a rule stops matching after a YouTube redesign and tells you; optionally it downloads signed, updated rules (data only, never code).

Privacy: no account, analytics or ads. Settings and the time counter stay in your browser. The optional rule update (off by default) downloads one static file from the author's site and sends nothing.

Not affiliated with YouTube or Google.

## Categories

- Photos, Music & Videos
- Appearance

## Tags

youtube, shorts, distraction, focus, recommendations, autoplay

## Homepage / support

- Homepage: https://ddvdvt.github.io/
- Privacy policy: https://ddvdvt.github.io/privacy/youtube-clean.html (also paste the text of `PRIVACY.md` into the AMO privacy policy field)
- License: MIT

## Data collection (data_collection_permissions)

`"required": ["none"]` — nothing is collected or transmitted. The optional, off-by-default rule update is a plain GET of `https://ddvdvt.github.io/rules/youtube-clean/selectors.signed.json` without cookies or user data.

## Notes for reviewers

**Source code:** not minified, not bundled, no build step, no remote code. The package is the `extension/` folder of the repository as is; only `manifest.json` is generated for Firefox by `scripts/firefox.mjs` (service worker → event page with the same file, gecko id, `minimum_chrome_version` removed).

**Remote data, not code:** the optional rule update downloads a JSON envelope `{ format, version, config, signature }`. `config` is a JSON string with CSS selectors and feature switches (no scripts, no URLs to load); `signature` is ECDSA P-256 / SHA-256 over `config`, verified with WebCrypto against the public key bundled in `lib/remote.js` before anything is stored (`lib/remote.js`, `lib/config.js` validate the schema, sizes and selector syntax). Unsigned, tampered or malformed files are rejected. The selectors are applied only as CSS `display: none` rules on youtube.com.

**Permissions:**

- Host permission `https://www.youtube.com/*` + one content script there (`document_start`, a small classic loader that `import()`s the ES-module code from `web_accessible_resources`, matched to youtube.com only) — to hide the chosen parts of the page before it is painted and to redirect Shorts links to the normal player. If the user withholds this access in Firefox, the popup says so and offers "Allow access to YouTube" (`permissions.request`).
- `storage` — settings, rule-health records and the daily time counter (local only).
- `alarms` — one daily alarm for the optional rule update; it exists only while that option is on.

**How to test:**

1. Install and open https://www.youtube.com: the home feed, Shorts shelves and the Shorts entry in the menu are hidden (Focus preset); a calm message replaces the feed.
2. Open any video: the "Up next" sidebar and end screens are hidden, autoplay is off; comments stay.
3. Toolbar button → "Minimal": recommendations come back, Shorts stay hidden. Toggle "Comments" — the page updates without a reload.
4. Open a /shorts/ link: it plays in the normal player.

The add-on also opens a static welcome page on install and sets a static uninstall page (https://ddvdvt.github.io/); nothing is sent to them.
