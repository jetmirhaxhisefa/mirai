// Your own requirements list as requirements.md (unit 41; Jet's decision 6, Scope 9). A list you
// paste (or a file you give) keeps every line word for word, numbered REQ-1, REQ-2 … so the PRD
// can cite each one. Only list markers ("- ", "* ", "1. ", "[ ] "), blank lines, headings, rules
// and comments are taken off.

const MARKER = /^\s*(?:[-*+]|[0-9]{1,4}[.)]|\[[ xX]\])\s+/;
const REQ_ID = /^\s*(?:\*\*)?REQ-[0-9]{1,4}(?:\*\*)?:\s*/;

export function requirementLines(text) {
  return String(text).replace(/\r\n?/g, '\n').split('\n')
    .map((l) => l.replace(MARKER, '').replace(MARKER, '').replace(REQ_ID, '').trim())
    .filter((l) => l && !/^#{1,6}(\s|$)/.test(l) && !/^---+$/.test(l) && !/^<!--.*-->$/.test(l));
}

const yaml = (s) => JSON.stringify(String(s));

export function requirementsText({ initiative, lines, source, created }) {
  if (!lines.length) throw new Error('the list has no lines');
  return [
    '---',
    `id: ${initiative}-requirements`,
    'type: requirements',
    'template: requirements@v1',
    'owner: you',
    `created: ${yaml(created)}`,
    `source: ${yaml(source)}`,
    '---',
    `# Requirements: ${initiative}`,
    '',
    '## Requirements',
    '',
    ...lines.map((l, i) => `- REQ-${i + 1}: ${l}`),
    '',
  ].join('\n');
}
