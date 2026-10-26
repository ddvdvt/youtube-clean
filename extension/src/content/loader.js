// Classic content script (MV3 content scripts can't be ES modules), run at document_start.
// 1) Instantly re-applies the last generated stylesheet, so nothing flashes before the module loads.
// 2) Loads the module once. Never throws into the page.
(() => {
  try {
    if (globalThis.__ycDeclutterLoaded) return;
    globalThis.__ycDeclutterLoaded = true;
    const STYLE_ID = 'yc-declutter-style';
    chrome.storage.local
      .get('cssCache')
      .then(({ cssCache }) => {
        if (typeof cssCache !== 'string' || document.getElementById(STYLE_ID)) return;
        const el = document.createElement('style');
        el.id = STYLE_ID;
        el.textContent = cssCache;
        (document.head || document.documentElement).appendChild(el);
      })
      .catch(() => {});
    import(chrome.runtime.getURL('src/content/main.js'))
      .then((m) => m.start())
      .catch(() => {
        /* never break the host page */
      });
  } catch {
    /* ignore */
  }
})();
