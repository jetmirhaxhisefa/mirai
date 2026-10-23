// Shows a value that came from a file or the run log in a message, safely: plain names as they
// are, anything else quoted with control characters escaped (so nothing can reach the
// terminal as an escape sequence).
export function shown(value) {
  if (typeof value === 'string' && /^[A-Za-z0-9._@/-]{1,64}$/.test(value)) return value;
  if (typeof value === 'string') return JSON.stringify(value.length > 64 ? `${value.slice(0, 64)}…` : value);
  return `<${typeof value}>`;
}
