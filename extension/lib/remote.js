// Optional, user-enabled update of the selector config from the brand site. DATA only.
//
// The file at brandUrls().rules is an envelope
//   { "format": 1, "version": <n>, "config": "<selectors.json as a JSON string>", "signature": "<base64>" }
// where signature = ECDSA P-256 / SHA-256 (IEEE P1363 r||s) over the UTF-8 bytes of `config`,
// made offline with the author's private key (scripts/rules.mjs). The extension accepts it only if
// the size is within limits, the signature verifies with PUBLIC_KEY below, and the config passes
// validateConfig(). Otherwise the bundled config stays in use. Pure: WebCrypto is passed in or global.

import { parseConfigText, MAX_CONFIG_BYTES } from './config.js';

/** Public half of the rules signing key (the private key never leaves the author's machine). */
export const PUBLIC_KEY = {
  kty: 'EC',
  crv: 'P-256',
  x: 'WGeJGv1icP2lQoKErykD2VtKzYxvqh8fp8mOjMWpOAE',
  y: '_udqJduyAr9zcGzlede-5Mgn2EFpt7Tn8wDxg5HOeFY',
};

export const MAX_ENVELOPE_BYTES = MAX_CONFIG_BYTES * 2 + 4096;

/** @param {string} b64 */
function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Verify and parse a downloaded envelope.
 * @param {string} text
 * @param {{ publicKey?: JsonWebKey, subtle?: SubtleCrypto }} [opts]
 * @returns {Promise<{ ok: true, config: any } | { ok: false, error: string }>}
 */
export async function verifyEnvelope(text, opts = {}) {
  const subtle = opts.subtle || globalThis.crypto.subtle;
  const publicKey = opts.publicKey || PUBLIC_KEY;
  if (typeof text !== 'string' || text.length > MAX_ENVELOPE_BYTES) return { ok: false, error: 'file too large' };
  let env;
  try {
    env = JSON.parse(text);
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
  if (!env || env.format !== 1 || typeof env.config !== 'string' || typeof env.signature !== 'string') return { ok: false, error: 'unknown format' };
  if (env.config.length > MAX_CONFIG_BYTES) return { ok: false, error: 'config too large' };
  let valid = false;
  try {
    const key = await subtle.importKey('jwk', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const sig = fromBase64(env.signature);
    if (sig.length !== 64) return { ok: false, error: 'bad signature' };
    valid = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, new TextEncoder().encode(env.config));
  } catch {
    return { ok: false, error: 'bad signature' };
  }
  if (!valid) return { ok: false, error: 'bad signature' };
  const parsed = parseConfigText(env.config);
  if (!parsed.ok) return { ok: false, error: `invalid config: ${parsed.errors.slice(0, 3).join('; ')}` };
  return { ok: true, config: parsed.config };
}
