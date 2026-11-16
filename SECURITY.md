# Security policy

## Supported versions

The latest published release of `dsh-proxy-settings` receives fixes. A fix ships as a new
version; the plugin keeps no configuration of its own beyond what it writes to
`$DSH_HOME/.env`.

## Reporting a vulnerability

Open a [private security advisory](https://github.com/YOUR_GITHUB_USER/dsh-proxy-settings/security/advisories/new)
or e-mail the maintainer instead of opening a public issue. Include the plugin version, the
DSH version, the Host platform, and the steps that reproduce the problem. A first answer
usually takes a few days.

## What this plugin is trusted to do

The Host half runs inside the DSH process with the user's permissions. It can:

- register one HTTP prefix route on the loopback web server;
- install and remove the process's outbound proxy policy;
- read and rewrite `$DSH_HOME/.env`, touching only the four proxy names and keeping a one-time
  `.env.bak`.

It does not open network connections of its own, does not read your conversations, and does
not phone home.

## Known and accepted risks

- **A proxy can read and modify traffic.** Pointing DSH at a proxy hands that endpoint
  everything DSH sends through it. Only configure a proxy you trust.
- **Credentials are stored in plain text.** If the proxy address contains `user:pass`, the
  value is written to `.env` as is and shown in the settings field. Use a credential-free
  proxy where possible.
- **The settings route is not an authorization boundary.** It is reachable on the loopback
  web server, and the guards (`Origin`/`Host` agreement, `Sec-Fetch-Site`, JSON-only `POST`)
  defend against cross-origin pages rather than against other local processes, which can
  already edit the same files.
- **`.env` is shared with DSH itself.** Only `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and
  `NO_PROXY` are accepted from the Harness-home file; putting other bootstrap names there
  makes DSH refuse to start. This plugin never writes anything else.
