import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyEnvelope, PUBLIC_KEY, MAX_ENVELOPE_BYTES } from '../extension/lib/remote.js';
import { MAX_CONFIG_BYTES } from '../extension/lib/config.js';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const bundled = JSON.parse(readFileSync(join(EXT, 'config', 'selectors.json'), 'utf8'));
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = publicKey.export({ format: 'jwk' });

/** @param {any} cfg @param {any} [key] */
function envelope(cfg, key = privateKey) {
  const config = typeof cfg === 'string' ? cfg : JSON.stringify(cfg);
  const signature = sign('sha256', Buffer.from(config, 'utf8'), { key, dsaEncoding: 'ieee-p1363' }).toString('base64');
  return JSON.stringify({ format: 1, version: 2, config, signature });
}

test('a correctly signed, valid config is accepted', async () => {
  const cfg = { ...bundled, version: 2 };
  const r = await verifyEnvelope(envelope(cfg), { publicKey: jwk });
  assert.equal(r.ok, true);
  assert.equal(/** @type {any} */ (r).config.version, 2);
});

test('tampered config, wrong key or broken signature are rejected', async () => {
  const good = JSON.parse(envelope({ ...bundled, version: 2 }));
  const tampered = { ...good, config: good.config.replace('ytd-reel-shelf-renderer', 'body') };
  assert.deepEqual(await verifyEnvelope(JSON.stringify(tampered), { publicKey: jwk }), { ok: false, error: 'bad signature' });
  const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  assert.deepEqual(await verifyEnvelope(envelope(bundled, other), { publicKey: jwk }), { ok: false, error: 'bad signature' });
  assert.deepEqual(await verifyEnvelope(JSON.stringify({ ...good, signature: 'AAAA' }), { publicKey: jwk }), { ok: false, error: 'bad signature' });
  assert.deepEqual(await verifyEnvelope(JSON.stringify({ ...good, signature: '!!!' }), { publicKey: jwk }), { ok: false, error: 'bad signature' });
});

test('signed but schema-invalid data is rejected (the signature alone is not enough)', async () => {
  const r = await verifyEnvelope(envelope({ version: 3, rules: { ads: { hide: ['a{color:red}'] } } }), { publicKey: jwk });
  assert.equal(r.ok, false);
  assert.match(/** @type {any} */ (r).error, /invalid config/);
});

test('format and size limits', async () => {
  assert.deepEqual(await verifyEnvelope('{', { publicKey: jwk }), { ok: false, error: 'invalid JSON' });
  assert.deepEqual(await verifyEnvelope('{"format":2}', { publicKey: jwk }), { ok: false, error: 'unknown format' });
  assert.deepEqual(await verifyEnvelope('x'.repeat(MAX_ENVELOPE_BYTES + 1), { publicKey: jwk }), { ok: false, error: 'file too large' });
  const big = JSON.stringify({ format: 1, config: ' '.repeat(MAX_CONFIG_BYTES + 1), signature: 'AA==' });
  assert.deepEqual(await verifyEnvelope(big, { publicKey: jwk }), { ok: false, error: 'config too large' });
});

test('the embedded public key is a real P-256 key (no placeholder)', async () => {
  assert.equal(PUBLIC_KEY.kty, 'EC');
  assert.equal(PUBLIC_KEY.crv, 'P-256');
  assert.match(PUBLIC_KEY.x, /^[A-Za-z0-9_-]{43}$/);
  assert.match(PUBLIC_KEY.y, /^[A-Za-z0-9_-]{43}$/);
  await crypto.subtle.importKey('jwk', PUBLIC_KEY, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  // and it does not accept a file signed with some other key
  assert.equal((await verifyEnvelope(envelope(bundled))).ok, false);
});
