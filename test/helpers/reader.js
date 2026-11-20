import { writeToken } from '../../src/sign/token.js';
import { runReaderTest } from '../../src/write/reader.js';

// Unit 34: a fake reader for the tests. No model ever runs: the "launcher" reads the summary out of
// the prompt and answers as the test says. A stand-in token goes in the temp home.

export const FAKE_TOKEN = `sk-ant-oat01-${'Fake_reader_'.repeat(4)}`;
export const FAKE_CLAUDE = '/usr/bin/false';

// The summary between the reader prompt's markers, as the reader got it (zero-width spaces kept).
export function summaryFromPrompt(prompt) {
  const m = /^SUMMARY-([0-9a-f]+) BEGINS\n([\s\S]*)\nSUMMARY-\1 ENDS$/m.exec(prompt);
  return m ? m[2] : null;
}

// Quotes a careful reader would give: a line from each part, its list marker and IDs dropped.
export function quotesFrom(summary) {
  const clean = summary.replace(/​/g, '');
  const part = (name) => {
    const m = new RegExp(`^### ${name}\\n([\\s\\S]*?)(?=^### |(?![\\s\\S]))`, 'm').exec(clean);
    const line = (m?.[1] ?? '').split('\n').find((l) => /^\s*(?:[-*]|[0-9]+\.)\s+\S/.test(l)) ?? (m?.[1] ?? '').split('\n').find((l) => l.trim()) ?? '';
    return line.replace(/^\s*(?:[-*]|[0-9]+\.)\s+/, '').trim().split(/\s+/).slice(0, 8).join(' ');
  };
  return {
    built: { answer: 'What the summary says changes.', quote: part('What changes') },
    for_whom: { answer: 'The people the summary names.', quote: part('Why') },
    left_out: { answer: 'What the summary leaves out.', quote: part('Not in this') },
    decide: { answer: 'What the summary asks the approver.', quote: part('Decisions for you') },
  };
}

// A fake launcher: `answer(summary, call)` returns the reply text (or an object, sent as JSON).
// Each call is kept in `calls` ({ bin, args, env, cwd, prompt, summary, fdToken }).
export function fakeReader(answer = quotesFrom, { tools = [], model = 'claude-sonnet-5-5' } = {}) {
  const calls = [];
  const launch = async (bin, { args, env, cwd, fdToken }) => {
    const prompt = args[args.indexOf('-p') + 1];
    const summary = summaryFromPrompt(prompt);
    calls.push({ bin, args, env, cwd, prompt, summary, fdToken });
    const reply = answer(summary, calls.length);
    const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
    const stdout = [
      JSON.stringify({ type: 'system', subtype: 'init', tools, model, cwd }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }),
      JSON.stringify({ type: 'result', subtype: 'success', result: text }),
    ].join('\n');
    return { exit: 0, stdout, stderr: '', timedOut: false };
  };
  return { launch, calls };
}

// A passing reader-test result for `file` in the fixture `f` (its io), as `mirai reader-test` would
// record it.
export async function passReader(f, file, answer = quotesFrom) {
  try {
    writeToken(f.env, FAKE_TOKEN);
  } catch {
    // already there
  }
  const r = fakeReader(answer);
  const out = await runReaderTest({ cwd: f.root, env: f.env, file, launch: r.launch, claude: FAKE_CLAUDE });
  return { ...out, calls: r.calls };
}
