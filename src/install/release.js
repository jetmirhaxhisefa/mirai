import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PACKAGE_ROOT } from './parts.js';

// Releases and the install command (unit 12c; Jet's decisions 1 and 2): MIRAI is installed with
// npm from a GitHub tag, `npm install -g github:<owner>/<repo>#v<version>`. The source is
// package.json's `repository`; a release is a `v<version>` tag on main.

const GITHUB = /^(?:git\+)?(?:https:\/\/github\.com\/|git@github\.com:|github:)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?$/;
const VERSION = /^\d+\.\d+\.\d+$/;

export function packageInfo(root = PACKAGE_ROOT) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const m = GITHUB.exec(String(url ?? ''));
  return { name: pkg.name, version: pkg.version, source: m ? `github:${m[1]}/${m[2]}` : null };
}

// The one command that installs (or updates the launcher to) `version`.
export function installCommand(version, { source = packageInfo().source } = {}) {
  if (!VERSION.test(String(version))) throw new TypeError(`not a release version: ${JSON.stringify(version)}`);
  if (!source) throw new TypeError('package.json names no GitHub repository');
  return `npm install -g ${source}#v${version}`;
}

// The release check (release.yml): the pushed tag must be `v` + package.json's version.
// Returns null when it matches, else what's wrong.
export function tagProblem(tag, version) {
  if (!VERSION.test(String(version))) return `package.json's version ${JSON.stringify(version)} isn't X.Y.Z`;
  if (tag !== `v${version}`) return `the tag ${JSON.stringify(tag)} isn't v${version}, package.json's version: bump the version in a PR first, or tag v${version}`;
  return null;
}
