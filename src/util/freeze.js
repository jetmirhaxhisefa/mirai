// Freezes an object and everything inside it, so loaded config and definitions can't be
// changed by the code that reads them.
export function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
