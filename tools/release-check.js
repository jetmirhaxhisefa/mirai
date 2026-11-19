#!/usr/bin/env node
// The release check (unit 12c): `node tools/release-check.js <tag>` exits 1 unless the tag is
// v + package.json's version. Run by .github/workflows/release.yml on a pushed v* tag.
import { packageInfo, tagProblem } from '../src/install/release.js';

const { version } = packageInfo();
const problem = tagProblem(process.argv[2] ?? '', version);
if (problem) {
  process.stderr.write(`release check: ${problem}\n`);
  process.exit(1);
}
process.stdout.write(`release check: ${process.argv[2]} is package.json's version\n`);
