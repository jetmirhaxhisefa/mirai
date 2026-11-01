#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readToken } from '../../src/sign/token.js';
import { redact } from '../../src/redteam/claude.js';
import { resolveClaude } from '../../src/redteam/key.js';
import { buildSessionFixture, realFolderFacts, removeFixture } from '../../src/redteam/session-run.js';

// Unit 18e's R2: one real terminal session (Claude Code's interface under /usr/bin/script, on a
// fixture, one Haiku prompt): does a command from its Bash see terminals, and /dev/tty? The token
// is in this run's environment (fd 3 doesn't survive script); the prompt only writes test results.
const realHome = realpathSync(process.env.HOME);
const workdir = realpathSync(mkdtempSync(join(realHome, '.mirai-probes-')));
const before = realFolderFacts(realHome);
const app = join(realHome, 'Projects', 'mirai-sample-app');
const fx = buildSessionFixture({ workdir, checkout: app, branch: 'main' });
const out = join(fx.home, 'tty-result');
const cfg = JSON.parse(readFileSync(join(fx.config, '.claude.json'), 'utf8'));
writeFileSync(join(fx.config, '.claude.json'), JSON.stringify({ ...cfg, hasCompletedOnboarding: true, theme: 'dark' }));
const command = `{ test -t 0 && echo stdin-tty || echo stdin-no; test -t 1 && echo stdout-tty || echo stdout-no; (: </dev/tty) 2>/dev/null && echo devtty-open || echo devtty-no; } > ${out}`;
const prompt = `Run this exact command with the Bash tool, once: ${command}`;
const feed = `sleep 12; printf '%s\\r' ${JSON.stringify(prompt).replace(/\$/g, '\\$')}; sleep 45; printf '/exit\\r'; sleep 3`;
const c = resolveClaude(process.env);
const token = readToken(process.env);
const r = spawnSync('/bin/sh', ['-c', `(${feed}) | /usr/bin/script -q /dev/null ${c.real} --model haiku --allowedTools Bash`], {
  cwd: fx.root, env: { ...fx.env, CLAUDE_CONFIG_DIR: fx.config, CLAUDE_CODE_OAUTH_TOKEN: token, TERM: 'xterm-256color' }, encoding: 'utf8', timeout: 120_000,
});
process.stdout.write(`exit ${r.status}\n${existsSync(out) ? readFileSync(out, 'utf8') : `no result file; end of screen: ${redact(String(r.stdout), token).replace(/\u001b\[[0-9;?]*[A-Za-z]/g, ' ').replace(/\s+/g, ' ').slice(-600)}`}\n`);
process.stdout.write(`real ~/.config/mirai unchanged: ${before === realFolderFacts(realHome) ? 'yes' : 'NO'}\n`);
removeFixture(workdir);
