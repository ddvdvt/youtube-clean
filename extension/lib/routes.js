// Page types and URL redirects (Shorts → normal player, home → Subscriptions). Pure.

const SHORTS = /^\/shorts\/([A-Za-z0-9_-]{6,20})\/?$/;

/**
 * @param {string | URL} url
 * @returns {'home' | 'watch' | 'search' | 'channel' | 'subscriptions' | 'shorts' | 'other'}
 */
export function pageType(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return 'other';
  }
  const p = u.pathname;
  if (p === '/' || p === '') return 'home';
  if (p === '/watch') return 'watch';
  if (p === '/results') return 'search';
  if (p.startsWith('/shorts/')) return 'shorts';
  if (p === '/feed/subscriptions') return 'subscriptions';
  if (/^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)(\/|$)/.test(p)) return 'channel';
  return 'other';
}

/**
 * `/shorts/<id>` → `/watch?v=<id>` on the same origin, or null.
 * @param {string | URL} url
 */
export function shortsToWatch(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return null;
  }
  const m = SHORTS.exec(u.pathname);
  if (!m) return null;
  const out = new URL('/watch', u.origin);
  out.searchParams.set('v', m[1]);
  return out.href;
}

/**
 * Where the current URL should be sent, given the features in force, or null to stay.
 * @param {string | URL} url
 * @param {{ shortsRedirect?: boolean, homeRedirect?: boolean }} features
 */
export function redirectTarget(url, features) {
  if (features.shortsRedirect) {
    const w = shortsToWatch(url);
    if (w) return w;
  }
  if (features.homeRedirect && pageType(url) === 'home') {
    try {
      return new URL('/feed/subscriptions', new URL(String(url)).origin).href;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Video id of a watch URL, or ''.
 * @param {string | URL} url
 */
export function videoId(url) {
  try {
    const u = new URL(String(url));
    return u.pathname === '/watch' ? u.searchParams.get('v') || '' : '';
  } catch {
    return '';
  }
}
