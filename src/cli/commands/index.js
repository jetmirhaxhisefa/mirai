import config from './config.js';
import version from './version.js';

// The real command list, fixed in code: a file dropped into this folder does nothing.
// Later units add their commands here, by name. `help` is added by main.js, because it
// needs the router itself.
export const COMMANDS = [config, version];
