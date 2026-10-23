// Test-only worker for T5: appends `count` note events to the store of `cwd` (unit 05a).
import { openStore } from '../../../src/store/home.js';
import { appendEvent } from '../../../src/store/journal.js';

const [cwd, home, name, count] = process.argv.slice(2);
const store = openStore({ cwd, env: { HOME: home, PATH: process.env.PATH } });
for (let i = 0; i < Number(count); i += 1) {
  appendEvent(store, { type: 'note', by: 'script', message: `${name}:${i}` });
}
