/**
 * Pure-logic tests for the `.env` proxy lines: parsing, validation codes, and the rewrite
 * that keeps every unrelated line byte for byte.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PROXY_KEYS,
  applyToText,
  describeProcessEnv,
  envForConfig,
  envFromProcessEnv,
  mapLikeEnv,
  readEnvState,
  validateNoProxy,
  validateProxyUrl,
} from '../lib/env-file.js';

test('readEnvState: an empty file reports no proxy', () => {
  assert.deepEqual(readEnvState(''), { enabled: false, proxyUrl: '', noProxy: '', presentKeys: [] });
});

test('readEnvState: the lower-case name wins over the upper-case one', () => {
  const state = readEnvState('HTTP_PROXY=http://upper:1\nhttp_proxy=http://lower:2\nNO_PROXY=a,b\n');
  assert.equal(state.proxyUrl, 'http://lower:2');
  assert.equal(state.noProxy, 'a,b');
  assert.deepEqual(state.presentKeys, ['HTTP_PROXY', 'http_proxy', 'NO_PROXY']);
});

test('readEnvState: an upper-case name is read when no lower-case one exists', () => {
  assert.equal(readEnvState('HTTPS_PROXY=http://only:8080\n').proxyUrl, 'http://only:8080');
});

test('readEnvState: commented-out names are not configuration', () => {
  assert.equal(readEnvState('# HTTP_PROXY=http://gone:1\n').enabled, false);
});

test('validateProxyUrl: accepts http and https', () => {
  assert.deepEqual(validateProxyUrl('http://127.0.0.1:7890'), { ok: true, value: 'http://127.0.0.1:7890' });
  assert.deepEqual(validateProxyUrl(' https://user:pass@proxy.internal:8443 '), {
    ok: true,
    value: 'https://user:pass@proxy.internal:8443',
  });
});

test('validateProxyUrl: every refusal carries its own code', () => {
  assert.equal(validateProxyUrl('').code, 'proxy.empty');
  assert.equal(validateProxyUrl('http://a\nb').code, 'proxy.newline');
  assert.equal(validateProxyUrl('http://a#b').code, 'proxy.hash');
  assert.equal(validateProxyUrl('not a url').code, 'proxy.url');
  assert.equal(validateProxyUrl('socks5://127.0.0.1:1080').code, 'proxy.socks');
  assert.equal(validateProxyUrl('ftp://127.0.0.1:21').code, 'proxy.scheme');
  assert.equal(validateProxyUrl('http://').code, 'proxy.url');
});

test('validateNoProxy: structure only', () => {
  assert.deepEqual(validateNoProxy(''), { ok: true, value: '' });
  assert.deepEqual(validateNoProxy(' localhost, 127.0.0.1 '), { ok: true, value: 'localhost, 127.0.0.1' });
  assert.equal(validateNoProxy('a\nb').code, 'noproxy.newline');
  assert.equal(validateNoProxy('a#b').code, 'noproxy.hash');
});

test('applyToText: unrelated lines and comments survive; only proxy lines change', () => {
  const before = '# keep me\nUNRELATED=1\nHTTP_PROXY=http://old:1\n';
  const after = applyToText(before, { enabled: true, proxyUrl: 'http://new:2', noProxy: 'localhost' });
  assert.equal(
    after,
    '# keep me\nUNRELATED=1\nHTTP_PROXY=http://new:2\nHTTPS_PROXY=http://new:2\nALL_PROXY=http://new:2\nNO_PROXY=localhost\n',
  );
});

test('applyToText: disabling removes every proxy name, both letter cases', () => {
  const before = 'http_proxy=http://a:1\nHTTPS_PROXY=http://a:1\nexport ALL_PROXY=http://a:1\nno_proxy=x\nKEEP=1\n';
  assert.equal(applyToText(before, { enabled: false, proxyUrl: '', noProxy: '' }), 'KEEP=1\n');
});

test('applyToText: an empty result stays empty (no stray newline)', () => {
  assert.equal(applyToText('HTTP_PROXY=http://a:1\n', { enabled: false, proxyUrl: '', noProxy: '' }), '');
  assert.equal(applyToText('', { enabled: false, proxyUrl: '', noProxy: '' }), '');
});

test('applyToText: CRLF input is normalized for the lines it writes and keeps the rest', () => {
  const after = applyToText('A=1\r\nB=2\r\n', { enabled: true, proxyUrl: 'http://p:1', noProxy: '' });
  assert.equal(after, 'A=1\nB=2\nHTTP_PROXY=http://p:1\nHTTPS_PROXY=http://p:1\nALL_PROXY=http://p:1\n');
  assert.ok(!after.includes('\r'));
});

test('applyToText: idempotent for one configuration', () => {
  const once = applyToText('# c\n', { enabled: true, proxyUrl: 'http://p:1', noProxy: 'localhost' });
  assert.equal(applyToText(once, { enabled: true, proxyUrl: 'http://p:1', noProxy: 'localhost' }), once);
});

test('applyToText: writes the canonical names', () => {
  assert.equal(PROXY_KEYS.http, 'HTTP_PROXY');
  assert.match(applyToText('', { enabled: true, proxyUrl: 'http://p:1', noProxy: '' }), /^HTTP_PROXY=/);
});

test('mapLikeEnv: absent and empty values are not reported', () => {
  const env = mapLikeEnv({ a: '1', b: '', c: undefined, d: null });
  assert.deepEqual(env.get('a'), { value: '1' });
  assert.equal(env.get('b'), undefined);
  assert.equal(env.get('c'), undefined);
  assert.equal(env.get('d'), undefined);
  assert.equal(env.get('missing'), undefined);
});

test('envForConfig: all four lower-case names when enabled, nothing when disabled', () => {
  const on = envForConfig({ enabled: true, proxyUrl: 'http://p:1', noProxy: 'localhost' });
  assert.equal(on.get('http_proxy').value, 'http://p:1');
  assert.equal(on.get('https_proxy').value, 'http://p:1');
  assert.equal(on.get('all_proxy').value, 'http://p:1');
  assert.equal(on.get('no_proxy').value, 'localhost');
  assert.equal(envForConfig({ enabled: false }).get('http_proxy'), undefined);
});

test('envFromProcessEnv: lower-case names win, upper-case ones are the fallback', () => {
  const env = { HTTP_PROXY: 'http://upper:1', http_proxy: 'http://lower:2', HTTPS_PROXY: 'http://h:3' };
  assert.equal(envFromProcessEnv(env).get('http_proxy').value, 'http://lower:2');
  assert.equal(envFromProcessEnv(env).get('https_proxy').value, 'http://h:3');
});

test('describeProcessEnv: names only, never values', () => {
  const names = describeProcessEnv({ HTTP_PROXY: 'http://secret:1', NO_PROXY: 'localhost', PATH: '/bin' });
  assert.deepEqual(names, ['HTTP_PROXY', 'NO_PROXY']);
  assert.ok(!names.join(' ').includes('secret'));
});
