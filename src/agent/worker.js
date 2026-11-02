import { readFileSync } from 'node:fs';

import { globalConfigPath } from '../config/load.js';
import { startAgent, startOf } from '../mcp/tools/agents.js';
import { redact } from '../redteam/claude.js';
import { escapeInvisible } from '../status/text.js';
import { openStore } from '../store/home.js';
import { claimRequest, mintLaunchToken, writeStatus } from './requests.js';
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
    const checked = startAgent.check(raw ?? {});
    if (checked.refused) throw Object.assign(new Error(`the request's arguments aren't start_agent's: ${checked.refused}`), { code: 'bad-request' });
    const r = await runAgent({ ...checked.args, cwd: checkout, env, claude, plan: planFrom(env), signal, hardSignal, launchToken: mintLaunchToken(), ...(launch ? { launch } : {}) });
    const text = escapeInvisible(redact(r.text ?? '', null));
    writeStatus(store, id, {
      state: 'done', outcome: r.outcome, why: r.why ?? null, launch_id: r.launchId, model: r.line.model_used ?? r.line.model, tier: r.line.tier, rung: r.line.rung ?? null,
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
