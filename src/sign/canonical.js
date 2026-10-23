// Canonical JSON (unit 06): object keys sorted, no whitespace, UTF-8. Two equal objects always
// give the same bytes, so a signature over them can be checked anywhere. Only plain JSON values
// are allowed: anything JSON.stringify would drop or change (undefined, functions, symbols,
// non-finite numbers, dates, class instances) is refused instead.

export function canonical(value) {
  return Buffer.from(encode(value, '$'), 'utf8');
}

function encode(value, path) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`${path} is not a finite number`);
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        const items = [];
        for (let i = 0; i < value.length; i += 1) {
          if (!(i in value)) throw new TypeError(`${path}[${i}] is a hole in the array`);
          items.push(encode(value[i], `${path}[${i}]`));
        }
        return `[${items.join(',')}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw new TypeError(`${path} is not a plain object`);
      const keys = Object.keys(value).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${encode(value[k], `${path}.${k}`)}`).join(',')}}`;
    }
    default:
      throw new TypeError(`${path} can't be signed (${typeof value})`);
  }
}
