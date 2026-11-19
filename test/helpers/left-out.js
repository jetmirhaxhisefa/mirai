#!/usr/bin/env node
// Prints the tests a run left out, and why (unit 30a): `node test/helpers/left-out.js <file>`.
import { leftOutText, readLeftOut } from './needs.js';

process.stdout.write(leftOutText(readLeftOut(process.argv[2] ?? '')));
