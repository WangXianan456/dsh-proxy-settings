# Publishing

This repository is already configured for `WangXianan456/dsh-proxy-settings` and is shaped like
a publishable DSH bundle. What is left is the push and the npm publish.

## 1. Identity fields (already filled in)

For the record, these are the fields that make the package publishable. Change them only if the
repository or the maintainer changes:

```sh
npm pkg set author.name="WangXianan"
npm pkg set repository.url="git+https://github.com/WangXianan456/dsh-proxy-settings.git"
npm pkg set homepage="https://github.com/WangXianan456/dsh-proxy-settings#readme"
npm pkg set bugs.url="https://github.com/WangXianan456/dsh-proxy-settings/issues"
```

The copyright line in `LICENSE` and the advisory link in `SECURITY.md` carry the same identity.

## 2. Check it

```sh
npm run preflight   # placeholders, packaging rules, required files
npm test            # 39 tests; the ones needing a real proxy library skip without one
npm pack --dry-run  # the exact file list that will be published
```

`npm run preflight` fails while a field is still a placeholder, while `private` is still
`true`, and while a `files` entry points at nothing.

## 3. Push it

The repository is initialized and has its first commit; add the remote and push:

```sh
git remote add origin https://github.com/WangXianan456/dsh-proxy-settings.git
git push -u origin main
```

Suggested repository topics: `deepseek-harness`, `dsh`, `dsh-plugin`, `dsh-bundle`, `proxy`,
`settings`.

A repository is useful on its own: DSH can install a bundle straight from a Git address
pinned to a commit (`git+https://…#<commit>&path:/`), and the **Plugins** page can update a
Git-pinned copy later.

## 4. Publish to npm

```sh
npm login
npm publish --access public
```

The name `dsh-proxy-settings` was free when this repository was prepared; if it is taken by
now, either publish under a scope (`@YOUR_GITHUB_USER/dsh-proxy-settings`, and tell users to
install that name) or check with the owner of the name first — renaming the package later
breaks installations.

`npm publish` runs no install script by design: the plugin has no build step, and DSH's
installer would otherwise have to ask every user to approve one.

## 5. Verify the published copy before announcing it

Do it in a **separate profile**, so your working profile is untouched:

1. Install `dsh-proxy-settings` from **Settings → Plugins → Add plugin**.
2. Confirm the row: correct title, description, and icon in English and Chinese.
3. Open **Settings → Network proxy**, enable it with a local proxy you control, save, and check
   the live layer and the resolved route.
4. Confirm `.env` changed as documented, then switch it off and confirm the proxy lines are
   gone again.
5. Remove the bundle and confirm the section disappears.

## 6. Optional: reach users through Discover

The **Discover** page reads plugin market indexes, and a user adds index URLs in the app
(DSH ships no index by default). An index is one JSON document in the format that
`@deepseek-ai/dsh-plugin-market-index` validates; its entries carry the plugin name, versions,
`engines.dsh`, category, labels, and display metadata, and the entry page can render the
package README.

If you host an index (a file on GitHub Pages is enough), users add its URL once and then find,
read, and install the plugin from Discover. Keep the index updated when you publish a version:
the entry's version list is what the installer and the compatibility check read.

Being *listed in DeepSeek's own catalog* is a different matter: the official catalog ships
inside the DSH installation and is curated by DeepSeek. There is no self-service submission.
The practical route is to publish, keep the bundle compatible, and raise the feature upstream
if it belongs in DSH itself.

## 7. Later releases

1. Bump `version` (`npm version patch|minor|major`).
2. Update the compatibility table in both READMEs (`README.md` is Chinese, `README.en.md` is
   English) if DSH requirements changed.
3. `npm run preflight && npm test && npm publish`.
4. If you host a market index, add the new version there.

If a new DSH release breaks the plugin, narrow `engines.dsh` instead of shipping a version that
only half works: DSH refuses an incompatible bundle at install time and reports the unmet
requirement, which is a much better experience than a section that fails to render.
