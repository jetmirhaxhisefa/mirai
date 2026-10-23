// A real UTC time in MIRAI's signed records (unit 06): the pattern with milliseconds, a finite
// value, and the same text back, so 30 February or month 13 is refused instead of rolling over.
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function validTime(text) {
  if (typeof text !== 'string' || !ISO.test(text)) return false;
  const t = Date.parse(text);
  return Number.isFinite(t) && new Date(t).toISOString() === text;
}
