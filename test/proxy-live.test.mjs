/**
 * The semantics the settings section depends on, exercised against the real library:
 * install a policy, see `fetch` really reroute to a local stand-in proxy, stack the direct
 * layer the plugin installs when the user turns the proxy off, then remove it again.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { findProxyLib } from './helpers.mjs';

const libPath = findProxyLib();
const skip = libPath === undefined ? 'no reachable @deepseek-ai/dsh-http-proxy' : false;

/** Map-like env for the library, which only calls `env.get(name)?.value.trim()`. */
function mapEnv(entries) {
  return {
    get(name) {
      return Object.prototype.hasOwnProperty.call(entries, name) ? { value: entries[name] } : undefined;
    },
  };
}

test('live switch: install → traffic reaches the stand-in proxy → direct layer → uninstall', { skip }, async (t) => {
  const { installProxyFromEnvironment, proxyRouteFor } = await import(pathToFileURL(libPath).href);

  const seen = [];
  const server = createServer((req, res) => {
    seen.push(req.url);
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('PROXY-HIT ' + req.url);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const proxyEnv = mapEnv({ http_proxy: 'http://127.0.0.1:' + port, https_proxy: 'http://127.0.0.1:' + port });

  // 1) The launcher's own layer.
  const disposeBase = await installProxyFromEnvironment(proxyEnv, () => {});
  t.after(() => disposeBase().catch(() => {}));
  const baseRoute = proxyRouteFor(new URL('https://example.com/'));
  assert.equal(baseRoute.proxied, true);
  assert.equal(baseRoute.proxy, 'http://127.0.0.1:' + port);

  const first = await fetch('http://example.test/through-proxy', { signal: AbortSignal.timeout(5000) });
  assert.equal(first.status, 200);
  assert.equal(await first.text(), 'PROXY-HIT http://example.test/through-proxy');
  assert.ok(seen.includes('http://example.test/through-proxy'), 'the stand-in proxy must see the absolute request line');

  // 2) What the plugin does when the user turns the proxy off.
  const disposeOff = await installProxyFromEnvironment(mapEnv({}), () => {});
  assert.equal(proxyRouteFor(new URL('https://example.com/')).proxied, false);
  await assert.rejects(() => fetch('http://example.test/direct-should-fail', { signal: AbortSignal.timeout(5000) }));
  assert.ok(!seen.some((url) => url.includes('direct-should-fail')), 'traffic must not reach the proxy after off');

  // 3) Removing the direct layer restores the outer proxy.
  await disposeOff();
  assert.equal(proxyRouteFor(new URL('https://example.com/')).proxied, true);
  const back = await fetch('http://example.test/back-through-proxy', { signal: AbortSignal.timeout(5000) });
  assert.equal(await back.text(), 'PROXY-HIT http://example.test/back-through-proxy');
});

test('loopback is always direct, whatever the proxy says', { skip }, async () => {
  const { installProxyFromEnvironment, proxyRouteFor } = await import(pathToFileURL(libPath).href);
  const dispose = await installProxyFromEnvironment(
    mapEnv({ http_proxy: 'http://127.0.0.1:9', https_proxy: 'http://127.0.0.1:9' }),
    () => {},
  );
  try {
    assert.equal(proxyRouteFor(new URL('http://127.0.0.1:52022/')).proxied, false);
    assert.equal(proxyRouteFor(new URL('http://localhost:52022/')).proxied, false);
    assert.equal(proxyRouteFor(new URL('http://example.test/')).proxied, true);
  } finally {
    await dispose();
  }
});

test('the library reports SOCKS as a diagnostic instead of throwing', { skip }, async () => {
  const { installProxyFromEnvironment } = await import(pathToFileURL(libPath).href);
  const reports = [];
  const dispose = await installProxyFromEnvironment(mapEnv({ http_proxy: 'socks5://127.0.0.1:1080' }), (message) =>
    reports.push(message),
  );
  try {
    assert.ok(reports.length >= 1, 'a diagnostic is expected');
    assert.match(reports.join(' '), /socks/i);
  } finally {
    await dispose();
  }
});
