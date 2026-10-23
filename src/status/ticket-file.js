import { ConfigError } from '../cli/errors.js';
import { validate } from '../config/schema.js';
import { TICKET, PARK_REASONS } from './machines.js';

// The ticket status file (unit 04; D-06: one status home per ticket). It lives in the store
// (unit 05) and holds only what can't be derived. JSON, written one key per line. `seq` is
// the store journal's sequence number of this write (unit 05), which orders it against pushes
// and merges (D-06).

export const STATUS_SCHEMA_VERSION = 1;
export const STATUS_FILE_MAX_BYTES = 16 * 1024;
const WRITABLE = TICKET.states.filter((s) => !TICKET.derived.includes(s));
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const KEY_ORDER = ['schema_version', 'ticket', 'state', 'park_reason', 'replans', 'seq', 'written_at', 'written_by', 'note'];

const SCHEMA = {
  type: 'table',
  fields: {
    schema_version: { type: 'integer', min: 1 },
    ticket: { type: 'string', pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, patternHint: 'a ticket key such as "PROJ-123"' },
    state: { type: 'enum', values: WRITABLE },
    park_reason: { type: 'enum', values: PARK_REASONS },
    replans: { type: 'integer', min: 0, max: 1 },
    seq: { type: 'integer', min: 0 },
    written_at: {
      type: 'string',
      pattern: ISO_UTC,
      patternHint: 'a UTC time such as "2026-10-23T22:14:05Z"',
      check(value, path, report) {
        // Date.parse rolls 30 February over to March; a real time survives the round trip.
        const t = new Date(value);
        const same = !Number.isNaN(t.getTime()) && t.toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');
        if (!same) report(path, `${path} is not a real time`, undefined, 'pattern');
      },
    },
    written_by: { type: 'enum', values: ['human', 'script'] },
    note: { type: 'string' },
  },
  required: ['schema_version', 'ticket', 'state', 'seq', 'written_at', 'written_by'],
  check(value, path, report) {
    if (value.state === 'blocked' && value.park_reason === undefined) {
      report('state', 'a blocked ticket needs park_reason', `one of: ${PARK_REASONS.join(', ')}`, 'required');
    }
    if (value.state !== 'blocked' && value.park_reason !== undefined) {
      report('park_reason', 'park_reason is only allowed when the ticket is blocked', undefined, 'invalid');
    }
  },
};

// Parses and checks a status file. Throws one ConfigError listing every problem.
export function parseStatusFile(text, { source = 'status.json' } = {}) {
  const fail = (line, column, reason, code, hint) => {
    throw new ConfigError(`${source}:${line}:${column}: ${reason}`, { source, line, column, reason, code, hint });
  };
  if (Buffer.byteLength(text, 'utf8') > STATUS_FILE_MAX_BYTES) fail(1, 1, `file is larger than ${STATUS_FILE_MAX_BYTES} bytes`, 'too-large');
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    const at = /position (\d+)/.exec(err.message);
    const { line, column } = lineColumn(text, at ? Number(at[1]) : 0);
    fail(line, column, 'not valid JSON', 'syntax');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(1, 1, 'must be a JSON object', 'type');

  // JSON.parse keeps the last of two equal keys; a status file must not hold two.
  const seen = new Map();
  for (const m of text.matchAll(/^[ \t]*"((?:[^"\\]|\\.)*)"[ \t]*:/gm)) {
    const { line, column } = lineColumn(text, m.index + m[0].indexOf('"'));
    if (seen.has(m[1])) fail(line, column, `the key ${JSON.stringify(m[1])} appears twice`, 'duplicate');
    seen.set(m[1], { line, column });
  }
  if (Number.isInteger(value.schema_version) && value.schema_version > STATUS_SCHEMA_VERSION) {
    const at = seen.get('schema_version') ?? { line: 1, column: 1 };
    fail(at.line, at.column, `written by a newer MIRAI (status schema ${value.schema_version})`, 'version', 'update MIRAI before reading this store');
  }
  if (value.note === null) delete value.note; // "no note" may be written as null

  const locate = (path) => ({ source, ...(seen.get(path.split('.')[0]) ?? { line: 1, column: 1 }) });
  const problems = validate(value, SCHEMA, locate);
  if (problems.length > 0) {
    const n = problems.length;
    throw new ConfigError(`${n} problem${n === 1 ? '' : 's'} in ${source}`, { errors: problems });
  }
  return Object.freeze({ ...value });
}

// Serializes a status file: fixed key order, one key per line, no empty fields. Unknown keys
// are refused, not dropped, so a typo can't silently lose data.
export function serializeStatusFile(status) {
  const unknown = Object.keys(status).filter((k) => !KEY_ORDER.includes(k));
  if (unknown.length > 0) throw new ConfigError(`status file: unknown key ${JSON.stringify(unknown[0])}`, { reason: 'unknown key', code: 'unknown-key' });
  const out = {};
  for (const key of KEY_ORDER) if (status[key] !== undefined && status[key] !== null) out[key] = status[key];
  const text = `${JSON.stringify(out, null, 2)}\n`;
  parseStatusFile(text, { source: 'status.json (to write)' });
  return text;
}

function lineColumn(text, at) {
  const before = text.slice(0, at);
  return { line: before.split('\n').length, column: at - before.lastIndexOf('\n') };
}
