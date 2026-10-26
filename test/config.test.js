import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isSafeSelector,
  validateConfig,
  parseConfigText,
  chooseConfig,
  buildCss,
  cssString,
  probesFor,
  probedFeatures,
  RULE_KEYS,
  PAGE_TYPES,
  MAX_CONFIG_BYTES,
} from '../extension/lib/config.js';
import { FEATURES } from '../extension/lib/settings.js';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const bundledText = readFileSync(join(EXT, 'config', 'selectors.json'), 'utf8');
const bundled = JSON.parse(bundledText);
const schema = JSON.parse(readFileSync(join(EXT, 'config', 'selectors.schema.json'), 'utf8'));
const all = Object.fromEntries(FEATURES.map((f) => [f, true]));

test('bundled selectors.json is valid', () => {
  const v = validateConfig(bundled);
  assert.deepEqual(v.errors, []);
  assert.ok(v.ok);
  assert.ok(parseConfigText(bundledText).ok);
  assert.match(bundled.updated, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(bundledText.length < MAX_CONFIG_BYTES / 4, 'plenty of room under the size cap');
});

test('bundled config covers every CSS feature; JS-only features need none', () => {
  for (const k of RULE_KEYS) assert.ok(bundled.rules[k], `rule ${k}`);
  for (const k of RULE_KEYS) assert.ok(FEATURES.includes(/** @type {any} */ (k)), `${k} is a feature`);
  assert.ok(bundled.rules.autoplayOff.click);
  for (const f of ['shortsRedirect', 'homeRedirect']) assert.equal(bundled.rules[f], undefined);
});

test('bundled selectors are parseable CSS selector syntax (balanced, no duplicates)', () => {
  for (const [k, r] of Object.entries(bundled.rules)) {
    const list = /** @type {any} */ (r).hide || [];
    assert.equal(new Set(list).size, list.length, `duplicate selector in ${k}`);
    for (const s of [...list, .../** @type {any} */ (r).probes?.flatMap((p) => [p.selector, p.when].filter(Boolean)) || []]) {
      let depth = 0;
      for (const c of s) {
        if (c === '(' || c === '[') depth++;
        if (c === ')' || c === ']') depth--;
        assert.ok(depth >= 0, s);
      }
      assert.equal(depth, 0, `unbalanced: ${s}`);
      assert.equal((s.match(/'/g) || []).length % 2, 0, `quotes: ${s}`);
    }
  }
});

test('schema file lists the same rule keys, page types and limits as the validator', () => {
  assert.deepEqual(Object.keys(schema.properties.rules.properties).sort(), [...RULE_KEYS].sort());
  assert.deepEqual(schema.$defs.rule.properties.probes.items.properties.page.enum, PAGE_TYPES);
  assert.deepEqual(schema.required, ['version', 'rules']);
  assert.deepEqual(Object.keys(schema.properties).sort(), ['$schema', 'comment', 'homeMessage', 'inactive', 'rules', 'updated', 'version']);
  const sel = new RegExp(schema.$defs.selector.pattern);
  for (const r of Object.values(bundled.rules)) for (const s of /** @type {any} */ (r).hide || []) assert.match(s, sel);
});

test('isSafeSelector rejects anything that could escape a CSS rule', () => {
  for (const ok of ['ytd-reel-shelf-renderer', "a[href^='/shorts/']", 'div > span:has(> b)', 'x:not([hidden])']) assert.ok(isSafeSelector(ok), ok);
  for (const bad of ['', '   ', 'a{color:red}', 'a}', '@import x', 'a;b', 'a\\62', 'a\nb', 'a /* c */', "a[style*=url('x')]", 'a<b', 'x'.repeat(401), 42, null]) {
    assert.equal(isSafeSelector(bad), false, String(bad));
  }
});

test('validateConfig reports precise errors', () => {
  const bad = {
    version: 0,
    extra: 1,
    inactive: [],
    rules: {
      shorts: { hide: ['a{'], probes: [{ page: 'nowhere', selector: 'x', more: 1 }] },
      unknown: { hide: ['x'] },
      related: {},
      comments: { hide: ['x'], probes: 'no' },
      autoplayOff: { click: 'a;b' },
    },
  };
  const { ok, errors } = validateConfig(bad);
  assert.equal(ok, false);
  const text = errors.join('\n');
  for (const part of ['unknown key "extra"', 'version must be', 'inactive must be', 'rules.shorts.hide[0]', 'probes[0].page', 'probes[0]: unknown key "more"', 'unknown rule "unknown"', 'rules.related needs', 'rules.comments.probes', 'rules.autoplayOff.click']) {
    assert.ok(text.includes(part), `expected "${part}" in:\n${text}`);
  }
  assert.equal(validateConfig([]).ok, false);
  assert.equal(validateConfig({ version: 1 }).ok, false);
  assert.ok(validateConfig({ version: 1, rules: {} }).ok, 'an empty rule set is valid (hides nothing)');
});

test('parseConfigText: size cap and JSON errors', () => {
  assert.deepEqual(parseConfigText('{'), { ok: false, errors: ['invalid JSON'] });
  assert.deepEqual(parseConfigText(' '.repeat(MAX_CONFIG_BYTES + 1)), { ok: false, errors: ['config too large'] });
  assert.equal(parseConfigText(/** @type {any} */ (5)).ok, false);
});

test('chooseConfig: only a valid and newer download wins', () => {
  const newer = { ...bundled, version: bundled.version + 1 };
  assert.equal(chooseConfig(bundled, newer), newer);
  assert.equal(chooseConfig(bundled, { ...bundled }), bundled, 'same version: bundled');
  assert.equal(chooseConfig(bundled, { ...newer, rules: { bogus: {} } }), bundled, 'invalid');
  assert.equal(chooseConfig(bundled, null), bundled);
});

test('buildCss: one display:none rule per selector of enabled features', () => {
  const css = buildCss(bundled, { shorts: true }, {});
  const lines = css.split('\n');
  assert.equal(lines.length, bundled.rules.shorts.hide.length);
  for (const l of lines) assert.match(l, /^[^{}]+ \{ display: none !important; \}$/);
  assert.ok(css.includes('ytd-reel-shelf-renderer { display: none !important; }'));
  assert.equal(buildCss(bundled, {}, {}), '');
  const full = buildCss(bundled, all, { homeMessage: 'Тихо' });
  assert.ok(full.includes('ytd-watch-flexy #related'));
  assert.ok(full.includes('content: "Тихо"'));
  assert.ok(!full.includes('ytp-autonav'), 'autoplay is a click, never hidden');
  assert.equal(buildCss(bundled, { ...all, homeFeed: false }, { homeMessage: 'x' }).includes('::before'), false);
  assert.equal((full.match(/\{/g) || []).length, (full.match(/\}/g) || []).length);
});

test('buildCss skips unsafe selectors even if validation was bypassed', () => {
  const cfg = { version: 1, rules: { ads: { hide: ['ok-el', 'bad{x}', 'a;b'] } } };
  assert.equal(buildCss(cfg, { ads: true }), 'ok-el { display: none !important; }');
});

test('cssString escapes quotes, backslashes, newlines and "<"', () => {
  assert.equal(cssString('a"b'), '"a\\"b"');
  assert.equal(cssString('a\\b'), '"a\\\\b"');
  assert.equal(cssString('one\ntwo'), '"one two"');
  assert.equal(cssString('</style>'), '"\\3c /style>"');
});

test('probes: grouped by page, only probed features listed', () => {
  const watch = probesFor(bundled, 'watch');
  assert.deepEqual([...new Set(watch.map((p) => p.feature))].sort(), ['autoplayOff', 'comments', 'endscreen', 'related']);
  assert.ok(probesFor(bundled, 'home').some((p) => p.feature === 'homeFeed'));
  assert.deepEqual(probesFor(bundled, 'other'), []);
  const probed = probedFeatures(bundled);
  assert.ok(!probed.includes('ads') && !probed.includes('liveChat'), 'variable content has no probe');
  assert.ok(probed.includes('shorts'));
});
