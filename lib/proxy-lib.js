/**
 * Resolve `@deepseek-ai/dsh-http-proxy`, the proxy library DSH already ships.
 *
 * A profile bundle resolves official packages through the launcher's runtime resolution, so
 * a plain `import()` is the supported path. The `DSH_PROXY_SETTINGS_PROXY_LIB` override
 * exists for tests and for a runtime that maps official packages differently; nothing else
 * is guessed from the file system, because loading a second copy of the library would
 * silently install a second proxy stack.
 *
 * @module dsh-proxy-settings/proxy-lib
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE = '@deepseek-ai/dsh-http-proxy';

/** Read the version next to a resolved entry. Diagnostics only. */
function versionOf(entryUrl) {
  try {
    const manifest = join(dirname(dirname(fileURLToPath(entryUrl))), 'package.json');
    const json = JSON.parse(readFileSync(manifest, 'utf8'));
    return typeof json.version === 'string' ? json.version : undefined;
  } catch {
    return undefined;
  }
}

/** The public surface this plugin relies on. */
function usable(lib) {
  return (
    lib !== null &&
    typeof lib === 'object' &&
    typeof lib.installProxyFromEnvironment === 'function' &&
    typeof lib.proxyRouteFor === 'function'
  );
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<
 *   | {lib: object, source: 'package' | 'override', path?: string, version?: string, tried: string[]}
 *   | {lib: null, tried: string[]}
 * >}
 */
export async function loadProxyLib(env = process.env) {
  const tried = [];

  const override = env.DSH_PROXY_SETTINGS_PROXY_LIB;
  if (typeof override === 'string' && override.trim() !== '') {
    const path = override.trim();
    tried.push('override:' + path);
    try {
      const lib = await import(pathToFileURL(path).href);
      if (usable(lib)) return { lib, source: 'override', path, version: versionOf(pathToFileURL(path).href), tried };
      tried.push('override:missing installProxyFromEnvironment/proxyRouteFor');
    } catch (error) {
      tried.push('override:' + (error instanceof Error ? error.message : String(error)));
    }
  }

  tried.push(PACKAGE);
  try {
    const lib = await import(PACKAGE);
    if (usable(lib)) {
      let path;
      let version;
      try {
        const resolved = import.meta.resolve(PACKAGE);
        path = fileURLToPath(resolved);
        version = versionOf(resolved);
      } catch {
        /* resolution is diagnostics only */
      }
      return { lib, source: 'package', path, version, tried };
    }
    tried.push(PACKAGE + ':missing installProxyFromEnvironment/proxyRouteFor');
  } catch (error) {
    tried.push(PACKAGE + ':' + (error instanceof Error ? error.message : String(error)));
  }

  return { lib: null, tried };
}
