import { readFileSync } from 'node:fs';

import { globalConfigPath } from '../config/load.js';
import { startAgent, startOf } from '../mcp/tools/agents.js';
import { redact } from '../redteam/claude.js';
import { escapeInvisible, plain } from '../status/text.js';
import { openStore } from '../store/home.js';
import { claimRequest, mintLaunchToken, writeStatus } from './requests.js';
import { runCommand } from './command-worker.js';
import { progressLine } from './progress.js';
import { runAgent } from './run.js';

// The worker's side (unit 19c): claim the request with its token, then launch exactly as your
// terminal would, and leave the outcome where agent_status reads it. The request's arguments are
// checked again here, and only start_agent's own keys pass: the record is a file in the store.
const TEXT_TAIL = 32 * 1024;

function planFrom(env) {
  try {
    return /^\s*plan\s*=\s*"([a-z0-9][a-z0-9-]{0,31})"/m.exec(readFileSync(globalConfigPath(env.HOME), 'utf8'))?.[1] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function runWorker({ checkout, id, claude, token, env, launch, signal = null, hardSignal = null }) {
  let store;
  let claimed = false;
  try {
    store = openStore({ cwd: checkout, env });
    const raw = claimRequest(store, id, token);
    claimed = true;
    writeStatus(store, id, { state: 'running', pid: process.pid, started: startOf(process.pid) });
    // A command from your session (unit 21f): run as `mirai <command>` from the trust root's copy.
    if (raw?.kind === 'command') return await runCommand({ store, id, checkout, env, raw, claude: claude || null, signal, hardSignal });
    const checked = startAgent.check(raw ?? {});
    if (checked.refused) throw Object.assign(new Error(`the request's arguments aren't start_agent's: ${checked.refused}`), { code: 'bad-request' });
    // Progress for agent_status (unit 21f): 21e's filtered lines, the newest few, at most every 2 s.
    const lines = [];
    let wrote = 0;
    const onProgress = (p) => {
      lines.push(plain(progressLine(p)));
      if (lines.length > 40) lines.splice(0, lines.length - 20);
      if (Date.now() - wrote < 2_000 && p.kind === 'tool') return;
      wrote = Date.now();
      writeStatus(store, id, { state: 'running', pid: process.pid, started: startOf(process.pid), lines: lines.slice(-20) });
    };
    const r = await runAgent({ ...checked.args, cwd: checkout, env, fallbackClaude: claude || null, plan: planFrom(env), signal, hardSignal, launchToken: mintLaunchToken(), onProgress, ...(launch ? { launch } : {}) });
    const text = escapeInvisible(redact(r.text ?? '', null));
    writeStatus(store, id, {
      state: 'done', outcome: r.outcome, why: r.why ?? null, launch_id: r.launchId, lines: lines.slice(-20), model: r.line.model_used ?? r.line.model, tier: r.line.tier, rung: r.line.rung ?? null,
      // What the agent said, from inside the cage: text a branch may have steered, never instructions.
      reply_untrusted: text.length > TEXT_TAIL ? text.slice(-TEXT_TAIL) : text,
    });
    return r;
  } catch (err) {
    // A request that was never claimed belongs to whoever has its token; its status is left alone.
    if (store && (claimed || err.code === 'bad-request')) writeStatus(store, id, { state: 'done', outcome: 'refused', why: String(err.message).slice(0, 500), code: err.code ?? null });
    return { refused: err.code };
  }
}
