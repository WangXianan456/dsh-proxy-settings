/**
 * Host-half integration: drive the registered HTTP routes with fake req/res objects.
 *
 * Covers: a `.env` that does not exist yet, the socks refusal, enabling (live layer + file),
 * idempotency, disabling, origin and content-type guards, and the error codes.
 *
 * The real proxy library is loaded through DSH_PROXY_SETTINGS_PROXY_LIB; the Harness home is
 * a temporary directory, so this test never touches a real `$DSH_HOME`.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { findProxyLib } from './helpers.mjs';

const libPath = findProxyLib();

/** A minimal request: enough for method, url, headers, and body reads. */
function fakeRequest(method, url, body, headers = {}) {
  const listeners = new Map();
  return {
    method,
    url,
    headers,
    destroyed: false,
    on(event, callback) {
      listeners.set(event, callback);
      return this;
    },
    destroy() {
      this.destroyed = true;
    },
    start() {
      const data = listeners.get('data');
      if (body !== undefined && data !== undefined) data(Buffer.from(body, 'utf8'));
      const end = listeners.get('end');
      if (end !== undefined) end();
    },
  };
}

/** A minimal response recorder. */
function fakeResponse() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body ?? '';
    },
  };
}

/** A context that records the routes and the effect disposers. */
function fakeContext() {
  const routes = [];
  const disposers = [];
  return {
    routes,
    disposers,
    webServer: {
      register(registration) {
        routes.push(registration);
        return () => {
          const index = routes.indexOf(registration);
          if (index >= 0) routes.splice(index, 1);
        };
      },
    },
    effect(factory) {
      const disposer = factory();
      if (typeof disposer === 'function') disposers.push(disposer);
      return disposer;
    },
    async disposeAll() {
      for (const disposer of disposers.reverse()) await disposer();
    },
  };
}

/** Call one route. */
async function callRoute(ctx, method, path, payload, headers = {}) {
  const route = ctx.routes.find((registration) => path.startsWith(registration.path));
  assert.ok(route !== undefined, 'route not registered: ' + path);
  const defaultHeaders = payload === undefined ? {} : { 'content-type': 'application/json' };
  const req = fakeRequest(method, path, payload === undefined ? undefined : JSON.stringify(payload), {
    ...defaultHeaders,
    ...headers,
  });
  const res = fakeResponse();
  const pending = route.handler(req, res);
  req.start();
  await pending;
  return { status: res.status, body: res.body === '' ? undefined : JSON.parse(res.body) };
}

test(
  'host routes: state, validation, apply, idempotency, disable (real proxy library, temporary DSH_HOME)',
  { skip: libPath === undefined ? 'no reachable @deepseek-ai/dsh-http-proxy' : false },
  async (t) => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-proxy-settings-home-'));
    const envPath = join(home, '.env');
    const previousHome = process.env.DSH_HOME;
    const previousLib = process.env.DSH_PROXY_SETTINGS_PROXY_LIB;
    process.env.DSH_HOME = home;
    process.env.DSH_PROXY_SETTINGS_PROXY_LIB = libPath;

    const { apply } = await import('../lib/index.js');
    const ctx = fakeContext();
    t.after(async () => {
      await ctx.disposeAll();
      if (previousHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previousHome;
      if (previousLib === undefined) delete process.env.DSH_PROXY_SETTINGS_PROXY_LIB;
      else process.env.DSH_PROXY_SETTINGS_PROXY_LIB = previousLib;
      rmSync(home, { recursive: true, force: true });
    });

    await apply(ctx);
    assert.equal(ctx.routes.length, 1, 'should register one prefix route');
    assert.equal(ctx.routes[0].path, '/dsh-proxy-settings');
    assert.equal(ctx.routes[0].kind, 'prefix');

    // 1) No file yet: readable state, no proxy, library available, adoption layer installed.
    const initial = await callRoute(ctx, 'GET', '/dsh-proxy-settings/state');
    assert.equal(initial.status, 200);
    assert.equal(initial.body.ok, true);
    assert.equal(initial.body.envFile.exists, false);
    assert.equal(initial.body.envFile.enabled, false);
    assert.equal(initial.body.lib.available, true);
    assert.equal(initial.body.live.layer, 'baseline');

    // 2) SOCKS is refused with its own reason and writes nothing.
    const socks = await callRoute(ctx, 'POST', '/dsh-proxy-settings/apply', {
      enabled: true,
      proxyUrl: 'socks5://127.0.0.1:1080',
    });
    assert.equal(socks.status, 400);
    assert.equal(socks.body.code, 'invalid-proxy-url');
    assert.equal(socks.body.reason, 'proxy.socks');
    assert.equal(existsSync(envPath), false, 'a rejected value must not create .env');

    // 3) An existing .env with comments, unrelated lines, and a stale proxy line.
    const previousEnv = '# keep this comment\nUNRELATED=keep\nHTTP_PROXY=http://old:1\n';
    const fs = await import('node:fs/promises');
    await fs.writeFile(envPath, previousEnv, 'utf8');

    // 4) Enabling installs the live layer and rewrites only the proxy lines.
    const enabled = await callRoute(ctx, 'POST', '/dsh-proxy-settings/apply', {
      enabled: true,
      proxyUrl: 'http://127.0.0.1:7890',
      noProxy: 'localhost,127.0.0.1',
    });
    assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
    assert.equal(enabled.body.live.layer, 'on');
    assert.equal(enabled.body.live.effective.proxied, true);
    assert.equal(enabled.body.persisted.changed, true);
    assert.equal(enabled.body.envFile.enabled, true);
    assert.equal(enabled.body.envFile.proxyUrl, 'http://127.0.0.1:7890');
    assert.equal(enabled.body.envFile.noProxy, 'localhost,127.0.0.1');
    assert.deepEqual(enabled.body.warnings, []);

    const written = readFileSync(envPath, 'utf8');
    assert.equal(
      written,
      '# keep this comment\nUNRELATED=keep\nHTTP_PROXY=http://127.0.0.1:7890\nHTTPS_PROXY=http://127.0.0.1:7890\nALL_PROXY=http://127.0.0.1:7890\nNO_PROXY=localhost,127.0.0.1\n',
    );
    assert.equal(written.charCodeAt(0), '#'.charCodeAt(0), 'the file must not start with a BOM');
    assert.ok(existsSync(envPath + '.bak'), 'the first write keeps one backup');
    assert.equal(readFileSync(envPath + '.bak', 'utf8'), previousEnv);

    // 5) Saving the same configuration again changes nothing.
    const again = await callRoute(ctx, 'POST', '/dsh-proxy-settings/apply', {
      enabled: true,
      proxyUrl: 'http://127.0.0.1:7890',
      noProxy: 'localhost,127.0.0.1',
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.persisted.changed, false);
    assert.equal(readFileSync(envPath, 'utf8'), written);

    // 6) Disabling installs the direct layer and removes every proxy line.
    const disabled = await callRoute(ctx, 'POST', '/dsh-proxy-settings/apply', { enabled: false });
    assert.equal(disabled.status, 200, JSON.stringify(disabled.body));
    assert.equal(disabled.body.live.layer, 'off');
    assert.equal(disabled.body.live.effective.proxied, false);
    assert.equal(disabled.body.envFile.enabled, false);
    assert.equal(readFileSync(envPath, 'utf8'), '# keep this comment\nUNRELATED=keep\n');

    // 7) Unknown route or method.
    const bad = await callRoute(ctx, 'GET', '/dsh-proxy-settings/nope');
    assert.equal(bad.status, 405);
    assert.equal(bad.body.code, 'unknown-route');

    // 8) A body that is not JSON.
    const route = ctx.routes[0];
    const jsonReq = fakeRequest('POST', '/dsh-proxy-settings/apply', 'not-json', { 'content-type': 'application/json' });
    const jsonRes = fakeResponse();
    const pending = route.handler(jsonReq, jsonRes);
    jsonReq.start();
    await pending;
    assert.equal(jsonRes.status, 400);
    assert.equal(JSON.parse(jsonRes.body).code, 'invalid-json');

    // 9) A cross-origin POST is refused before anything else happens.
    const crossOrigin = await callRoute(
      ctx,
      'POST',
      '/dsh-proxy-settings/apply',
      { enabled: true, proxyUrl: 'http://attacker:1' },
      { origin: 'http://evil.example', host: '127.0.0.1:56894' },
    );
    assert.equal(crossOrigin.status, 403);
    assert.equal(crossOrigin.body.code, 'cross-origin');
    assert.equal(readFileSync(envPath, 'utf8'), '# keep this comment\nUNRELATED=keep\n');

    // 10) A form-style POST without a JSON content type is refused.
    const notJson = await callRoute(ctx, 'POST', '/dsh-proxy-settings/apply', undefined, {
      'content-type': 'application/x-www-form-urlencoded',
    });
    assert.equal(notJson.status, 415);
    assert.equal(notJson.body.code, 'unsupported-media-type');
  },
);

test('host routes: a missing proxy library degrades to writing .env only', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-proxy-settings-nolib-'));
  const envPath = join(home, '.env');
  const previousHome = process.env.DSH_HOME;
  const previousLib = process.env.DSH_PROXY_SETTINGS_PROXY_LIB;
  process.env.DSH_HOME = home;
  // Point the override at a file that cannot provide the library.
  process.env.DSH_PROXY_SETTINGS_PROXY_LIB = join(home, 'missing-lib.js');

  const { apply } = await import('../lib/index.js?nolib');
  const ctx = fakeContext();
  t.after(async () => {
    await ctx.disposeAll();
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    if (previousLib === undefined) delete process.env.DSH_PROXY_SETTINGS_PROXY_LIB;
    else process.env.DSH_PROXY_SETTINGS_PROXY_LIB = previousLib;
    rmSync(home, { recursive: true, force: true });
  });

  await apply(ctx);
  const state = await callRoute(ctx, 'GET', '/dsh-proxy-settings/state');
  assert.equal(state.body.live.layer, 'unavailable');

  const applied = await callRoute(ctx, 'POST', '/dsh-proxy-settings/apply', {
    enabled: true,
    proxyUrl: 'http://127.0.0.1:7890',
  });
  assert.equal(applied.status, 200);
  assert.ok(applied.body.warnings.includes('proxy-lib-missing'));
  assert.match(readFileSync(envPath, 'utf8'), /^HTTP_PROXY=http:\/\/127\.0\.0\.1:7890$/m);
});
