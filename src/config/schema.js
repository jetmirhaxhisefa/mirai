import { closest } from '../util/closest.js';

// A small schema checker for parsed TOML (unit 03b). It collects every problem instead of
// stopping at the first, and never puts a value into a message (values may be secrets, and
// agents may read logs). Key names are shown only when they look like ordinary names.
//
// Node types:
//   { type: 'table', fields: { key: node }, required: [keys], map: node, keyPattern, check }
//   { type: 'array', items: node, minItems, uniqueBy }
//   { type: 'string', pattern, patternHint, check }
//   { type: 'integer', min, max }
//   { type: 'number', min, max }               any finite number (unit 05b)
//   { type: 'boolean' }
//   { type: 'enum', values: [...] }
//   { type: 'choice', pick: (value) => node }   one of several shapes, chosen by the value
// `map` validates every key of a table whose keys are free names (named checks, resources).
// `check(value, path, report)` adds rules that span several keys.
//
// Every problem has a stable `code`: required, unknown-key, bad-name, type, range, enum,
// pattern, duplicate, or a code chosen by a `check` (for example never-auto, credential).

// Validates `value` against `node`. `locate(path)` returns `{ source, line, column, type }`
// for a key path (or the nearest known parent). Returns the collected problems.
export function validate(value, node, locate) {
  const problems = [];
  const report = (path, reason, hint, code = 'invalid') => {
    const at = locate(path);
    problems.push({ code, source: at.source, line: at.line, column: at.column, path: safePath(path), reason, hint });
  };
  check(value, node, '', report, locate);
  return problems;
}

// A key is shown in messages only when it looks like an ordinary name: short, no token shape.
const SAFE_KEY = /^[A-Za-z0-9_-]{1,32}$/;
const TOKENISH = /(gh[a-z]_|github_pat_|glpat-|sk-|xox[a-z]-|AKIA|AIza)/;
export const showKey = (key) => (SAFE_KEY.test(key) && !TOKENISH.test(key) ? key : '<key>');
export const safePath = (path) => path.split('.').map((part) => {
  const m = /^([^[]*)(\[\d+\].*)?$/.exec(part);
  return m && m[1] ? showKey(m[1]) + (m[2] ?? '') : part;
}).join('.');

const join = (base, key) => (base ? `${base}.${key}` : key);
const label = (path) => safePath(path) || 'the file';

function check(value, node, path, report, locate) {
  switch (node.type) {
    case 'table':
      return checkTable(value, node, path, report, locate);
    case 'array':
      return checkArray(value, node, path, report, locate);
    case 'choice':
      return check(value, node.pick(value), path, report, locate);
    case 'string':
      if (typeof value !== 'string') return report(path, `${label(path)} must be a string`, undefined, 'type');
      if (node.pattern && !node.pattern.test(value)) return report(path, `${label(path)} is not valid`, node.patternHint, 'pattern');
      return runCheck(node, value, path, report, locate);
    case 'integer': {
      const isFloat = typeof value === 'number' && locate(path).type === 'float';
      const isInt = typeof value === 'number' && Number.isInteger(value) && !isFloat;
      if (!isInt) return report(path, `${label(path)} must be a whole number`, isFloat ? 'write it without a decimal point' : undefined, 'type');
      if ((node.min !== undefined && value < node.min) || (node.max !== undefined && value > node.max)) {
        return report(path, `${label(path)} must be between ${node.min ?? '-∞'} and ${node.max ?? '∞'}`, undefined, 'range');
      }
      return runCheck(node, value, path, report, locate);
    }
    case 'number':
      // Any finite number, fractions allowed (unit 05b: shares and minutes).
      if (typeof value !== 'number' || !Number.isFinite(value)) return report(path, `${label(path)} must be a number`, undefined, 'type');
      if ((node.min !== undefined && value < node.min) || (node.max !== undefined && value > node.max)) {
        return report(path, `${label(path)} must be between ${node.min ?? '-∞'} and ${node.max ?? '∞'}`, undefined, 'range');
      }
      return runCheck(node, value, path, report, locate);
    case 'boolean':
      if (typeof value !== 'boolean') return report(path, `${label(path)} must be true or false`, undefined, 'type');
      return runCheck(node, value, path, report, locate);
    case 'enum':
      if (!node.values.includes(value)) return report(path, `${label(path)} must be one of: ${node.values.join(', ')}`, undefined, 'enum');
      return runCheck(node, value, path, report, locate);
    default:
      throw new Error(`unknown schema node type "${node.type}" at ${label(path)}`);
  }
}

function runCheck(node, value, path, report, locate) {
  if (node.check) node.check(value, path, report, locate);
}

function isTable(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkTable(value, node, path, report, locate) {
  if (!isTable(value)) return report(path, `${label(path)} must be a table`, undefined, 'type');
  const fields = node.fields ?? {};
  for (const key of Object.keys(value)) {
    const child = join(path, key);
    if (Object.hasOwn(fields, key)) {
      check(value[key], fields[key], child, report, locate);
    } else if (node.map) {
      if (node.keyPattern && !node.keyPattern.test(key)) {
        report(child, `a key in ${label(path)} is not a valid name`, node.keyHint, 'bad-name');
      } else {
        check(value[key], node.map, child, report, locate);
      }
    } else {
      const near = closest(key, Object.keys(fields));
      report(child, `unknown key ${label(child)}`, near ? `did you mean "${near}"?` : `known keys: ${Object.keys(fields).join(', ')}`, 'unknown-key');
    }
  }
  for (const key of node.required ?? []) {
    if (value[key] === undefined) report(path, `${join(label(path) === 'the file' ? '' : label(path), key)} is required`, node.requiredHints?.[key], 'required');
  }
  return runCheck(node, value, path, report, locate);
}

function checkArray(value, node, path, report, locate) {
  if (!Array.isArray(value)) return report(path, `${label(path)} must be an array`, undefined, 'type');
  if (node.minItems && value.length < node.minItems) report(path, `${label(path)} needs at least ${node.minItems} item(s)`, undefined, 'range');
  value.forEach((item, i) => check(item, node.items, `${path}[${i}]`, report, locate));
  if (node.uniqueBy) {
    const seen = new Set();
    value.forEach((item, i) => {
      const key = isTable(item) ? item[node.uniqueBy] : undefined;
      if (key === undefined) return;
      if (seen.has(key)) report(`${path}[${i}].${node.uniqueBy}`, `${label(path)}[${i}].${node.uniqueBy} repeats an earlier entry`, undefined, 'duplicate');
      seen.add(key);
    });
  }
  return runCheck(node, value, path, report, locate);
}
