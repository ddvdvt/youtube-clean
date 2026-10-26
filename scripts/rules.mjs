// Signed selector updates (see README, «Обновление правил по сети»).
//
//   node scripts/rules.mjs keygen   — once: creates keys/rules-signing.pem (git-ignored, KEEP A BACKUP)
//                                    and prints the public JWK for extension/lib/remote.js
//   node scripts/rules.mjs sign     — signs extension/config/selectors.json into
//                                    dist/rules/selectors.signed.json (upload to BASE/rules/youtube-clean/)
//   node scripts/rules.mjs verify [file] — checks a signed file with the public key from lib/remote.js
import { generateKeyPairSync, createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseConfigText } from '../extension/lib/config.js';
import { verifyEnvelope, PUBLIC_KEY } from '../extension/lib/remote.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = process.env.RULES_KEY || join(ROOT, 'keys', 'rules-signing.pem');
const OUT = join(ROOT, 'dist', 'rules', 'selectors.signed.json');
const cmd = process.argv[2];

if (cmd === 'keygen') {
  if (existsSync(KEY)) throw new Error(`${KEY} already exists — refusing to overwrite the signing key`);
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  mkdirSync(dirname(KEY), { recursive: true });
  writeFileSync(KEY, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const { kty, crv, x, y } = publicKey.export({ format: 'jwk' });
  process.stdout.write(`private key: ${KEY}\npublic JWK for lib/remote.js:\n${JSON.stringify({ kty, crv, x, y })}\n`);
} else if (cmd === 'sign') {
  const text = readFileSync(join(ROOT, 'extension', 'config', 'selectors.json'), 'utf8');
  const parsed = parseConfigText(text);
  if (!parsed.ok) throw new Error(`selectors.json is invalid: ${parsed.errors.join('; ')}`);
  const config = JSON.stringify(parsed.config);
  const signature = sign('sha256', Buffer.from(config, 'utf8'), { key: createPrivateKey(readFileSync(KEY)), dsaEncoding: 'ieee-p1363' }).toString('base64');
  const envelope = JSON.stringify({ format: 1, version: parsed.config.version, config, signature });
  const check = await verifyEnvelope(envelope, { publicKey: PUBLIC_KEY });
  if (!check.ok) throw new Error(`signed file does not verify with PUBLIC_KEY in lib/remote.js: ${check.error}`);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, envelope);
  process.stdout.write(`version ${parsed.config.version} -> ${OUT}\n`);
} else if (cmd === 'verify') {
  const r = await verifyEnvelope(readFileSync(process.argv[3] || OUT, 'utf8'), { publicKey: PUBLIC_KEY });
  process.stdout.write(r.ok ? `ok, version ${r.config.version}\n` : `FAILED: ${r.error}\n`);
  process.exitCode = r.ok ? 0 : 1;
} else {
  process.stdout.write('usage: node scripts/rules.mjs keygen | sign | verify [file]\n');
  process.exitCode = 2;
}
