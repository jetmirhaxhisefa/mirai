import { SUMMARY_SECTION } from '../config/registry.js';
import { clip, summaryOf } from './summary.js';
import { BANNED, VAGUE, ACRONYMS } from './words.js';

// The writing rules (unit 31; research/13 §9c: GOV.UK, the Federal Plain Language Guidelines,
// Spec Kit). Six rules on the summary for approval, three on the detail (2, 3 and 5):
//   1. the summary's word budget (the type's summary_words, or the project's [docs.limits]):
//      fail over it, warn at 80%;
//   2. a sentence over 25 words fails, over 20 warns;
//   3. a banned word fails: GOV.UK's words to avoid, "etc.", and a vague adjective in a
//      sentence with no number;
//   4. a paragraph of more than 5 sentences fails;
//   5. an acronym must be spelled out at its first use, unless it's on the allowlist or an ID
//      prefix the type defines;
//   6. a list needs a lead-in: a heading or a line ending with ":".
// Code spans, code blocks, link targets, HTML comments and tables are never checked. Every
// message quotes the sentence or the word, and names the rule's fix (30c's messages).

export const SENTENCE_FAIL = 25;
export const SENTENCE_WARN = 20;
export const PARAGRAPH_SENTENCES = 5;

const LIST_ITEM = /^ *(?:[-*+]|[0-9]{1,9}[.)])[ \t]+/;
const TABLE = /^ *\|/;
// A list item's leading ID label ("FR-4: ", "AC-FR-4.1: ") names the item; it isn't part of the
// sentence (unit 32).
const ID_LABEL = /^(?:\*\*)?[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-[0-9]+(?:\.[0-9]+)?(?:\*\*)?(?::[ \t]*|[ \t]+—[ \t]+)/;
const words = (text) => (String(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’%-]*/gu) ?? []);

// Paragraphs: runs of text lines, a list item being its own paragraph (with its continuation
// lines). Returns [{ line, text, list, lines }].
function paragraphs(lines) {
  const out = [];
  let cur = null;
  for (const l of lines) {
    if (l.kind !== 'text' || TABLE.test(l.text)) {
      cur = null;
      continue;
    }
    const item = LIST_ITEM.test(l.text);
    if (item || !cur) {
      cur = { line: l.line, text: l.text.replace(LIST_ITEM, '').replace(ID_LABEL, ''), list: item, lines: [l] };
      out.push(cur);
    } else {
      cur.text += ` ${l.text.trim()}`;
      cur.lines.push(l);
    }
  }
  return out.map((p) => ({ ...p, text: p.text.replace(/\s+/g, ' ').trim() })).filter((p) => p.text);
}

// Sentences: split after . ! ? followed by a space and a capital or a digit (so "e.g. the" and
// "v1.2" don't split).
const sentencesOf = (text) => text.split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"“(])/u).map((s) => s.trim()).filter((s) => words(s).length);

export function checkWriting(doc, def, ctx, add) {
  const { scan } = doc;
  const s = summaryOf(scan);
  const inSummary = (l) => s && l.line > s.h2.line && l.line < s.end;
  const summaryLines = s ? s.lines : [];
  const detailLines = scan.lines.filter((l) => !inSummary(l) && l.kind !== 'heading');

  // 1. The word budget: the project's `[docs.limits] <type>_summary_words` (unit 32), else the type's.
  // A variant with its own budget (a full PRD: 1,000 words, Jet 2026-11-20) uses
  // `<type>_<variant>_summary_words`, else the variant's.
  const variant = def.variants?.[doc.value?.variant];
  const budget = variant?.summary_words
    ? ctx.project?.limits?.[`${def.name}_${doc.value.variant}_summary_words`] ?? variant.summary_words
    : ctx.project?.limits?.[`${def.name}_summary_words`] ?? def.summary_words;
  const kind = variant?.summary_words ? `${doc.value.variant} ${def.name}` : def.name;
  if (s && budget) {
    const count = summaryLines.filter((l) => l.kind === 'text' && !TABLE.test(l.text)).reduce((n, l) => n + words(l.text.replace(LIST_ITEM, '')).length, 0);
    if (count > budget) add({ code: 'writing-budget', line: s.h2.line, column: 1, reason: `the summary has ${count} words; a ${kind}'s budget is ${budget}`, hint: 'cut what the approver doesn\'t need to decide; the detail keeps it' });
    else if (count >= Math.ceil(budget * 0.8)) add({ code: 'writing-budget', severity: 'warning', line: s.h2.line, column: 1, reason: `the summary has ${count} words, close to the ${kind}'s budget of ${budget}`, hint: 'one page is the target' });
  }

  const ids = new Set((def.ids ?? []).map((k) => k.prefix));
  const definedAcronyms = new Set();
  const check = (lines, { summary }) => {
    const paras = paragraphs(lines);
    for (const p of paras) {
      const sentences = sentencesOf(p.text);
      // 4. Paragraph length (the summary only).
      if (summary && sentences.length > PARAGRAPH_SENTENCES) add({ code: 'writing-paragraph', line: p.line, column: 1, reason: `a paragraph of ${sentences.length} sentences, starting "${clip(sentences[0], 50)}"`, hint: `keep a paragraph to ${PARAGRAPH_SENTENCES} sentences: split it, or make a list` });
      for (const sentence of sentences) {
        // 2. Sentence length.
        const n = words(sentence).length;
        if (n > SENTENCE_FAIL) add({ code: 'writing-sentence', line: p.line, column: 1, reason: `a sentence of ${n} words: "${clip(sentence)}"`, hint: `keep sentences to ${SENTENCE_FAIL} words or fewer: split it, or make a list` });
        else if (n > SENTENCE_WARN) add({ code: 'writing-sentence', severity: 'warning', line: p.line, column: 1, reason: `a sentence of ${n} words: "${clip(sentence)}"`, hint: `aim for ${SENTENCE_WARN} words or fewer` });
        // 3. Banned and vague words.
        for (const [word, fix] of BANNED) {
          if (word.test(sentence)) add({ code: 'writing-word', line: p.line, column: 1, reason: `"${sentence.match(word)[0]}" in "${clip(sentence, 60)}"`, hint: fix });
        }
        if (!/[0-9]/.test(sentence)) {
          for (const v of VAGUE) {
            const m = new RegExp(`\\b${v}\\b`, 'i').exec(sentence);
            if (m) add({ code: 'writing-vague', line: p.line, column: 1, reason: `"${m[0]}" with no number in "${clip(sentence, 60)}"`, hint: `say how ${v} it must be, with a number someone can check (a time, a size, a rate)` });
          }
        }
        // 5. Acronyms spelled out at their first use.
        for (const m of sentence.matchAll(/(?<![\p{L}\p{N}-])([A-Z][A-Z0-9]{1,9})s?(?![\p{L}\p{N}]|-[0-9])/gu)) {
          const a = m[1];
          if (definedAcronyms.has(a) || ACRONYMS.has(a) || ids.has(a)) continue;
          const spelled = new RegExp(`\\(${a}s?\\)|\\b${a}s? \\(`).test(sentence);
          definedAcronyms.add(a);
          if (!spelled) add({ code: 'writing-acronym', line: p.line, column: 1, reason: `"${a}" isn't spelled out at its first use`, hint: `write it in full the first time, then the short form in brackets: "… (${a})"` });
        }
      }
    }
    // 6. A list's lead-in (the summary only): the line before a list is a heading or ends with ":".
    if (summary) {
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (l.kind !== 'text' || !LIST_ITEM.test(l.text)) continue;
        const prev = lines.slice(0, i).reverse().find((x) => x.kind !== 'blank' && x.kind !== 'comment');
        if (!prev || prev.kind === 'heading' || LIST_ITEM.test(prev.text) || /:\s*$/.test(prev.text) || (prev.kind === 'text' && /^\s{2,}\S/.test(l.text))) continue;
        add({ code: 'writing-list', line: l.line, column: 1, reason: `a list follows "${clip(prev.text, 50)}" with no lead-in`, hint: 'end the line before the list with ":", saying what the list is' });
      }
    }
  };
  // The summary first (the acronyms are spelled out where the reader meets them first), then the detail.
  if (s) check(scan.lines.filter((l) => l.line > s.h2.line && l.line < s.end), { summary: true });
  check(detailLines, { summary: false });
}

export { SUMMARY_SECTION };
