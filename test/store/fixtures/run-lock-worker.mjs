// Test-only worker for T14: tries to take the global run lock for the repo at `cwd`, as a
// second MIRAI process would. Prints "acquired" or the refusal's code, exit code and message.
import { openStore } from '../../../src/store/home.js';
import { acquireRunLock } from '../../../src/store/global.js';
import { newRunId } from '../../../src/store/run.js';

const [cwd, home] = process.argv.slice(2);
const env = { HOME: home, PATH: process.env.PATH };
try {
  const { release } = acquireRunLock(openStore({ cwd, env }), newRunId(), env);
  release();
  process.stdout.write('acquired\n');
} catch (err) {
  process.stdout.write(`${JSON.stringify({ code: err.code, exitCode: err.exitCode, message: err.message })}\n`);
}
