import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { tempDir } from '../tests/run-fixture.js';

// Unit 38: stand-in `gh` and `glab` for the docs merge request (T4–T6, T8), as 27a/27b/29d's tests
// use them. No network: the host's git is a local bare repo (its branches), merge requests live in
// a JSON file, and a merge really merges in the bare repo, pinned to the head (another sha is
// refused, as GitHub's 409 and GitLab's "SHA does not match"). Every call is recorded with the
// environment the CLI got, so a test can check that glab only ever saw the GLAB_CONFIG_DIR given.

const common = (bare, state) => `
const fs = require('fs');
const { execFileSync } = require('child_process');
const S = ${JSON.stringify(state)};
const s = JSON.parse(fs.readFileSync(S, 'utf8'));
const a = process.argv.slice(2);
const e = process.env;
s.calls.push({ args: a, env: { GLAB_CONFIG_DIR: e.GLAB_CONFIG_DIR, GH_CONFIG_DIR: e.GH_CONFIG_DIR, HOME: e.HOME } });
const save = () => fs.writeFileSync(S, JSON.stringify(s));
const opt = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
const G = (...x) => execFileSync('/usr/bin/git', ['--git-dir', ${JSON.stringify(bare)}, '-c', 'user.email=h@example.invalid', '-c', 'user.name=Host', ...x]).toString().trim();
const tip = (b) => { try { return G('rev-parse', '--verify', '-q', 'refs/heads/' + b); } catch { return null; } };
const merge = (base, head, msg) => { const tree = G('merge-tree', '--write-tree', tip(base), head).split('\\n')[0]; const sha = G('commit-tree', '-p', tip(base), '-p', head, '-m', msg, tree); G('update-ref', 'refs/heads/' + base, sha); return sha; };
const out = (v) => { save(); process.stdout.write(JSON.stringify(v)); process.exit(0); };
`;

function stateFile(dir, init) {
  const state = join(dir, 'state.json');
  writeFileSync(state, JSON.stringify(init));
  const read = () => JSON.parse(readFileSync(state, 'utf8'));
  const write = (fn) => {
    const v = read();
    fn(v);
    writeFileSync(state, JSON.stringify(v));
  };
  return { state, read, write };
}

// GitHub: `s.ci` is the head's check runs ([{ name, status, conclusion }]); `s.mergeable` false
// with `s.mergeableState` ('blocked': a required review) holds the pull request.
export function fakeGh(bare) {
  const dir = tempDir('gh');
  const st = stateFile(dir, { prs: [], calls: [], ci: [], mergeable: true, mergeableState: 'clean' });
  const path = join(dir, 'gh');
  writeFileSync(path, `#!${process.execPath}
${common(bare, st.state)}
const err = (code, msg) => { save(); process.stderr.write('gh: ' + msg + ' (HTTP ' + code + ')\\n'); process.stdout.write(JSON.stringify({ message: msg })); process.exit(1); };
if (a[0] === 'auth') { save(); process.exit(0); }
if (a[0] === 'pr' && a[1] === 'list') out(s.prs.filter((p) => p.headRefName === opt('--head')).map((p) => ({ ...p, headRefOid: p.state === 'MERGED' ? p.headRefOid : tip(p.headRefName) })));
if (a[0] === 'pr' && a[1] === 'create') {
  const n = s.prs.length + 1;
  const url = 'https://github.com/acme/app/pull/' + n;
  s.prs.push({ number: n, state: 'OPEN', url, title: opt('--title'), body: fs.readFileSync(opt('--body-file'), 'utf8'), baseRefName: opt('--base'), headRefName: opt('--head'), headRefOid: tip(opt('--head')) });
  save(); process.stdout.write(url + '\\n'); process.exit(0);
}
if (a[0] === 'pr' && a[1] === 'edit') { const pr = s.prs.find((x) => x.number === Number(a[2])); pr.title = opt('--title'); pr.body = fs.readFileSync(opt('--body-file'), 'utf8'); out({}); }
if (a[0] === 'api') {
  const method = opt('--method') ?? 'GET';
  const p = a.find((x, i) => i > 0 && !x.startsWith('-') && a[i - 1] !== '--method' && a[i - 1] !== '--input');
  let m;
  if ((m = /git\\/ref\\/heads\\/(.+)$/.exec(p)) && method === 'GET') { const sha = tip(decodeURIComponent(m[1])); if (!sha) err(404, 'Not Found'); out({ object: { sha } }); }
  if ((m = /pulls\\/(\\d+)\\/merge$/.exec(p)) && method === 'PUT') {
    const pr = s.prs.find((x) => x.number === Number(m[1]));
    const body = JSON.parse(fs.readFileSync(opt('--input'), 'utf8'));
    const head = tip(pr.headRefName);
    if (body.sha !== head) err(409, 'Head branch was modified. Review and try the merge again.');
    const sha = merge(pr.baseRefName, head, 'Merge pull request #' + pr.number);
    pr.state = 'MERGED'; pr.mergeCommit = { oid: sha }; pr.headRefOid = head;
    out({ sha, merged: true, message: 'Pull Request successfully merged' });
  }
  if ((m = /pulls\\/(\\d+)$/.exec(p))) {
    const pr = s.prs.find((x) => x.number === Number(m[1]));
    if (!pr) err(404, 'Not Found');
    const head = pr.state === 'MERGED' ? pr.headRefOid : tip(pr.headRefName);
    out({ state: pr.state === 'OPEN' ? 'open' : 'closed', merged: pr.state === 'MERGED', head: { sha: head }, mergeable: s.mergeable, mergeable_state: s.mergeableState });
  }
  if (/check-runs/.test(p)) out({ check_runs: s.ci });
  if (/\\/status$/.test(p)) out({ statuses: [] });
}
save(); process.stderr.write('unknown call ' + a.join(' ') + '\\n'); process.exit(2);
`, { mode: 0o755 });
  return { path, ...st };
}

// GitLab (the project acme/app on gitlab.com): `s.pipeline` is the head pipeline's status, or
// null; `s.dms` GitLab's detailed_merge_status ('mergeable' by default).
export function fakeGlab(bare, { project = 'acme%2Fapp' } = {}) {
  const dir = tempDir('glab');
  const st = stateFile(dir, { mrs: [], calls: [], loggedIn: true, version: '1.130.0', pipeline: null, dms: 'mergeable' });
  const path = join(dir, 'glab');
  writeFileSync(path, `#!${process.execPath}
${common(bare, st.state)}
const notFound = (what) => { save(); process.stdout.write(JSON.stringify({ message: '404 ' + what + ' Not Found' })); process.stderr.write('glab: 404 ' + what + ' Not Found (HTTP 404)\\n'); process.exit(1); };
const fail = (code, msg) => { save(); process.stdout.write(JSON.stringify({ message: msg })); process.stderr.write('glab: ' + code + ' ' + msg + ' (HTTP ' + code + ')\\n'); process.exit(1); };
if (a[0] === '--version') { save(); process.stdout.write('glab ' + s.version + ' (abc)\\n'); process.exit(0); }
if (a[0] === 'auth') { save(); process.exit(s.loggedIn ? 0 : 1); }
if (a[0] === 'api') {
  const method = opt('--method');
  const p = a.at(-1);
  const m = /^projects\\/([^/]+)\\/(.*)$/.exec(p);
  if (!m || m[1] !== ${JSON.stringify(project)}) notFound('Project');
  const rest = m[2];
  const body = opt('--input') ? JSON.parse(fs.readFileSync(opt('--input'), 'utf8')) : null;
  const b = /^repository\\/branches\\/([^?]+)$/.exec(rest);
  if (b && method === 'GET') { const sha = tip(decodeURIComponent(b[1])); if (!sha) notFound('Branch'); out({ name: decodeURIComponent(b[1]), commit: { id: sha } }); }
  const view = (x) => ({ ...x, sha: x.state === 'merged' ? x.sha : tip(x.source_branch), detailed_merge_status: x.state === 'opened' ? s.dms : 'not_open', head_pipeline: s.pipeline ? { id: 7, status: s.pipeline } : null });
  if (rest.startsWith('merge_requests?') && method === 'GET') { const q = new URLSearchParams(rest.split('?')[1]); out(s.mrs.filter((x) => x.source_branch === q.get('source_branch')).map(view)); }
  if (rest === 'merge_requests' && method === 'POST') {
    const iid = s.mrs.length + 1;
    const mr = { iid, state: 'opened', web_url: 'https://gitlab.com/acme/app/-/merge_requests/' + iid, title: body.title, description: body.description, source_branch: body.source_branch, target_branch: body.target_branch, sha: tip(body.source_branch) };
    s.mrs.push(mr); out(view(mr));
  }
  const u = /^merge_requests\\/(\\d+)$/.exec(rest);
  if (u && method === 'PUT') { const mr = s.mrs.find((x) => x.iid === Number(u[1])); mr.title = body.title; mr.description = body.description; out(view(mr)); }
  if (u && method === 'GET') { const mr = s.mrs.find((x) => x.iid === Number(u[1])); if (!mr) notFound('Not'); out(view(mr)); }
  const g = /^merge_requests\\/(\\d+)\\/merge$/.exec(rest);
  if (g && method === 'PUT') {
    const mr = s.mrs.find((x) => x.iid === Number(g[1]));
    const head = tip(mr.source_branch);
    if (body.sha !== head) fail(409, 'SHA does not match HEAD of source branch');
    const sha = merge(mr.target_branch, head, 'Merge branch ' + mr.source_branch);
    mr.state = 'merged'; mr.merge_commit_sha = sha; mr.sha = head;
    out({ ...mr });
  }
}
save(); process.stderr.write('unknown call ' + a.join(' ') + '\\n'); process.exit(2);
`, { mode: 0o755 });
  return { path, ...st };
}
