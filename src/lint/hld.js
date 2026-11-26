import { tableIn } from './checks.js';
import { checkOpenMarks } from './open.js';
import { documentWords } from './prd.js';
import { repoPath } from './repo.js';
import { isRetired } from './retired.js';
import { checkDecisionLines } from './tech-note.js';

// The HLD's own lint (unit 62, Scope 2, and its re-check against 63–65), beyond the generic rules
// (sections, the PRD link, cited FR/NFR IDs, D-n defined once in Decisions) and the summary and
// writing checks:
// - `lld`: required with its triggers, or not-required with a reason (63);
// - each optional section filled, or `Omitted: <a reason of a few words>` (arc42);
// - the diagrams: a context diagram (Person: or External:) in Context and scope, a container
//   diagram (Container:) in Building blocks, at least one sequenceDiagram in Key flows;
// - Current state: each bullet cites `path:line` or says "unverified" (64);
// - the components table (Component | Responsibility | Owner | Path): each path exists, or (new);
// - quality goals: each cites an NFR-n and has a number; more than five warns;
// - Decisions: the D-n lines, as the technical note's (ADR links accepted or proposed);
// - "Decisions for you": each item lettered (A:, B:, …), one "(recommended)", "Written for: <letter>"
//   (65's sitting records your letter); or "None — <why>";
// - the trace table: every FR and NFR of the PRD has a row and no other ID does; each component is
//   in the components table, or `deferred: <reason>`; each decision a D-n of this HLD or an ADR its
//   Decisions link;
// - `(open)` (44); the whole document past [docs.limits] hld_words (4,000) warns, naming the LLD.

const clip = (t) => (t.length > 60 ? `${t.slice(0, 57)}…` : t);
const OPTIONAL = ['Deployment', 'Observability', 'Failure modes', 'Test strategy', 'Constraints', 'Glossary'];

function section(doc, name) {
  const h = doc.scan.headings.find((x) => x.level === 2 && x.text === name);
  if (!h) return null;
  const next = doc.scan.headings.find((x) => x.line > h.line && x.level <= 2);
  const end = next ? next.line : Infinity;
  const lines = doc.scan.lines.filter((l) => l.line > h.line && l.line < end);
  const fences = (doc.scan.fences ?? []).filter((f) => f.line > h.line && f.line < end);
  return { heading: h, lines, text: lines.filter((l) => l.kind === 'text' && (l.visible ?? l.text).trim()), fences };
}
const fenceText = (f) => (f.body ?? []).map((b) => b.text).join('\n');
const mermaidOf = (sec) => (sec?.fences ?? []).filter((f) => /^mermaid\b/i.test(String(f.info ?? '').trim())).map(fenceText);

export function checkHld(doc, def, ctx, add) {
  const { value } = doc;
  const title = doc.scan.headings.find((h) => h.level === 1);
  const top = { line: title?.line ?? doc.bodyLine, column: 1 };
  const at = (key) => {
    const p = doc.positions.get(key);
    return { line: p?.line ?? 1, column: p?.valueColumn ?? 1 };
  };

  // The LLD line (63).
  if (value.lld === 'required' && !(Array.isArray(value.lld_triggers) && value.lld_triggers.length)) add({ code: 'hld-lld', ...at('lld'), reason: 'lld: required names no trigger', hint: 'add lld_triggers: [entity, contract, modules, state], the ones that fire' });
  if (value.lld === 'not-required' && !(typeof value.lld_reason === 'string' && value.lld_reason.trim().split(/\s+/).length >= 3)) add({ code: 'hld-lld', ...at('lld'), reason: 'lld: not-required gives no reason', hint: 'add lld_reason: <why no LLD is needed, in a few words>' });

  // Optional sections: filled, or Omitted with a reason.
  for (const name of OPTIONAL) {
    const sec = section(doc, name);
    if (!sec) continue;
    const first = sec.text[0] ? (sec.text[0].visible ?? sec.text[0].text).trim() : '';
    if (/^Omitted:/i.test(first)) {
      const reason = first.replace(/^Omitted:\s*/i, '');
      if (reason.split(/\s+/).filter(Boolean).length < 3 || sec.text.length > 1 || sec.fences.length) add({ code: 'hld-omitted', line: sec.text[0].line, column: 1, reason: `"${name}" is omitted without a reason of its own line`, hint: 'write it as the section\'s only line: Omitted: <the reason, in a few words>' });
    }
  }

  // The diagrams.
  const ctxSec = section(doc, 'Context and scope');
  if (ctxSec && !mermaidOf(ctxSec).some((m) => /^\s*(?:flowchart|graph)\b/m.test(m) && /(?:Person|External):/.test(m))) add({ code: 'hld-diagram', line: ctxSec.heading.line, column: 1, reason: 'Context and scope has no context diagram', hint: 'a ```mermaid flowchart with Person: and External: labels around the system' });
  const blocks = section(doc, 'Building blocks');
  if (blocks && !mermaidOf(blocks).some((m) => /^\s*(?:flowchart|graph)\b/m.test(m) && /Container:/.test(m))) add({ code: 'hld-diagram', line: blocks.heading.line, column: 1, reason: 'Building blocks has no container diagram', hint: 'a ```mermaid flowchart with Container: labels' });
  const flows = section(doc, 'Key flows');
  if (flows && !mermaidOf(flows).some((m) => /^\s*sequenceDiagram\b/m.test(m))) add({ code: 'hld-diagram', line: flows.heading.line, column: 1, reason: 'Key flows has no sequence diagram', hint: 'one ```mermaid sequenceDiagram per key flow, with its error path' });

  // Current state: cited or unverified.
  const current = section(doc, 'Current state');
  const raw = String(doc.text ?? '').split('\n');
  const rawLine = (n) => raw[n - 1 + (doc.text && raw.length > n ? 0 : 0)] ?? '';
  for (const l of current?.text ?? []) {
    const t = (l.visible ?? l.text);
    if (!/^ {0,3}[-*+][ \t]/.test(t)) continue;
    const cited = [...rawLine(l.line).matchAll(/`([^`]+):([0-9]+)(?:-[0-9]+)?`/g)];
    if (!cited.length && !/\bunverified\b/i.test(t)) add({ code: 'hld-current', line: l.line, column: 1, reason: `"${clip(t.replace(/^ *[-*+][ \t]+/, ''))}" cites no code`, hint: 'end it with `path:line`, or say "unverified" when it couldn\'t be checked' });
    for (const c of cited) {
      const p = repoPath(c[1]);
      if (p && ctx.repo && !ctx.repo.exists(p)) add({ code: 'hld-current', line: l.line, column: 1, reason: `${clip(p)} doesn't exist in the repo`, hint: 'correct the path, or say "unverified"' });
    }
  }

  // The components table.
  const comp = tableIn(doc, 'Building blocks');
  const components = new Set();
  if (blocks && !comp) add({ code: 'hld-components', line: blocks.heading.line, column: 1, reason: 'Building blocks has no components table', hint: '| Component | Responsibility | Owner | Path |' });
  if (comp) {
    const [name, , , pathCol] = comp.columns;
    for (const row of comp.rows) {
      const n = (row.cells[name] ?? '').trim();
      if (n) components.add(n.toLowerCase());
      const raw = (row.raw?.[pathCol] ?? row.cells[pathCol] ?? '').trim();
      if (!raw) {
        add({ code: 'hld-components', line: row.line, column: 1, reason: `${clip(n)} names no path`, hint: 'its path in backticks, or (new) for a file to be created' });
        continue;
      }
      if (/\(new\)/i.test(raw)) continue;
      for (const m of raw.matchAll(/`([^`]+)`/g)) {
        const p = repoPath(m[1]);
        if (p && ctx.repo && !ctx.repo.exists(p)) add({ code: 'hld-components', line: row.line, column: 1, reason: `${clip(p)} doesn't exist in the repo`, hint: 'correct the path, or mark it (new)' });
      }
    }
  }

  // Quality goals.
  const goals = section(doc, 'Goals and quality goals');
  const bullets = (goals?.text ?? []).filter((l) => /^ {0,3}[-*+][ \t]/.test(l.visible ?? l.text));
  if (goals && !bullets.length) add({ code: 'hld-quality', line: goals.heading.line, column: 1, reason: 'no quality goals', hint: 'three to five scenarios, each citing an NFR-n with its number' });
  for (const l of bullets) {
    const t = (l.visible ?? l.text);
    const plainGoal = rawLine(l.line);
    if (!/\bNFR-[0-9]+\b/.test(t)) add({ code: 'hld-quality', line: l.line, column: 1, reason: `"${clip(t.replace(/^ *[-*+][ \t]+/, ''))}" cites no NFR`, hint: 'each quality goal is a scenario for an NFR-n of the PRD' });
    else if (!/[0-9]/.test(plainGoal.replace(/\bNFR-[0-9]+\b/g, ''))) add({ code: 'hld-quality', line: l.line, column: 1, reason: `"${clip(t.replace(/^ *[-*+][ \t]+/, ''))}" has no number`, hint: 'give the measure the PRD gives: "→ within 2 s"' });
  }
  if (bullets.length > 5) add({ code: 'hld-quality', severity: 'warning', line: goals.heading.line, column: 1, reason: `${bullets.length} quality goals; the top three to five are the ones the design is judged by`, hint: 'keep the ones that shape the design' });

  // Decisions.
  checkDecisionLines(doc, ctx, add, 'hld-decision');
  const decSec = section(doc, 'Decisions');
  const dIds = new Set();
  const adrIds = new Set();
  for (const l of decSec?.text ?? []) {
    const m = /^ {0,3}[-*+][ \t]+(?:\*\*)?(D-[0-9]+)/.exec(l.visible ?? l.text);
    if (m) dIds.add(m[1]);
    for (const a of l.text.match(/\bADR-[0-9]+\b|\badr-[0-9]+\b/g) ?? []) adrIds.add(a.toUpperCase());
  }

  // "Decisions for you": answerable at the sitting.
  const sum = doc.scan.headings.find((h) => h.level === 3 && h.text === 'Decisions for you');
  if (sum) {
    const next = doc.scan.headings.find((x) => x.line > sum.line && x.level <= 3);
    const items = doc.scan.lines.filter((l) => l.line > sum.line && (!next || l.line < next.line) && l.kind === 'text' && (l.visible ?? l.text).trim());
    const joined = items.map((l) => (l.visible ?? l.text).trim());
    if (!(joined.length === 1 && /^None — \S/.test(joined[0]))) {
      // Each numbered item and its continuation lines.
      const groups = [];
      items.forEach((l) => {
        const t = (l.visible ?? l.text);
        if (/^ {0,3}[0-9]{1,3}[.)][ \t]/.test(t)) groups.push({ line: l.line, text: t.trim() });
        else if (groups.length) groups.at(-1).text += ` ${t.trim()}`;
      });
      if (!groups.length) add({ code: 'hld-decisions-for-you', line: sum.line, column: 1, reason: '"Decisions for you" has no numbered decision', hint: 'number each: the question, its options A:, B:, one (recommended), and "Written for: <letter>"; or None — <why>' });
      for (const g of groups) {
        const letters = [...g.text.matchAll(/(?:^|[\s.?])([A-E]):\s/g)].map((x) => x[1]);
        const recommended = (g.text.match(/\(recommended\)/gi) ?? []).length;
        const written = /Written for:\s*([A-E])\b/.exec(g.text)?.[1];
        if (letters.length < 2) add({ code: 'hld-decisions-for-you', line: g.line, column: 1, reason: 'a decision for you needs at least two lettered options (A:, B:)', hint: 'the sitting records the letter you choose' });
        else if (recommended !== 1) add({ code: 'hld-decisions-for-you', line: g.line, column: 1, reason: `a decision for you marks ${recommended ? 'more than one' : 'no'} option (recommended)`, hint: 'mark exactly one option (recommended)' });
        else if (!written || !letters.includes(written)) add({ code: 'hld-decisions-for-you', line: g.line, column: 1, reason: 'a decision for you doesn\'t say which option the document is written for', hint: 'end it with "Written for: <the letter>"' });
      }
    }
  }

  // The trace table.
  const trace = tableIn(doc, 'Trace table');
  const traceSec = section(doc, 'Trace table');
  if (traceSec && !trace) add({ code: 'hld-trace', line: traceSec.heading.line, column: 1, reason: 'the trace table is missing', hint: '| ID | Component(s) | Decision | Note |' });
  if (trace) {
    for (const p of trace.problems ?? []) add({ code: 'hld-trace', line: p.line, column: 1, reason: p.reason });
    const [idCol, compCol, decCol] = trace.columns;
    const seen = new Set();
    for (const row of trace.rows) {
      const id = (row.cells[idCol] ?? '').trim();
      if (!/^N?FR-[0-9]+$/.test(id)) {
        add({ code: 'hld-trace', line: row.line, column: 1, reason: `a trace row names "${clip(id)}", which isn't an FR or NFR of the PRD`, hint: 'one row per FR-n and NFR-n' });
        continue;
      }
      seen.add(id);
      const c = (row.cells[compCol] ?? '').trim();
      if (/^deferred\b/i.test(c)) {
        if (!/^deferred:\s*\S+(?:\s+\S+){2,}/i.test(c)) add({ code: 'hld-trace', line: row.line, column: 1, reason: `${id} is deferred without a reason`, hint: 'deferred: <why, in a few words>' });
      } else if (!c) add({ code: 'hld-trace', line: row.line, column: 1, reason: `${id} names no component`, hint: 'a component from Building blocks, or deferred: <reason>' });
      else if (components.size) {
        for (const name of c.split(/,|\band\b/).map((x) => x.replace(/\(.*?\)/g, '').replace(/`/g, '').trim()).filter(Boolean)) {
          if (!components.has(name.toLowerCase())) add({ code: 'hld-trace', line: row.line, column: 1, reason: `${id}'s component "${clip(name)}" isn't in the components table`, hint: 'name it as Building blocks does' });
        }
      }
      const d = (row.cells[decCol] ?? '').trim();
      for (const ref of d.match(/\bD-[0-9]+\b/g) ?? []) if (!dIds.has(ref)) add({ code: 'hld-trace', line: row.line, column: 1, reason: `${id} cites ${ref}, which Decisions doesn't have` });
      for (const ref of d.match(/\bADR-[0-9]+\b|\badr-[0-9]+\b/g) ?? []) if (!adrIds.has(ref.toUpperCase())) add({ code: 'hld-trace', line: row.line, column: 1, reason: `${id} cites ${ref}, which Decisions doesn't link`, hint: 'link the ADR from a D-n line in Decisions' });
    }
    const up = ctx.upstream;
    if (up?.status === 'ok') {
      for (const prefix of ['FR', 'NFR']) {
        for (const id of up.ids.get(prefix)?.keys() ?? []) {
          const line = up.doc.scan.lines.find((l) => new RegExp(`^ *[-*+][ \\t]+(?:\\*\\*)?${id}(?:\\*\\*)?:`).test(l.text));
          if (line && isRetired(line.text.replace(/^ *[-*+][ \t]+/, ''))) continue;
          if (!seen.has(id)) add({ code: 'hld-trace', line: trace.line ?? traceSec.heading.line, column: 1, reason: `${id} of the PRD has no row in the trace table`, hint: `add | ${id} | <its component(s)> | <its decision> | |` });
        }
      }
    }
  }

  checkOpenMarks(doc, ctx, add, 'hld');

  // About 4,000 words in all: past it, detail belongs in the LLD.
  const cap = ctx.project?.limits?.hld_words ?? 4000;
  const n = documentWords(doc, def);
  if (n > cap) add({ code: 'hld-length', severity: 'warning', ...top, reason: `the HLD has ${n} words, past ${cap}`, hint: 'move per-epic detail, tables, endpoints and data models into an LLD (unit 63)' });
}
