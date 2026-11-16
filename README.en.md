# dsh-proxy-settings

[![ci](https://github.com/WangXianan456/dsh-proxy-settings/actions/workflows/ci.yml/badge.svg)](https://github.com/WangXianan456/dsh-proxy-settings/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/WangXianan456/dsh-proxy-settings/blob/main/LICENSE)

[简体中文](https://github.com/WangXianan456/dsh-proxy-settings/blob/main/README.md) · **English**

A network proxy section for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) **Settings**:
switch the outbound HTTP(S) proxy on or off, set its address and `NO_PROXY`, apply it to the
running process immediately, and persist it to `$DSH_HOME/.env` so the next start keeps it.

![The Network proxy section in DSH Settings: the switch, the proxy address, NO_PROXY, and the live state of the layer this process uses](https://raw.githubusercontent.com/WangXianan456/dsh-proxy-settings/main/docs/screenshot.png)

*Running in DSH: **Settings → Network proxy**. Saving applies the route to the running process
and writes it to `$DSH_HOME/.env`.*

This is an independent, unofficial plugin. It uses the proxy library DSH already ships
(`@deepseek-ai/dsh-http-proxy`) and adds the settings surface on top of it; it is not part of
DSH and not provided by DeepSeek.

## What it does

- Adds **Settings → Network proxy** with one switch, the proxy address, and `NO_PROXY`.
- **Applies immediately.** Saving installs a new proxy policy on top of the one the launcher
  installed, so the model requests and tool requests in the current process take the new
  route without a restart.
- **Really turns the proxy off.** Switching it off installs a direct layer above the
  launcher's proxy instead of only dropping this plugin's layer, so traffic goes direct until
  you switch it back on.
- **Persists it.** The four proxy names are written to `$DSH_HOME/.env` atomically, with a
  one-time `.env.bak`; every other line in that file is preserved byte for byte.
- **Shows the truth.** The section reports which layer is active, the route the proxy library
  itself resolves for a sample URL, and any diagnostics the library emitted.

## Install

Requires DSH 0.2.0 or newer (the plugin declares `engines.dsh`).

**From the GUI** — **Settings → Plugins → Add plugin**, then enter `dsh-proxy-settings`. The
bundle is installed into the current profile and selected.

**From a session** — ask the agent to install the bundle `dsh-proxy-settings`, or call
`plugin_manager` with `action: "install_bundle"` and `target: "dsh-proxy-settings"`.

**From a checkout** (development) — `plugin_manager` `install_bundle` with the absolute
directory of this repository as `target`. The profile then depends on the directory through a
`link:`, so edits are picked up on reload.

After installing, open a new session (or reload the page) and look for **Network proxy** in
Settings. If the entry is missing, check **Settings → Plugins** for an installation or
activation error.

## Use

1. Turn **Enable HTTP(S) proxy** on.
2. Enter an address such as `http://127.0.0.1:7890`. Only `http://` and `https://` are
   accepted; the proxy layer DSH ships does not support SOCKS, and the section says so
   instead of writing a value that would be ignored.
3. Optionally set `NO_PROXY`. Loopback is always direct, whatever you write.
4. **Save and apply**. The section then shows the live layer, the resolved route for
   `https://example.com/`, and where the configuration was written.

To undo it, switch the proxy off and save: the proxy lines are removed from `.env` and the
process goes direct immediately.

## What it changes on your machine

| Path | What happens |
|---|---|
| `$DSH_HOME/.env` | Only `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` (any letter case) are read or written. Comments and unrelated lines are preserved; the write is atomic (temporary file + rename) and the file never gets a BOM. |
| `$DSH_HOME/.env.bak` | A copy of the file as it was before the first write. Created once, never overwritten. |
| The running process | A proxy layer is installed on top of the launcher's. Uninstalling the plugin removes both layers. |

`$DSH_HOME` is resolved with `@deepseek-ai/dsh-home-paths` when the runtime provides it, and
with the same rule (`$DSH_HOME`, then `~/.dsh`) otherwise.

## How it works

The plugin holds two layers over the launcher's own proxy policy:

1. At activation it **adopts** the policy already in the process environment, so a later
   "off" can cover it.
2. **On** installs `installProxyFromEnvironment` with the proxy names from your configuration;
   **off** installs it with an empty environment, which resolves to a direct policy and
   installs a direct agent over the outer proxy.
3. On unload it disposes its layer, then the adopted one, returning the process to the
   launcher.

`fetch` in the Host process uses undici's global dispatcher, which is why the switch takes
effect without a restart. Work that runs outside this process — including the worker threads
DSH uses for generated code — does not inherit the policy; that is the library's design, not a
gap in this plugin.

The browser half is a plain classic script that registers one `settings.section` slot and its
English and Chinese dictionaries, so the copy follows the GUI language.

## Security notes

- The route lives on the loopback web server. It refuses a request whose `Origin` disagrees
  with `Host`, refuses `Sec-Fetch-Site: cross-site`, and requires JSON for `POST`, so a page on
  another origin cannot switch your proxy. A local process can already edit `.env` directly;
  this is not a boundary against that.
- A proxy address may contain credentials (`http://user:pass@host:port`). DSH stores the value
  as written in `.env`, in plain text, and the section shows it in the field so you can edit
  it. Use a proxy that does not need credentials, or accept that trade-off.
- A proxy you point DSH at can read and modify everything DSH sends through it. Set this only
  to an endpoint you trust.
- See [SECURITY.md](https://github.com/WangXianan456/dsh-proxy-settings/blob/main/SECURITY.md) for reporting a vulnerability.

## Compatibility

| | |
|---|---|
| DSH | `>=0.2.0` (`engines.dsh`). Rows, slots, and the proxy library this plugin relies on exist in that line. |
| Node.js | `>=22.12.0` (`engines.node`). |
| Host platforms | Windows, macOS, Linux. The code is plain Node; the integration tests run wherever a real `@deepseek-ai/dsh-http-proxy` is reachable. |
| Languages | English and Chinese (`locale/en.json`, `locale/zh.json`, and the client dictionaries). |

## Development

```sh
npm test          # unit + integration tests (node --test)
npm run preflight # release checklist: placeholders, packaging, manifest rules
```

The integration tests use the real proxy library when they can find one: set
`DSH_PROXY_SETTINGS_PROXY_LIB` to its `lib/index.js`, or point `DSH_HOME` at a Harness home
that has one. Without a library those tests skip and the rest still run.

The plugin has no build step: `lib/client.js` is a hand-written classic script that consumes
the platform `react` seed modules, and the Host half is plain ESM.

Releasing is described in [docs/PUBLISHING.md](https://github.com/WangXianan456/dsh-proxy-settings/blob/main/docs/PUBLISHING.md).

## Uninstall

Remove the bundle from **Settings → Plugins**. The proxy configuration in `.env` is left
alone, so DSH keeps using the proxy it was configured with; switch it off in the section
before removing the plugin, or delete the four proxy lines from `.env` by hand.

## License

[MIT](https://github.com/WangXianan456/dsh-proxy-settings/blob/main/LICENSE)
