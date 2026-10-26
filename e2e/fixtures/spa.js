// Fixture "single-page app": same-origin links are loaded without a full reload, like YouTube does,
// and the same window events are fired (yt-navigate-start / yt-navigate-finish).
(() => {
  async function navigate(href, push = true) {
    const url = new URL(href, location.href);
    window.dispatchEvent(new CustomEvent('yt-navigate-start', { detail: { url: url.pathname + url.search } }));
    const html = await (await fetch(url.href)).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    document.getElementById('page-manager').innerHTML = doc.getElementById('page-manager').innerHTML;
    document.title = doc.title;
    if (push) history.pushState({}, '', url.href);
    window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
  }
  window.__spaNavigate = navigate;
  // like the real app, which also fires yt-navigate-finish after the first page load
  setTimeout(() => window.dispatchEvent(new CustomEvent('yt-navigate-finish')), 300);
  // like the real player, which restores its saved autoplay state while it initialises
  setTimeout(() => {
    const t = document.querySelector('.ytp-autonav-toggle-button');
    if (t) t.setAttribute('aria-checked', 'true');
  }, 1200);
  document.addEventListener('click', (e) => {
    const toggle = e.target.closest && e.target.closest('.ytp-autonav-toggle-button');
    if (toggle) {
      toggle.setAttribute('aria-checked', String(toggle.getAttribute('aria-checked') !== 'true'));
      return;
    }
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || e.defaultPrevented || a.origin !== location.origin) return;
    e.preventDefault();
    navigate(a.href);
  });
  window.addEventListener('popstate', () => navigate(location.href, false));
})();
