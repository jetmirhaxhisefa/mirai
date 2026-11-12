import { isAbsolute, relative, sep } from 'node:path';

import { plain } from '../status/text.js';

// Progress while a step runs (unit 21e): what a launch shows you, from the stream it already
// reads, and nothing else. A tool call shows its name; a file tool, the path (relative to the
// project, or "outside the project"); MIRAI's run_tests and run_check, the level or check. Never
// the agent's text, a Bash command or a tool's output: anything the agent wrote could carry
// anything, so none of it reaches your terminal or the heartbeat.

const MAX = 120;
const NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
// A path is shown only when it's plain (21e review): ASCII letters, digits and ._@+/- , no spaces,
// no segment long enough to be a secret or a token; else "a file". The agent chooses the path, so
// look-alike or padded text could otherwise pass for one of MIRAI's own lines.
const PLAIN_PATH = /^[A-Za-z0-9._@+/-]{1,200}$/;
const plainPath = (p) => PLAIN_PATH.test(p) && !p.split('/').some((seg) => /^[A-Za-z0-9_-]{32,}$/.test(seg));
// Claude Code's own tools; anything else (a made-up name in a tool_use) is "a tool".
const KNOWN_TOOLS = new Set(['Bash', 'Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep', 'TodoWrite', 'StructuredOutput', 'Task', 'Agent', 'WebFetch', 'WebSearch', 'BashOutput', 'KillShell', 'ExitPlanMode']);
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep']);
const LEVEL_TOOLS = new Set(['mcp__mirai__run_tests', 'mcp__mirai__run_check']);
// The head of a long path, never its tail (the part an agent pads).
const short = (s) => (s.length > MAX ? `${s.slice(0, MAX - 1)}…` : s);

// A tool call's { tool, target }: target is null where nothing safe can be said. `tools`: the
// launch's own tool names (MIRAI's MCP tools among them); `levels`: the project's level and check
// names; a name outside them is "a tool" or no level (21e review).
export function describeTool(block, root, { tools = null, levels = null } = {}) {
  const raw = typeof block?.name === 'string' ? block.name : '';
  // One of the launch's own tools when they're known (21e re-review), else one of Claude Code's.
  const known = NAME.test(raw) && (tools ? tools.includes(raw) : KNOWN_TOOLS.has(raw));
  const tool = known ? raw : 'a tool';
  const input = block?.input && typeof block.input === 'object' && !Array.isArray(block.input) ? block.input : {};
  let target = null;
  if (FILE_TOOLS.has(tool)) {
    const p = typeof input.file_path === 'string' ? input.file_path : typeof input.path === 'string' ? input.path : typeof input.notebook_path === 'string' ? input.notebook_path : null;
    if (p !== null) {
      const rel = isAbsolute(p) ? relative(root, p) : p;
      target = rel === '' ? '.' : rel.split(sep).includes('..') || isAbsolute(rel) || rel.includes('\\') ? 'outside the project' : plainPath(rel) ? short(rel) : 'a file';
    }
  } else if (LEVEL_TOOLS.has(tool)) {
    const level = input.level ?? input.name ?? input.check;
    if (typeof level === 'string' && NAME.test(level) && (levels === null || levels.includes(level))) target = level;
  }
  return { tool: LEVEL_TOOLS.has(tool) ? tool.replace('mcp__mirai__', '') : tool, target };
}

// A tracker for one launch: `seen(event)` returns a progress event, or null. Turns count the
// agent's messages; minutes run from the start.
export function progressTracker({ root, agent = null, model = null, tools = null, levels = null, now = () => Date.now() }) {
  const started = now();
  let turns = 0;
  // A turn is one of the agent's own messages: Claude Code sends one event per content block, all
  // with the message's id, and a subagent's carry parent_tool_use_id (21e review).
  const messages = new Set();
  let modelUsed = model;
  // How often each tool was called (unit 28): the run log's per-launch summary, never each call.
  const calls = new Map();
  const base = () => ({ agent, model: modelUsed, turns, minutes: Math.round((now() - started) / 600) / 100 });
  return {
    toolCalls: () => [...calls].sort(([a], [b]) => a.localeCompare(b)).map(([tool, n]) => ({ tool, n })),
    seen(ev) {
      if (ev?.type === 'system' && ev.subtype === 'init') {
        if (typeof ev.model === 'string' && NAME.test(ev.model)) modelUsed = ev.model;
        return { kind: 'started', ...base() };
      }
      if (ev?.type !== 'assistant' || ev.parent_tool_use_id) return null;
      const id = typeof ev.message?.id === 'string' ? ev.message.id : null;
      if (id === null || !messages.has(id)) {
        if (id !== null) messages.add(id);
        turns += 1;
      }
      // A content that isn't a list (a string, a number) says nothing: never a throw (21e review).
      const content = Array.isArray(ev.message?.content) ? ev.message.content : [];
      for (const b of content.filter((x) => x?.type === 'tool_use')) {
        const { tool } = describeTool(b, root, { tools, levels });
        const name = tool === 'a tool' ? 'other' : tool;
        if (calls.has(name) || calls.size < 40) calls.set(name, (calls.get(name) ?? 0) + 1);
      }
      const call = content.filter((b) => b?.type === 'tool_use').at(-1);
      return call ? { kind: 'tool', ...base(), ...describeTool(call, root, { tools, levels }) } : null;
    },
    end(outcome) {
      return { kind: 'ended', ...base(), outcome: /^[a-z][a-z -]{0,40}$/.test(String(outcome)) ? outcome : 'ended' };
    },
  };
}

// The model's short name: "claude-sonnet-5-5" → "Sonnet".
const family = (model) => {
  const m = /claude-(opus|sonnet|haiku|fable)/i.exec(String(model ?? ''));
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
};

// One line for a progress event.
export function progressLine(p) {
  const who = `${p.agent ?? 'the agent'}${family(p.model) ? ` (${family(p.model)})` : ''}`;
  if (p.kind === 'preparing') return `${who}: preparing the launch (MIRAI's checks and the red team's gate)`;
  if (p.kind === 'still' && p.stage === 'preparing') return `${who}: still preparing the launch`;
  if (p.kind === 'started') return `${who}: started`;
  const head = `${who}: ${p.turns} turn${p.turns === 1 ? '' : 's'}, ${p.minutes} min`;
  if (p.kind === 'ended') return `${head} — ${p.outcome}`;
  if (p.kind === 'still') return `${head} — still working${p.tool ? ` (last: ${p.tool}${p.target ? ` ${p.target}` : ''})` : ''}`;
  return `${head} — ${p.tool}${p.target ? ` ${p.target}` : ''}`;
}

// A check or level, starting or done: { kind: 'check', name, state: 'running' | verdict, seconds }.
export function checkLine(c) {
  const name = NAME.test(String(c.name)) ? c.name : 'a check';
  if (c.state === 'running') return `MIRAI's checks: ${name} running…`;
  return `MIRAI's checks: ${name} ${plain(String(c.state)).slice(0, 60)}${Number.isFinite(c.seconds) ? ` (${Math.round(c.seconds)} s)` : ''}`;
}
