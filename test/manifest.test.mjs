/**
 * Manifest and packaging checks: what a publishable DSH bundle must declare, and what must
 * actually be on disk behind those declarations.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

test('package.json: identity and publication state', () => {
  assert.equal(pkg.name, 'dsh-proxy-settings');
  assert.match(pkg.version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  assert.equal(pkg.license, 'MIT');
  assert.notEqual(pkg.private, true, 'private:true would block publication');
  assert.match(pkg.description, /proxy/i);
  assert.ok(Array.isArray(pkg.keywords) && pkg.keywords.includes('dsh-plugin'));
});

test('package.json: a bundle needs dsh.bundle.patch and the file it names', () => {
  assert.equal(typeof pkg.dsh?.bundle?.patch, 'string');
  const patchPath = join(ROOT, pkg.dsh.bundle.patch);
  assert.ok(existsSync(patchPath), 'declared patch is missing: ' + pkg.dsh.bundle.patch);

  const patch = readFileSync(patchPath, 'utf8');
  assert.match(patch, /^-\s*insert:/m);
  assert.match(patch, new RegExp("id:\\s*" + pkg.name));
  assert.match(patch, new RegExp("name:\\s*'" + pkg.name + "'"));
});

test('package.json: the browser half is declared for the web platform', () => {
  assert.equal(pkg.dsh?.client?.platform, 'web');
  assert.equal(pkg.exports['./client'], './lib/client.js');
  assert.ok(existsSync(join(ROOT, 'lib', 'client.js')));
});

test('package.json: display metadata is exported', () => {
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json');
  assert.equal(pkg.exports['./icon'], './icon.svg');
  assert.equal(pkg.icon, 'icon.svg');
});

test('package.json: version requirements are declared', () => {
  assert.match(pkg.engines.dsh, /^[><=^~]/, 'engines.dsh must be a range');
  assert.match(pkg.engines.node, /^[><=^~]/, 'engines.node must be a range');
});

test('package.json: no install script (pnpm would block it without user approval)', () => {
  for (const name of ['preinstall', 'install', 'postinstall', 'prepare']) {
    assert.equal(pkg.scripts?.[name], undefined, 'unexpected install script: ' + name);
  }
});

test('package.json: every entry in files exists', () => {
  assert.ok(Array.isArray(pkg.files) && pkg.files.length > 0);
  for (const entry of pkg.files) {
    assert.ok(existsSync(join(ROOT, entry)), 'files entry is missing: ' + entry);
  }
});

test('README pair: Chinese is the default file and both link to each other', () => {
  const chinese = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const english = readFileSync(join(ROOT, 'README.en.md'), 'utf8');
  const repo = 'https://github.com/WangXianan456/dsh-proxy-settings/blob/main';

  assert.ok(chinese.includes(repo + '/README.en.md'), 'README.md must link README.en.md');
  assert.ok(english.includes(repo + '/README.md'), 'README.en.md must link README.md');
  assert.match(chinese, /\*\*简体中文\*\*/, 'README.md must mark Chinese as the current language');
  assert.match(english, /\*\*English\*\*/, 'README.en.md must mark English as the current language');
  assert.match(chinese, /[\u4e00-\u9fff]/, 'README.md is the Chinese document');
  assert.ok(pkg.files.includes('README.md') && pkg.files.includes('README.en.md'));
});

test('locale resources: both baseline locales carry a title and a description', () => {
  for (const language of ['en', 'zh']) {
    const path = join(ROOT, 'locale', language + '.json');
    assert.ok(existsSync(path), 'missing locale: ' + path);
    const json = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(typeof json.meta?.title, 'string');
    assert.equal(typeof json.meta?.description, 'string');
    assert.ok(json.meta.title.length > 0 && json.meta.description.length > 0);
  }
});

test('icon: an SVG inside the size limit', () => {
  const path = join(ROOT, 'icon.svg');
  const text = readFileSync(path, 'utf8');
  assert.match(text.trimStart(), /^<svg[\s>]/);
  assert.ok(statSync(path).size < 256 * 1024, 'icon must stay under 256 KiB');
});
