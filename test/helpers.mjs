/**
 * Test helpers: locate a real `@deepseek-ai/dsh-http-proxy` and wait for async effects.
 *
 * The integration tests exercise the real library (a real undici global dispatcher) rather
 * than a stand-in. When no copy is reachable, those tests skip with a message instead of
 * failing, so the suite also runs on a machine without DSH installed.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Absolute path of a reachable proxy library entry, or undefined. */
export function findProxyLib() {
  const override = process.env.DSH_PROXY_SETTINGS_PROXY_LIB;
  if (typeof override === 'string' && override.trim() !== '' && existsSync(override.trim())) return override.trim();

  const candidates = [];
  const home = process.env.DSH_HOME;
  if (typeof home === 'string' && home.trim() !== '') {
    candidates.push(join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-http-proxy', 'lib', 'index.js'));
    candidates.push(join(home, 'profiles', 'desktop', 'node_modules', '@deepseek-ai', 'dsh-http-proxy', 'lib', 'index.js'));
  }
  // A checkout or an installed CLI on the current path.
  candidates.push(join(process.cwd(), 'node_modules', '@deepseek-ai', 'dsh-http-proxy', 'lib', 'index.js'));

  return candidates.find((candidate) => existsSync(candidate));
}

/** Wait until `predicate()` is true, or the timeout expires. */
export async function waitFor(predicate, timeoutMs = 3000, stepMs = 20) {
  const started = Date.now();
  for (;;) {
    if (predicate()) return true;
    if (Date.now() - started > timeoutMs) return false;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}
