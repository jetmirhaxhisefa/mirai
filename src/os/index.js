import { isAbsolute, join } from 'node:path';

// The operating-system module (unit 30a; D-63, `09` §4 row 11): the one place that answers what
// depends on the system MIRAI runs on. The MVP is macOS-only, so each answer has its macOS value
// and, for any other system, a plain "not supported yet" error, never a guessed path.
//
// Code from before 30a still asks the system itself in a few places (the guard test's list,
// `test/os/guard.test.js`); P01 (`design/11`) moves those here and adds Linux. New code asks
// this module.

export class UnsupportedSystem extends Error {
  constructor(system, what) {
    super(`not supported yet: ${system} (${what}); MIRAI runs on macOS for now`);
    this.code = 'unsupported-system';
    this.system = system;
    this.hint = 'Ubuntu support is the first post-MVP unit (design/11, P01)';
  }
}

export const SUPPORTED = Object.freeze(['darwin']);

// Each answer takes the system as an argument (default: this one), so a test can ask as Linux.
export function systemOf(platform = process.platform) {
  return { platform, supported: SUPPORTED.includes(platform) };
}

const need = (platform, what) => {
  if (platform !== 'darwin') throw new UnsupportedSystem(platform, what);
};

// The folder MIRAI's home lives in, under the user's home (05a, D-47).
export function appDataDir(home, platform = process.platform) {
  need(platform, 'where MIRAI keeps its store');
  if (!home || !isAbsolute(home)) throw new TypeError('home must be an absolute path');
  return join(home, 'Library', 'Application Support');
}

// The same folder as agents' deny rules write it (`~/…`).
export function appDataDirTilde(platform = process.platform) {
  need(platform, 'where MIRAI keeps its store');
  return '~/Library/Application Support';
}

// The sandbox the cage runs in.
export function sandboxName(platform = process.platform) {
  need(platform, 'which sandbox runs the cage');
  return 'sandbox-exec';
}

// How two paths are compared: macOS's default volume folds case and Unicode form.
export function pathFold(platform = process.platform) {
  need(platform, 'how paths are compared');
  return (p) => p.normalize('NFC').toLowerCase();
}
