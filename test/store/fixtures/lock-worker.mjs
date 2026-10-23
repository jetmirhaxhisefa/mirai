// Test-only worker for T8: takes the lock `count` times and checks that nobody else is inside
// while it holds it (a marker file created with O_EXCL). Prints "violation" when someone is,
// and "broken" when it broke a dead holder's lock.
import { closeSync, openSync, unlinkSync, constants } from 'node:fs';
import { acquireLock } from '../../../src/store/files.js';

const [lock, marker, count] = process.argv.slice(2);
const pause = new Int32Array(new SharedArrayBuffer(4));
for (let i = 0; i < Number(count); i += 1) {
  const { release, broken } = acquireLock(lock, 'test', { waitMs: 20_000 });
  if (broken) process.stdout.write('broken\n');
  let mine = true;
  try {
    closeSync(openSync(marker, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600));
  } catch {
    mine = false;
    process.stdout.write('violation\n');
  }
  Atomics.wait(pause, 0, 0, 1);
  if (mine) unlinkSync(marker);
  release();
}
