/**
 * dsh-proxy-settings — Host half (a Cordis plugin).
 *
 * Two same-origin routes on the DSH web server:
 *   GET  /dsh-proxy-settings/state  — the `.env` state, the live proxy layer, diagnostics
 *   POST /dsh-proxy-settings/apply  — { enabled, proxyUrl, noProxy }
 *                                     validate → reinstall the proxy policy in this process
 *                                     → atomically rewrite `$DSH_HOME/.env`
 *
 * "Immediately" is the documented surface of the library DSH already ships:
 *   const dispose = await installProxyFromEnvironment(envLikeMap, report)
 * It replaces undici's global dispatcher — so every `fetch` in the process, the model
 * requests included, takes the new route — and returns a disposer that restores the layer
 * below. The plugin therefore stacks its own layer on top of the launcher's:
 *   - on:  installProxyFromEnvironment(proxy env)
 *   - off: installProxyFromEnvironment(empty env), which resolves to a `source: 'none'`
 *          policy and installs a direct agent over the outer proxy. Turning the proxy off
 *          really turns it off instead of only removing this plugin's layer.
 *   - unload: dispose this layer, then the adoption layer, returning the process to the
 *          launcher.
 * At activation the plugin first adopts the layer the launcher installed from the process
 * environment, so a later "off" can cover it.
 *
 * @module dsh-proxy-settings
 */

import { join } from 'node:path';

import {
  applyToText,
  describeProcessEnv,
  envForConfig,
  envFromProcessEnv,
  mapLikeEnv,
  readEnvState,
  validateNoProxy,
  validateProxyUrl,
} from './env-file.js';
import { readTextFile, resolveHarnessHome, writeTextAtomic } from './env-store.js';
import { loadProxyLib } from './proxy-lib.js';

/** Loader row id and browser module id; must match package.json and cordis.patch.yml. */
export const name = 'dsh-proxy-settings';

/** The web server registers the routes; the browser half is declared by `dsh.client`. */
export const inject = ['webServer'];

/** Route prefix. */
const ROUTE = '/dsh-proxy-settings';

/** Request body cap, so a stray caller cannot exhaust memory. */
const MAX_BODY_BYTES = 64 * 1024;

/** Write a JSON response. */
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

/** Read a text request body. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Whether a request may change proxy state.
 *
 * The route lives on the loopback web server, so a local process can already edit
 * `$DSH_HOME/.env` directly and this check is not a security boundary against it. It does
 * stop a page on another origin from posting here: a mismatch between `Origin` and `Host`,
 * or `Sec-Fetch-Site: cross-site`, is refused, and the caller must send JSON.
 */
function sameOrigin(req) {
  const headers = req.headers ?? {};
  const origin = headers.origin;
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    const host = headers.host;
    if (typeof host !== 'string' || host === '') return false;
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  const site = headers['sec-fetch-site'];
  if (typeof site === 'string' && site === 'cross-site') return false;
  return true;
}

/** The caller sent JSON, which a cross-origin form post cannot do without a preflight. */
function isJson(req) {
  const type = (req.headers ?? {})['content-type'];
  return typeof type === 'string' && type.toLowerCase().startsWith('application/json');
}

/**
 * Plugin body.
 * @param {any} ctx - Cordis context with `webServer` injected.
 */
export async function apply(ctx) {
  const homeInfo = await resolveHarnessHome();
  const home = homeInfo.home;
  const envPath = join(home, '.env');
  const loaded = await loadProxyLib();

  /** Live state: the proxy layer this plugin holds; the file is read per request. */
  const state = {
    lib: loaded.lib === null ? null : { lib: loaded.lib, source: loaded.source, path: loaded.path, version: loaded.version },
    libTried: loaded.tried,
    layer: 'unavailable',
    disposer: null,
    adoptionDisposer: null,
    lastReport: [],
    lastError: null,
  };

  /** Drop the layer this plugin currently holds. */
  const disposeLayer = async () => {
    const disposer = state.disposer;
    state.disposer = null;
    if (disposer === null) return;
    try {
      await disposer();
    } catch (error) {
      state.lastError = 'Restoring the proxy layer failed: ' + (error instanceof Error ? error.message : String(error));
    }
  };

  /**
   * Install one policy layer.
   * @param {'on' | 'off'} kind - on follows the configuration, off installs a direct layer.
   * @param {{proxyUrl?: string, noProxy?: string}} [config]
   */
  const installLayer = async (kind, config = {}) => {
    if (state.lib === null) {
      state.layer = 'unavailable';
      return;
    }
    await disposeLayer();
    const report = [];
    const env =
      kind === 'on'
        ? envForConfig({ enabled: true, proxyUrl: config.proxyUrl, noProxy: config.noProxy ?? '' })
        : mapLikeEnv({});
    try {
      state.disposer = await state.lib.lib.installProxyFromEnvironment(env, (message) => report.push(message));
      state.layer = kind;
      state.lastReport = report;
      state.lastError = null;
    } catch (error) {
      state.layer = 'error';
      state.lastError = 'Installing the proxy policy failed: ' + (error instanceof Error ? error.message : String(error));
    }
  };

  // Adopt the launcher's layer, so "off" can cover it rather than only this plugin's layers.
  if (state.lib !== null) {
    const report = [];
    try {
      state.adoptionDisposer = await state.lib.lib.installProxyFromEnvironment(envFromProcessEnv(), (message) =>
        report.push(message),
      );
      state.layer = 'baseline';
      state.adoptionReport = report;
    } catch (error) {
      state.layer = 'error';
      state.lastError = 'Adopting the existing proxy policy failed: ' + (error instanceof Error ? error.message : String(error));
    }
  }
  console.log(
    '[dsh-proxy-settings] loaded: home=' +
      home +
      ', proxy library=' +
      (state.lib === null
        ? 'unavailable (' + loaded.tried.join(' , ') + ')'
        : state.lib.source + (state.lib.version === undefined ? '' : '@' + state.lib.version)),
  );

  /** Read the current `.env` state. */
  const readFileState = async () => {
    const text = await readTextFile(envPath);
    const parsed = readEnvState(text ?? '');
    return {
      pathDisplay: '$DSH_HOME/.env',
      exists: text !== undefined,
      enabled: parsed.enabled,
      proxyUrl: parsed.proxyUrl,
      noProxy: parsed.noProxy,
      presentKeys: parsed.presentKeys,
    };
  };

  /** The route the proxy library itself reports for a sample URL. */
  const liveRoute = () => {
    if (state.lib === null) return null;
    try {
      const route = state.lib.lib.proxyRouteFor(new URL('https://example.com/'));
      return route.proxied === true ? { proxied: true, proxy: route.proxy } : { proxied: false };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };

  /** Full state for the settings section. */
  const snapshot = async () => ({
    ok: true,
    routePath: ROUTE,
    home: { display: '$DSH_HOME', source: homeInfo.source },
    envFile: await readFileState(),
    live: {
      layer: state.layer,
      effective: liveRoute(),
      diagnostics: state.lastReport,
      adoptionDiagnostics: state.adoptionReport ?? [],
      error: state.lastError,
    },
    lib:
      state.lib === null
        ? { available: false, tried: state.libTried }
        : {
            available: true,
            source: state.lib.source,
            version: state.lib.version ?? null,
            path: state.lib.path ?? null,
          },
    processProxyEnvNames: describeProcessEnv(),
  });

  /** Persist the configuration: atomic write with a one-time `.env.bak`. */
  const persist = async (config) => {
    const previous = await readTextFile(envPath);
    const next = applyToText(previous ?? '', config);
    if (previous === next) return { changed: false, created: false };
    const result = await writeTextAtomic(envPath, next, { backup: true });
    return { changed: true, created: previous === undefined, backupPath: result.backupPath ?? null };
  };

  /** Handle POST /apply. */
  const handleApply = async (req, res) => {
    let payload;
    try {
      const raw = await readBody(req);
      payload = raw.trim() === '' ? {} : JSON.parse(raw);
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        code: 'invalid-json',
        message: 'The request body is not valid JSON: ' + (error instanceof Error ? error.message : String(error)),
      });
      return;
    }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      sendJson(res, 400, { ok: false, code: 'invalid-request', message: 'The request body must be a JSON object.' });
      return;
    }

    const enabled = payload.enabled === true;
    const proxyCheck = enabled ? validateProxyUrl(payload.proxyUrl) : { ok: true, value: '' };
    if (proxyCheck.ok !== true) {
      sendJson(res, 400, {
        ok: false,
        code: 'invalid-proxy-url',
        field: 'proxyUrl',
        reason: proxyCheck.code,
        message: proxyCheck.message,
      });
      return;
    }
    const noProxyCheck = validateNoProxy(payload.noProxy);
    if (noProxyCheck.ok !== true) {
      sendJson(res, 400, {
        ok: false,
        code: 'invalid-no-proxy',
        field: 'noProxy',
        reason: noProxyCheck.code,
        message: noProxyCheck.message,
      });
      return;
    }
    const config = { enabled, proxyUrl: enabled ? proxyCheck.value : '', noProxy: noProxyCheck.value };

    const warnings = [];
    if (state.lib === null) {
      warnings.push('proxy-lib-missing');
    } else {
      await installLayer(enabled ? 'on' : 'off', config);
      if (state.layer === 'error') warnings.push('proxy-layer-error');
    }

    let persisted;
    try {
      persisted = await persist(config);
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        code: 'write-failed',
        message:
          'Writing .env failed: ' +
          (error instanceof Error ? error.message : String(error)) +
          ' (the proxy layer in this process already switched; a restart returns to the old configuration)',
        live: (await snapshot()).live,
      });
      return;
    }

    sendJson(res, 200, {
      ...(await snapshot()),
      applied: { enabled, proxyUrl: config.proxyUrl, noProxy: config.noProxy },
      persisted,
      warnings,
    });
  };

  /** Route entry point. */
  const handler = async (req, res) => {
    const method = String(req.method ?? 'GET').toUpperCase();
    const path = String(req.url ?? '/').split('?')[0].replace(/\/+$/, '') || ROUTE;
    try {
      if (!sameOrigin(req)) {
        sendJson(res, 403, { ok: false, code: 'cross-origin', message: 'Cross-origin requests are not accepted.' });
        return;
      }
      if (path === ROUTE + '/state' && method === 'GET') {
        sendJson(res, 200, await snapshot());
        return;
      }
      if (path === ROUTE + '/apply' && method === 'POST') {
        if (!isJson(req)) {
          sendJson(res, 415, { ok: false, code: 'unsupported-media-type', message: 'Send application/json.' });
          return;
        }
        await handleApply(req, res);
        return;
      }
      sendJson(res, 405, {
        ok: false,
        code: 'unknown-route',
        message:
          'Unknown route or method: ' +
          method +
          ' ' +
          path +
          ' (available: GET /dsh-proxy-settings/state, POST /dsh-proxy-settings/apply)',
      });
    } catch (error) {
      sendJson(res, 500, { ok: false, code: 'internal', message: error instanceof Error ? error.message : String(error) });
    }
  };

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler,
      }),
    'dsh-proxy-settings: routes',
  );

  // Unload: drop both layers, returning the process to the launcher.
  ctx.effect(
    () => () => {
      return (async () => {
        await disposeLayer();
        const adoption = state.adoptionDisposer;
        state.adoptionDisposer = null;
        if (adoption !== null) {
          try {
            await adoption();
          } catch {
            /* the unload path does not throw */
          }
        }
      })();
    },
    'dsh-proxy-settings: proxy layers',
  );
}
