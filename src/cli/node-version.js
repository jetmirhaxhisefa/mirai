// No imports here: the entry point loads this before anything else, so an old Node
// gets a clear message instead of a syntax error from a newer module.
export const MIN_NODE_MAJOR = 22;

// Returns the error message for a too-old Node version, or null when it's fine.
export function checkNodeVersion(nodeVersion) {
  const version = String(nodeVersion).replace(/^v/, '');
  const major = Number(version.split('.')[0]);
  if (major >= MIN_NODE_MAJOR) return null;
  return `mirai needs Node ${MIN_NODE_MAJOR} or newer (found v${version})\n`;
}
