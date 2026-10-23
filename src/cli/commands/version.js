import { readFileSync } from 'node:fs';
import { EXIT } from '../exit-codes.js';

const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));

export const VERSION = pkg.version;

export default {
  name: 'version',
  summary: 'Print the MIRAI version',
  usage: 'mirai version',
  run(_args, io) {
    io.stdout.write(`${VERSION}\n`);
    return EXIT.OK;
  },
};
