/**
 * Pure logic for `$DSH_HOME/.env` proxy lines: parsing, validation, and the text
 * rewrite. No I/O here, so every rule below is unit-testable.
 *
 * The rules come from the DSH `.env` contract:
 * - The file is Node `util.parseEnv` syntax: one `KEY=VALUE` per line, `#` starts a comment.
 * - Only `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and `NO_PROXY` (any letter case) are
 *   accepted from the Harness-home file; bootstrap names such as `PATH` or `DSH_*` are
 *   rejected and make the application refuse to start. This module therefore touches
 *   those four names and leaves every other byte of the file alone.
 * - The proxy library reads a lowercase name before its uppercase fallback, so both
 *   spellings of a name must be removed before writing, or a stale lowercase line would
 *   silently win over the one this plugin writes.
 *
 * Validation results are machine-readable (`code`) so the browser half can translate them;
 * `message` is an English fallback for logs and non-UI callers.
 *
 * @module dsh-proxy-settings/env-file
 */

/** Canonical spelling written into the file. */
export const PROXY_KEYS = Object.freeze({
  http: 'HTTP_PROXY',
  https: 'HTTPS_PROXY',
  all: 'ALL_PROXY',
  no: 'NO_PROXY',
});

/** Every lower-case name the file may carry, before upper-casing. */
const BASE_NAMES = ['http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'];
const NAME_SET = new Set();
for (const name of BASE_NAMES) {
  NAME_SET.add(name);
  NAME_SET.add(name.toUpperCase());
}

/** The key of an assignment line (`KEY=...` or `export KEY=...`); undefined for comments. */
function lineKey(line) {
  const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
  return match === null ? undefined : match[1];
}

/** Whether the line assigns one of the four proxy names, in any letter case. */
function isProxyLine(line) {
  if (/^\s*#/.test(line)) return false;
  const key = lineKey(line);
  return key !== undefined && NAME_SET.has(key);
}

/**
 * Read the proxy configuration out of `.env` text.
 * @param {string} text - File contents, possibly empty.
 * @returns {{enabled: boolean, proxyUrl: string, noProxy: string, presentKeys: string[]}}
 *   `enabled` follows the proxy library: a non-empty usable http(s) address counts.
 */
export function readEnvState(text) {
  const values = new Map();
  const presentKeys = [];
  for (const raw of text.split('\n')) {
    if (!isProxyLine(raw)) continue;
    const key = lineKey(raw);
    const value = raw.slice(raw.indexOf('=') + 1);
    presentKeys.push(key);
    const lower = key.toLowerCase();
    // Lower-case wins: once a lower-case line registered, an upper-case one cannot replace it.
    if (!values.has(lower) || key === lower) values.set(lower, value);
  }
  const proxyUrl = (values.get('http_proxy') ?? values.get('https_proxy') ?? values.get('all_proxy') ?? '').trim();
  return {
    enabled: proxyUrl !== '',
    proxyUrl,
    noProxy: (values.get('no_proxy') ?? '').trim(),
    presentKeys,
  };
}

/** A value that would break the one-line structure of the file. */
function valueProblem(value) {
  if (typeof value !== 'string') return 'type';
  if (value.includes('\n') || value.includes('\r')) return 'newline';
  if (value.includes('#')) return 'hash';
  return undefined;
}

/**
 * Validate a proxy address. Only `http://` and `https://` are accepted, matching
 * `@deepseek-ai/dsh-http-proxy`; SOCKS is refused with its own code because the message
 * users need is different from a generic scheme error.
 * @param {unknown} input
 * @returns {{ok: true, value: string} | {ok: false, code: string, message: string}}
 */
export function validateProxyUrl(input) {
  const value = String(input ?? '').trim();
  if (value === '') return { ok: false, code: 'proxy.empty', message: 'A proxy address is required.' };
  const problem = valueProblem(value);
  if (problem === 'newline') {
    return { ok: false, code: 'proxy.newline', message: 'A proxy address must not contain a line break.' };
  }
  if (problem === 'hash') {
    return { ok: false, code: 'proxy.hash', message: 'A proxy address must not contain "#", which starts a .env comment.' };
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, code: 'proxy.url', message: 'Not a valid URL: ' + value };
  }
  const protocol = url.protocol.toLowerCase();
  if (protocol === 'socks:' || protocol === 'socks4:' || protocol === 'socks5:' || protocol === 'socks5h:') {
    return {
      ok: false,
      code: 'proxy.socks',
      message: 'SOCKS is not supported; the DSH proxy layer accepts http:// and https:// only.',
    };
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    return {
      ok: false,
      code: 'proxy.scheme',
      message: 'A proxy address must start with http:// or https:// (received ' + protocol + ').',
    };
  }
  if (url.hostname === '') {
    return { ok: false, code: 'proxy.host', message: 'A proxy address needs a host name.' };
  }
  return { ok: true, value };
}

/**
 * Validate `NO_PROXY`. Only structural problems are rejected: separators and the syntax of
 * individual entries are the proxy library's business.
 * @param {unknown} input
 * @returns {{ok: true, value: string} | {ok: false, code: string, message: string}}
 */
export function validateNoProxy(input) {
  const value = String(input ?? '').trim();
  if (value === '') return { ok: true, value: '' };
  const problem = valueProblem(value);
  if (problem === 'newline') {
    return { ok: false, code: 'noproxy.newline', message: 'NO_PROXY must not contain a line break.' };
  }
  if (problem === 'hash') {
    return { ok: false, code: 'noproxy.hash', message: 'NO_PROXY must not contain "#", which starts a .env comment.' };
  }
  return { ok: true, value };
}

/**
 * Produce the `.env` text for a configuration.
 *
 * Every proxy line is removed first (both letter cases, `export` forms included) and all
 * other lines are kept byte for byte; then the canonical lines are appended when a proxy is
 * enabled. The result ends with a newline and carries no BOM; an empty result is `''`.
 *
 * @param {string} text - Current contents (`undefined` for a file that does not exist yet).
 * @param {{enabled: boolean, proxyUrl: string, noProxy: string}} config
 * @returns {string}
 */
export function applyToText(text, config) {
  const kept = [];
  for (const line of String(typeof text === 'string' ? text : '').split('\n')) {
    if (isProxyLine(line)) continue;
    kept.push(line);
  }
  while (kept.length > 0 && kept[kept.length - 1].replace(/\r$/, '').trim() === '') kept.pop();
  const out = kept.map((line) => line.replace(/\r$/, ''));
  if (config.enabled === true) {
    out.push(PROXY_KEYS.http + '=' + config.proxyUrl);
    out.push(PROXY_KEYS.https + '=' + config.proxyUrl);
    out.push(PROXY_KEYS.all + '=' + config.proxyUrl);
    if (config.noProxy !== '') out.push(PROXY_KEYS.no + '=' + config.noProxy);
  }
  return out.length === 0 ? '' : out.join('\n') + '\n';
}

/**
 * A Map-like environment for `installProxyFromEnvironment`, which only calls
 * `env.get(name)?.value.trim()`.
 * @param {Record<string, string | undefined | null>} entries
 */
export function mapLikeEnv(entries) {
  const map = new Map(Object.entries(entries).filter(([, value]) => value !== undefined && value !== null && value !== ''));
  return {
    get(name) {
      return map.has(name) ? { value: map.get(name) } : undefined;
    },
  };
}

/**
 * The environment that represents a configuration for the proxy library: lower-case names
 * first, all four supplied, so the library resolves exactly what the user saved.
 * @param {{enabled: boolean, proxyUrl: string, noProxy: string}} config
 */
export function envForConfig(config) {
  if (config.enabled !== true) return mapLikeEnv({});
  return mapLikeEnv({
    http_proxy: config.proxyUrl,
    https_proxy: config.proxyUrl,
    all_proxy: config.proxyUrl,
    no_proxy: config.noProxy,
  });
}

/**
 * The environment the process already carries, used once at activation to take over the
 * layer the launcher installed, so switching the proxy off really switches it off.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function envFromProcessEnv(env = process.env) {
  return mapLikeEnv({
    http_proxy: env.http_proxy ?? env.HTTP_PROXY,
    https_proxy: env.https_proxy ?? env.HTTPS_PROXY,
    all_proxy: env.all_proxy ?? env.ALL_PROXY,
    no_proxy: env.no_proxy ?? env.NO_PROXY,
  });
}

/** Diagnostic only: which proxy names the process environment sets (values are never returned). */
export function describeProcessEnv(env = process.env) {
  const names = [];
  for (const name of BASE_NAMES) {
    if (typeof env[name] === 'string' && env[name].trim() !== '') names.push(name);
    const upper = name.toUpperCase();
    if (typeof env[upper] === 'string' && env[upper].trim() !== '') names.push(upper);
  }
  return names;
}
