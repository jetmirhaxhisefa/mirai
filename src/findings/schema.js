// A validator for the JSON Schema subset MIRAI's structured-output schemas use (unit 09a). The
// launcher passes the same schema files to `claude --json-schema` (D-12), but MIRAI never trusts
// that check: every captured output is parsed and validated here again (R2-C1).
//
// Supported keywords: type (one name), properties, required, additionalProperties (false),
// items, minItems, maxItems, enum, const, pattern, minLength, maxLength, minimum, maximum,
// $ref (to "#/$defs/<name>"), $defs, and the annotations $schema, $id, title, description.
// A schema is refused when it's compiled if it uses any other keyword, or a keyword this
// validator would apply loosely, so a schema can't ask for a check that is silently skipped:
// - every node says what it is: exactly one of type, enum, const or $ref;
// - a $ref has only annotations beside it;
// - object keywords need type "object", with additionalProperties: false; strings need
//   maxLength (or enum / const); arrays need maxItems;
// - keyword values have their right types, and enum values are primitives.
//
// Problems are { path, code, reason }, `path` a JSON pointer ("/findings/0/severity"); values
// are never put into a reason (captured output is untrusted text).

export const LIMITS = Object.freeze({ bytes: 256 * 1024, depth: 32, numberLength: 64 });

const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description']);
const KEYWORDS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'enum', 'const',
  'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', '$ref', '$defs', ...ANNOTATIONS]);
const TYPES = new Set(['object', 'array', 'string', 'integer', 'number', 'boolean', 'null']);
const FOR_TYPE = {
  object: ['properties', 'required', 'additionalProperties'],
  array: ['items', 'minItems', 'maxItems'],
  string: ['pattern', 'minLength', 'maxLength'],
  number: ['minimum', 'maximum'],
  integer: ['minimum', 'maximum'],
};
const OWNER = Object.fromEntries(Object.entries(FOR_TYPE).flatMap(([t, ks]) => ks.map((k) => [k, t])));

export class SchemaError extends Error {}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;
const isPrimitive = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

// Checks a schema and returns a validate(value) function giving the list of problems.
export function compileSchema(schema) {
  if (!isPlain(schema)) throw new SchemaError('#: a schema must be an object');
  const defs = schema.$defs ?? {};
  if (!isPlain(defs)) throw new SchemaError('#/$defs must be an object');
  const resolve = (node, where) => {
    const seen = new Set();
    while (node.$ref !== undefined) {
      const m = /^#\/\$defs\/([A-Za-z0-9_-]+)$/.exec(node.$ref);
      if (!m || !Object.hasOwn(defs, m[1])) throw new SchemaError(`${where}: $ref must name one of $defs`);
      if (seen.has(m[1])) throw new SchemaError(`${where}: a $ref loop`);
      seen.add(m[1]);
      node = defs[m[1]];
    }
    return node;
  };
  const check = (node, where, { root = false } = {}) => {
    if (!isPlain(node)) throw new SchemaError(`${where}: a schema must be an object`);
    for (const key of Object.keys(node)) {
      if (!KEYWORDS.has(key)) throw new SchemaError(`${where}: the keyword "${key}" is not supported`);
      if (key === '$defs' && !root) throw new SchemaError(`${where}: $defs only at the top`);
    }
    const kinds = ['type', 'enum', 'const', '$ref'].filter((k) => node[k] !== undefined);
    if (kinds.length !== 1) throw new SchemaError(`${where}: a node needs exactly one of type, enum, const or $ref`);
    for (const key of Object.keys(node)) {
      if (ANNOTATIONS.has(key) || key === '$defs' || key === kinds[0]) continue;
      if (node.$ref !== undefined) throw new SchemaError(`${where}: only annotations may sit beside $ref`);
      const owner = OWNER[key];
      if (owner && node.type !== owner && !(owner === 'number' && node.type === 'integer') && !(owner === 'integer' && node.type === 'number')) {
        throw new SchemaError(`${where}: "${key}" needs type "${owner}"`);
      }
    }
    if (node.$ref !== undefined) {
      resolve(node, where);
      return;
    }
    if (node.enum !== undefined && (!Array.isArray(node.enum) || node.enum.length === 0 || !node.enum.every(isPrimitive))) throw new SchemaError(`${where}: enum must be a list of plain values`);
    if (node.const !== undefined && !isPrimitive(node.const)) throw new SchemaError(`${where}: const must be a plain value`);
    if (node.type !== undefined && !TYPES.has(node.type)) throw new SchemaError(`${where}: unknown type`);
    for (const k of ['minItems', 'maxItems', 'minLength', 'maxLength']) {
      if (node[k] !== undefined && !isCount(node[k])) throw new SchemaError(`${where}: ${k} must be a whole number`);
    }
    for (const k of ['minimum', 'maximum']) {
      if (node[k] !== undefined && !Number.isFinite(node[k])) throw new SchemaError(`${where}: ${k} must be a number`);
    }
    if (node.type === 'object') {
      if (node.additionalProperties !== false) throw new SchemaError(`${where}: an object schema needs additionalProperties: false`);
      if (!isPlain(node.properties ?? {})) throw new SchemaError(`${where}: properties must be an object`);
      if (node.required !== undefined && (!Array.isArray(node.required) || !node.required.every((k) => typeof k === 'string' && Object.hasOwn(node.properties ?? {}, k)))) {
        throw new SchemaError(`${where}: required must list properties`);
      }
    }
    if (node.type === 'string' && node.maxLength === undefined) throw new SchemaError(`${where}: a string needs maxLength`);
    if (node.type === 'array') {
      if (node.maxItems === undefined) throw new SchemaError(`${where}: an array needs maxItems`);
      if (node.items === undefined) throw new SchemaError(`${where}: an array needs items`);
    }
    if (node.pattern !== undefined) {
      if (typeof node.pattern !== 'string') throw new SchemaError(`${where}: pattern must be a string`);
      new RegExp(node.pattern, 'u'); // throws on a bad pattern
    }
    for (const [k, v] of Object.entries(node.properties ?? {})) check(v, `${where}/properties/${k}`);
    if (node.items !== undefined) check(node.items, `${where}/items`);
    if (root) for (const [k, v] of Object.entries(defs)) check(v, `#/$defs/${k}`);
  };
  check(schema, '#', { root: true });
  const patterns = new Map();
  const regex = (p) => {
    if (!patterns.has(p)) patterns.set(p, new RegExp(p, 'u'));
    return patterns.get(p);
  };
  return (value) => {
    const problems = [];
    walk(value, schema, '', problems, (n) => resolve(n, '#'), regex);
    return problems;
  };
}

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const pointer = (path, key) => `${path}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;

function walk(value, node, path, problems, resolve, regex) {
  node = resolve(node);
  const where = path || 'the value';
  const add = (code, reason) => problems.push({ path: path || '/', code, reason });
  if (node.const !== undefined && value !== node.const) return add('const', `${where} has the wrong value`);
  if (node.enum !== undefined && !node.enum.includes(value)) return add('enum', `${where} must be one of: ${node.enum.join(', ')}`);
  if (node.type !== undefined) {
    const t = typeOf(value);
    const ok = node.type === t || (node.type === 'integer' && t === 'number' && Number.isInteger(value)) || (node.type === 'number' && t === 'number');
    if (!ok) return add('type', `${where} must be ${['array', 'object', 'integer'].includes(node.type) ? 'an' : 'a'} ${node.type}`);
  }
  switch (typeOf(value)) {
    case 'string': {
      const length = [...value].length;
      if (node.minLength !== undefined && length < node.minLength) add('length', `${where} is too short`);
      if (node.maxLength !== undefined && length > node.maxLength) add('length', `${where} is longer than ${node.maxLength} characters`);
      if (node.pattern !== undefined && !regex(node.pattern).test(value)) add('pattern', `${where} doesn't have the expected shape`);
      break;
    }
    case 'number':
      if (node.minimum !== undefined && value < node.minimum) add('range', `${where} must be at least ${node.minimum}`);
      if (node.maximum !== undefined && value > node.maximum) add('range', `${where} must be at most ${node.maximum}`);
      break;
    case 'array':
      if (node.minItems !== undefined && value.length < node.minItems) add('items', `${where} needs at least ${node.minItems} item(s)`);
      if (node.maxItems !== undefined && value.length > node.maxItems) return add('items', `${where} has more than ${node.maxItems} items`);
      if (node.items) value.forEach((item, i) => walk(item, node.items, pointer(path, i), problems, resolve, regex));
      break;
    case 'object': {
      const props = node.properties ?? {};
      for (const key of node.required ?? []) {
        if (!Object.hasOwn(value, key)) problems.push({ path: pointer(path, key), code: 'required', reason: `${pointer(path, key)} is required` });
      }
      for (const key of Object.keys(value)) {
        if (Object.hasOwn(props, key)) walk(value[key], props[key], pointer(path, key), problems, resolve, regex);
        else problems.push({ path: pointer(path, /^[A-Za-z0-9_-]{1,32}$/.test(key) ? key : '<key>'), code: 'unknown-key', reason: 'an unknown key' });
      }
      break;
    }
    default:
  }
  return undefined;
}

// Parses JSON strictly: at most `maxBytes` (LIMITS.bytes by default), nested at most
// LIMITS.depth, objects without a prototype, well-formed strings only (no lone surrogates), and
// duplicate keys refused (JSON.parse would keep the last one silently, so an output could say
// two things at once). Throws a SyntaxError with a reason and the position in the text.
export function parseJsonStrict(text, { maxBytes = LIMITS.bytes } = {}) {
  if (typeof text !== 'string') throw new TypeError('parseJsonStrict expects a string');
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new SyntaxError(`the output is larger than ${maxBytes} bytes`);
  let i = 0;
  const fail = (reason, at = i) => { throw new SyntaxError(`${reason} at character ${at + 1}`); };
  const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i += 1; };
  const string = () => {
    const start = i;
    i += 1;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') i += 1;
      else if (text.charCodeAt(i) < 0x20) fail('a control character in a string');
      i += 1;
    }
    if (i >= text.length) fail('an unclosed string', start);
    i += 1;
    let s;
    try {
      s = JSON.parse(text.slice(start, i));
    } catch {
      fail('a bad escape in a string', start);
    }
    if (!s.isWellFormed()) fail('a lone surrogate in a string', start);
    return s;
  };
  const value = (depth) => {
    if (depth >= LIMITS.depth) fail(`nested deeper than ${LIMITS.depth}`);
    ws();
    const c = text[i];
    if (c === '{') {
      i += 1;
      const out = Object.create(null);
      ws();
      if (text[i] === '}') { i += 1; return out; }
      for (;;) {
        ws();
        if (text[i] !== '"') fail('expected a key');
        const at = i;
        const key = string();
        if (Object.hasOwn(out, key)) fail('a key appears twice', at);
        ws();
        if (text[i] !== ':') fail('expected ":"');
        i += 1;
        out[key] = value(depth + 1);
        ws();
        if (text[i] === ',') { i += 1; continue; }
        if (text[i] === '}') { i += 1; return out; }
        fail('expected "," or "}"');
      }
    }
    if (c === '[') {
      i += 1;
      const out = [];
      ws();
      if (text[i] === ']') { i += 1; return out; }
      for (;;) {
        out.push(value(depth + 1));
        ws();
        if (text[i] === ',') { i += 1; continue; }
        if (text[i] === ']') { i += 1; return out; }
        fail('expected "," or "]"');
      }
    }
    if (c === '"') return string();
    const m = /^(?:-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?|true|false|null)/.exec(text.slice(i, i + LIMITS.numberLength + 1));
    if (!m) fail('expected a value');
    if (m[0].length > LIMITS.numberLength) fail('a number is too long');
    i += m[0].length;
    const v = JSON.parse(m[0]);
    if (typeof v === 'number' && !Number.isFinite(v)) fail('a number out of range');
    return v;
  };
  const out = value(0);
  ws();
  if (i !== text.length) fail('text after the value');
  return out;
}

// Whether a value is what parseJsonStrict returns: plain data with prototype-free objects.
// Checking an object that came from JSON.parse (duplicate keys already merged, a prototype) is
// refused, so the strict parse can't be skipped by passing an object.
export function isStrictValue(value, depth = 0) {
  if (depth >= LIMITS.depth) return false;
  if (value === null || ['string', 'boolean'].includes(typeof value)) return typeof value !== 'string' || value.isWellFormed();
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return Object.getPrototypeOf(value) === Array.prototype && value.every((v) => isStrictValue(v, depth + 1));
  if (typeof value === 'object') return Object.getPrototypeOf(value) === null && Object.values(value).every((v) => isStrictValue(v, depth + 1));
  return false;
}
