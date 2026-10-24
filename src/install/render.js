import { accessSync, constants, existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { MiraiError } from '../cli/errors.js';
import { EXIT } from '../cli/exit-codes.js';
import { PROJECT_CONFIG, readConfigFile, checkConfig } from '../config/load.js';
import { topLevel } from '../store/git.js';
import { LOCK_FILE, readLock, updateLock, replaceFile, noLinks, sha256 } from './lock.js';
import { AGENTS_WARN_BYTES, BlockError, blockOf, localInstructions, renderBlock, withBlock } from './agents-block.js';

// The rendered files (unit 10; D-37): made from the framework copy plus your own files, and
// listed in the lock as `rendered`, with the hash of what MIRAI owns and of each input. `init`
// renders them first; `mirai render` renders them again from the installed framework copy,
// after you changed `.mirai/config.toml` or `.mirai/context/agents-local.md`. Unit 11 adds the
// Claude Code files here.

export const AGENTS_FILE = 'AGENTS.md';
export const LOCAL_FILE = '.mirai/context/agents-local.md';
export const AGENTS_TEMPLATE = '.mirai/framework/registry/templates/agents-block.md';
const CONFIG_FILE = PROJECT_CONFIG.split('\\').join('/');

// AGENTS.md as it is: { bytes, text, mode }, or null when there is none. Refused before anything
// is written: a symbolic link or not a file, text that isn't UTF-8 (it couldn't be written back
// byte for byte), and a file or folder MIRAI can't write.
export function readAgents(root) {
  const path = join(root, AGENTS_FILE);
  let info;
  try {
    info = lstatSync(path);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    writable(root, '.');
    return null;
  }
  if (info.isSymbolicLink()) {
    throw new BlockError(`${AGENTS_FILE} is a symbolic link`, { code: 'symlink', hint: 'if it points to CLAUDE.md, make AGENTS.md the real file and CLAUDE.md the link; unit 11 manages CLAUDE.md' });
  }
  if (!info.isFile()) throw new BlockError(`${AGENTS_FILE} is not a file`, { code: 'agents-not-file' });
  const bytes = readFileSync(path);
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new BlockError(`${AGENTS_FILE} is not UTF-8 text`, { code: 'agents-encoding', hint: 'save it as UTF-8' });
  writable(root, '.');
  writable(root, AGENTS_FILE);
  return { bytes, text, mode: info.mode & 0o777 };
}

function writable(root, rel) {
  try {
    accessSync(join(root, rel), constants.W_OK);
  } catch {
    throw new BlockError(`${rel === '.' ? 'the repo folder' : rel} can't be written`, { code: 'not-writable', hint: 'check its permissions' });
  }
}

// AGENTS.md with MIRAI's block rendered: { text, entry, warning? }. `template` and `local` are
// the inputs' bytes (`local` null when there is no agents-local.md); `config` the checked
// config, with its file's bytes as `configBytes`.
export function renderAgents({ template, local, config, configBytes, existing }) {
  const docsRoot = config.docs.root;
  // The docs root is shown in a code span; a backtick in it would end the span early.
  if (docsRoot.includes('`')) throw new BlockError('the docs root has a backtick in it, which the AGENTS.md block can\'t show', { code: 'docs-root-backtick', hint: 'rename the folder in [docs] root' });
  const frame = template.toString('utf8').replaceAll('{docs_root}', () => docsRoot);
  const body = renderBlock(frame, local === null ? '' : localInstructions(local.toString('utf8')));
  const text = withBlock(existing === null ? null : existing.text, body);
  const from = [
    { path: AGENTS_TEMPLATE, sha256: sha256(template) },
    { path: CONFIG_FILE, sha256: sha256(configBytes) },
    ...(local === null ? [] : [{ path: LOCAL_FILE, sha256: sha256(local) }]),
  ].sort((a, b) => (a.path < b.path ? -1 : 1));
  const size = Buffer.byteLength(text, 'utf8');
  return {
    text,
    entry: { path: AGENTS_FILE, mark: 'rendered', block: 'mirai', sha256: sha256(blockOf(text)), from },
    warning: size > AGENTS_WARN_BYTES ? `${AGENTS_FILE} is ${size} bytes; some tools read only the first ${AGENTS_WARN_BYTES} (Codex), so keep it shorter` : undefined,
  };
}

// `mirai render`: renders the rendered files again from the installed framework copy and your
// files, and updates their lock entries. Returns { root, files: [{ path, changed, edited }],
// warnings }: `edited` when the block had been changed by hand (it's replaced).
export function render({ cwd, env }) {
  const top = topLevel(cwd, env);
  if (!top) throw new MiraiError('this folder is not inside a git repository', EXIT.BLOCKED);
  const root = realpathSync(top);
  const lock = readLock(root);
  if (!lock) throw new BlockError('MIRAI is not installed here (no lock)', { code: 'no-lock', hint: 'run: mirai init' });

  // The template must be the framework's, as the lock lists it.
  noLinks(root, AGENTS_TEMPLATE);
  const listed = lock.files.get(AGENTS_TEMPLATE);
  const template = existsSync(join(root, AGENTS_TEMPLATE)) ? readFileSync(join(root, AGENTS_TEMPLATE)) : null;
  if (!listed || template === null || sha256(template) !== listed.sha256) {
    throw new BlockError(`${AGENTS_TEMPLATE} is not the framework's own (it changed, or is missing)`, { code: 'framework-changed', hint: 'restore the framework copy; mirai doctor comes later' });
  }
  noLinks(root, CONFIG_FILE);
  const configBytes = readFileSync(join(root, CONFIG_FILE));
  const config = checkConfig([{ kind: 'project', file: readConfigFile(join(root, CONFIG_FILE), { trust: 'project', source: CONFIG_FILE, within: root }) }]).config;
  noLinks(root, LOCAL_FILE);
  const local = existsSync(join(root, LOCAL_FILE)) ? readFileSync(join(root, LOCAL_FILE)) : null;

  const existing = readAgents(root);
  const before = lock.files.get(AGENTS_FILE);
  const edited = Boolean(existing && before && blockOf(existing.text) !== null && sha256(blockOf(existing.text)) !== before.sha256);
  const agents = renderAgents({ template, local, config, configBytes, existing });
  const changed = existing === null || agents.text !== existing.text;
  if (changed) replaceFile(join(root, AGENTS_FILE), agents.text, existing?.mode);
  if (changed || JSON.stringify(before) !== JSON.stringify(agents.entry)) updateLock(root, [agents.entry]);
  return { root, lockFile: LOCK_FILE, files: [{ path: AGENTS_FILE, changed, edited }], warnings: agents.warning ? [agents.warning] : [] };
}
