# Chrome Web Store — Privacy practices & review notes (Video Declutter / «Видео без мусора»)

Copy each block into the matching field of the CWS developer dashboard.
`BASE` = the brand site address from `extension/lib/brand.js` (currently the placeholder `https://USER.github.io/REPO/` — replace it before submitting).

## Single purpose

Video Declutter hides distracting parts of the YouTube desktop site that the user chooses (Shorts, recommendations, end screens, autoplay, games, Explore, ad slots in the interface, optionally comments and live chat), with presets, an optional focus schedule and an optional daily time reminder.

## Permission justifications

**Host permission `https://www.youtube.com/*`**
The content script must run on YouTube pages to inject a stylesheet that hides the parts the user switched off, to open `/shorts/<id>` links as `/watch?v=<id>`, to switch the player's autoplay toggle off and to count how many elements are hidden for the popup. It runs on no other site and not in iframes/embeds. The same match is used for the web-accessible module files the content script loads.

**storage**
`chrome.storage.local` keeps the user's settings (toggles, preset, schedule, reminder), per-rule status timestamps used to warn that a rule stopped matching, today's on-site time counter (one number), a cached copy of the generated stylesheet, and — only if the user enables rule updates — the downloaded selector list. Nothing is synced or transmitted.

**alarms**
Used only if the user turns on "Update rules from the author's site" (off by default): a daily alarm re-downloads the signed selector data file. Without that setting no alarm exists.

## Remote code

No, I am not using remote code. All JavaScript is packaged with the extension; no remote scripts, `eval` or `new Function`; the default extension CSP is used. The optional rule update downloads a JSON **data** file (CSS selectors only) from `BASE/rules/youtube-clean/selectors.signed.json`. It is accepted only if its ECDSA P-256 signature verifies with the public key bundled in `lib/remote.js` and it passes `validateConfig()` in `lib/config.js` (selectors cannot contain `{ } < @ ; \`, `url(` or comments). It is never executed.

## Data usage

What user data do you plan to collect from users now or in the future? — **None.** Page content is processed locally to decide what to hide; viewing history, searches, settings and the time counter are never transmitted to the developer or any third party.

(If the form insists on a category for locally processed data, the closest is "Website content" — processed locally only, never collected.)

Certifications (all three checked):
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Privacy policy URL

`BASE` + `privacy/youtube-clean.html` → currently `https://USER.github.io/REPO/privacy/youtube-clean.html`

## Notes for the reviewer (test instructions)

No account or setup is needed; the "Focus" preset is active right after installation. Works logged out.

1. Open https://www.youtube.com/ — the home feed is replaced by a short note ("Home recommendations are hidden…"); the Shorts menu entry, the Explore section and Playables are gone. Search and Subscriptions still work.
2. Open any video, e.g. https://www.youtube.com/watch?v=dQw4w9WgXcQ — the "Up next" column is hidden and within a few seconds the autoplay toggle in the player switches to off. Click it on again: the extension leaves it on for this video.
3. Search, e.g. https://www.youtube.com/results?search_query=lofi+music — the Shorts shelf and promoted slots are hidden; regular results are shown.
4. Open a Shorts link, e.g. any https://www.youtube.com/shorts/<id> — it opens as https://www.youtube.com/watch?v=<id>.
5. Click the toolbar icon: switch presets (Minimal / Focus / Subscriptions only) and single toggles — open YouTube tabs update instantly. The "On" switch pauses everything.
6. Settings page: focus schedule (days + hours), daily reminder, rule status, and the optional "Update rules from the author's site" switch (off by default; when on, it downloads one signed JSON data file without cookies).

The extension does not block or modify any network request and does not touch ads inside the video player.

After installation the extension opens one static welcome page (`BASE/welcome/youtube-clean.html`); the uninstall URL is a static page (`BASE/bye/youtube-clean.html`). No data or identifiers are added to these URLs.
