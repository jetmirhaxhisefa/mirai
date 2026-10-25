import approve from './approve.js';
import config from './config.js';
import drop from './drop.js';
import init from './init.js';
import key from './key.js';
import lint from './lint.js';
import log from './log.js';
import protectedCmd from './protected.js';
import render from './render.js';
import status from './status.js';
import token from './token.js';
import trust from './trust.js';
import version from './version.js';

// The real command list, fixed in code: a file dropped into this folder does nothing.
// Later units add their commands here, by name. `help` is added by main.js, because it
// needs the router itself.
export const COMMANDS = [approve, config, drop, init, key, lint, log, protectedCmd, render, status, token, trust, version];
