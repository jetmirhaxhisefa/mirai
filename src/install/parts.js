import { fileURLToPath } from 'node:url';

// MIRAI's own package root, and what of it is the framework: its runtime and registry, so hooks
// and CI can run the copy without npx (D-03, D-15). A vendored licence added later must be
// listed here too. Its own module, so the `mirai` launcher (unit 12b) loads it without init's.
export const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const FRAMEWORK_PARTS = Object.freeze(['bin', 'src', 'registry', 'package.json', 'LICENSE']);
