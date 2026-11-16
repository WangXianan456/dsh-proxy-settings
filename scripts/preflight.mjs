#!/usr/bin/env node
/**
 * Release preflight: fail while the checkout is still a template.
 *
 * Run it before the first push and before every publish. It checks the fields a publisher
 * has to fill in and the packaging rules a DSH bundle has to satisfy.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const problems = [];
const warnings = [];

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

for (const field of ['name', 'version', 'description', 'license']) {
  if (typeof pkg[field] !== 'string' || pkg[field].trim() === '') problems.push('package.json is missing "' + field + '"');
}

const placeholders = ['YOUR_GITHUB_USER', 'YOUR_NAME', 'YOUR-NAME', 'example.com'];
for (const [field, value] of [
  ['repository.url', pkg.repository?.url],
  ['homepage', pkg.homepage],
  ['bugs.url', pkg.bugs?.url],
  ['author.name', pkg.author?.name],
]) {
  if (typeof value !== 'string' || value.trim() === '') {
    problems.push('package.json "' + field + '" is not set');
    continue;
  }
  for (const placeholder of placeholders) {
    if (value.includes(placeholder)) problems.push('package.json "' + field + '" still says ' + placeholder);
  }
}

if (pkg.private === true) problems.push('package.json still has private: true');
if (pkg.dsh?.bundle?.patch === undefined) problems.push('package.json does not declare dsh.bundle.patch');
if (pkg.dsh?.client?.platform !== 'web') problems.push('package.json does not declare dsh.client.platform = web');
if (pkg.engines?.dsh === undefined) warnings.push('package.json has no engines.dsh range; every DSH release will be accepted');

for (const entry of pkg.files ?? []) {
  if (!existsSync(join(ROOT, entry))) problems.push('package.json files entry does not exist: ' + entry);
}
for (const required of ['README.md', 'README.en.md', 'LICENSE']) {
  if (!existsSync(join(ROOT, required))) problems.push('missing ' + required);
}

const license = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
if (/YOUR[_ -]NAME/i.test(license)) problems.push('LICENSE still carries the placeholder copyright holder');
if (pkg.scripts?.postinstall !== undefined) problems.push('package.json has a postinstall script; DSH would need the user to approve it');

for (const message of warnings) console.warn('warning: ' + message);
if (problems.length === 0) {
  console.log('preflight: OK — ' + pkg.name + '@' + pkg.version + ' looks publishable.');
  process.exit(0);
}
for (const problem of problems) console.error('problem: ' + problem);
process.exit(1);
