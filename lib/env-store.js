/**
 * Harness-home resolution and `.env` file I/O: an atomic write with a one-time backup.
 *
 * Home resolution follows `@deepseek-ai/dsh-home-paths`: an explicit value, then
 * `$DSH_HOME`, then `~/.dsh`. The official implementation is imported when the runtime
 * provides it; the local fallback applies the same rule so the plugin still works in a
 * runtime that resolves official packages differently.
 *
 * @module dsh-proxy-settings/env-store
 */

import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME_ENV = 'DSH_HOME';

/** `configured > DSH_HOME > ~/.dsh`, with `~` expanded. */
export function fallbackDshHome(env = process.env) {
  const raw = env[HOME_ENV];
  const configured = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;
  if (configured === '~') return homedir();
  if (typeof configured === 'string' && (configured.startsWith('~/') || configured.startsWith('~\\'))) {
    return join(homedir(), configured.slice(2));
  }
  return configured ?? join(homedir(), '.dsh');
}

/**
 * Resolve the Harness home, preferring the official resolver.
 * @returns {Promise<{home: string, source: 'official' | 'fallback'}>}
 */
export async function resolveHarnessHome(env = process.env) {
  try {
    const homePaths = await import('@deepseek-ai/dsh-home-paths');
    if (typeof homePaths.resolveDshHome === 'function') {
      return { home: homePaths.resolveDshHome(undefined, env), source: 'official' };
    }
  } catch {
    /* fall through to the documented fallback */
  }
  return { home: fallbackDshHome(env), source: 'fallback' };
}

/** Read UTF-8 text; a missing file is `undefined` rather than an error. */
export async function readTextFile(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Write UTF-8 text atomically: a temporary file in the same directory, then a rename.
 *
 * A plain `writeFile` can be read half-written by the configuration watcher or by the user,
 * and a half-written `.env` parses as a broken line. Same-directory rename is atomic on
 * every platform this plugin targets, including Windows on one volume.
 *
 * @param {string} path - Absolute target path.
 * @param {string} text - UTF-8 contents, no BOM.
 * @param {{backup?: boolean}} [options] - With `backup`, copy the previous contents to
 *   `<path>.bak` once, when that file does not exist yet.
 * @returns {Promise<{backupPath?: string}>}
 */
export async function writeTextAtomic(path, text, options = {}) {
  let backupPath;
  if (options.backup === true) {
    const candidate = path + '.bak';
    if (!existsSync(candidate) && existsSync(path)) {
      const previous = await readFile(path, 'utf8');
      writeFileSync(candidate, previous, { encoding: 'utf8' });
      backupPath = candidate;
    }
  }
  const temp = path + '.tmp-' + process.pid.toString(36) + '-' + Date.now().toString(36);
  writeFileSync(temp, text, { encoding: 'utf8' });
  renameSync(temp, path);
  return backupPath === undefined ? {} : { backupPath };
}
