import { EXIT } from '../exit-codes.js';
import { MiraiError, UsageError } from '../errors.js';
import { createPrompter, requireTty } from '../tty.js';
import { shown } from '../../status/text.js';
import { repoIdentity } from '../../store/home.js';
import { branchKeys, checkPassphrase, createKeyPair, createMachineKey, fingerprintOf, KEY_ID, keyIsProtected, keyPaths, loadMachineKey, loadSigningKey, protectKey, publicPemOf, writePublicKeyFile, writeRevocation } from '../../sign/keys.js';
import { writeUserDenies } from '../../sign/denies.js';
import { holderStatus, lockHolder, startHolder, unlockSetting } from '../../sign/unlock.js';
import { checkPrivateFile } from '../../store/files.js';

// mirai key new | show | revoke (unit 06; D-17); protect | passphrase | unlock | lock | status and
// new --machine (unit 29b). What changes what can sign as you needs a real terminal. The private
// keys and your passphrase never appear in any output.
const ACTIONS = ['new', 'show', 'revoke', 'protect', 'passphrase', 'unlock', 'lock', 'status'];

async function newPassphrase(prompter) {
  const a = await prompter.askHidden('choose a passphrase (at least 12 characters): ');
  checkPassphrase(a);
  const b = await prompter.askHidden('type it again: ');
  if (a !== b) throw new MiraiError('the two didn\'t match; nothing was changed', EXIT.FAILURE);
  return a;
}

function deniesLine(io) {
  for (const d of writeUserDenies(io.env)) io.stdout.write(`${d.skipped ? `note: ${d.file}: ${d.skipped}` : d.added ? `added MIRAI's ${d.added} deny rule(s) to ${d.file}` : `${d.file}: MIRAI's deny rules are there`}\n`);
}

export default {
  name: 'key',
  summary: 'Make, protect, show or revoke your signing key, and the machine key',
  usage: 'mirai key <new|show|revoke|protect|passphrase|unlock|lock|status> [<key-id>] [--machine] [--label <name>] [--replace] [--reason <text>]',
  positionals: { min: 1, max: 2 },
  options: {
    label: { type: 'string', description: 'with new: a name for this machine (default: its host name)' },
    replace: { type: 'boolean', description: 'with new: replace this machine\'s key (then revoke the old one)' },
    reason: { type: 'string', description: 'with revoke: why, in one line' },
    machine: { type: 'boolean', description: 'with new: the machine key, for MIRAI\'s records (unit 29b)' },
  },
  async run(args, io) {
    const [action, keyId] = args.positionals;
    const { label, replace, reason, machine } = args.values;
    if (!ACTIONS.includes(action)) throw new UsageError(`unknown action ${shown(action)}`, 'see: mirai key --help');
    if (action !== 'revoke' && keyId !== undefined) throw new UsageError(`unexpected argument ${shown(keyId)}`, 'see: mirai key --help');
    if (action === 'revoke' && !KEY_ID.test(keyId ?? '')) throw new UsageError('revoke needs a key id such as k-0123456789abcdef', 'see your key: mirai key show');
    if ((label !== undefined || replace || machine) && action !== 'new') throw new UsageError('--label, --replace and --machine go with new', 'see: mirai key --help');
    if (reason !== undefined && (action !== 'revoke' || !/^[^\u0000-\u001f\u007f]{1,200}$/.test(reason))) throw new UsageError('--reason is one line of up to 200 characters, with revoke', 'see: mirai key --help');
    if (label !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(label)) throw new UsageError('--label is a short name such as "jet-macbook"', 'see: mirai key --help');

    if (action === 'lock') {
      io.stdout.write(lockHolder(io.env) ? 'locked: your key needs your passphrase again\n' : 'your key wasn\'t unlocked\n');
      return EXIT.OK;
    }
    const id = repoIdentity({ cwd: io.cwd, env: io.env });
    const keys = () => branchKeys(id.checkout, id.branch, io.env);

    if (action === 'show' || action === 'status') {
      const mine = publicPemOf(io.env);
      const committed = keys().get(mine.keyId);
      io.stdout.write(`key: ${mine.keyId}${mine.label ? `  (${shown(mine.label)})` : ''}, ${keyIsProtected(io.env) ? 'protected with your passphrase' : 'not protected: mirai key protect'}\nfingerprint: ${fingerprintOf(mine.publicKey)}\n`);
      if (!committed) io.stdout.write(`not committed yet: commit and push .mirai/keys/${mine.keyId}.pub to ${id.branch} (run mirai key new here to write it, or pull if it's merged)\n`);
      else if (committed.revokedAt !== null) io.stdout.write(`revoked${committed.revokedAt > 0 ? ` on ${new Date(committed.revokedAt).toISOString()}` : ' (from the start: its revocation has no readable date)'}\n`);
      else io.stdout.write(`on ${id.branch}: signatures with this key verify\n`);
      const m = loadMachineKey(io.env);
      const mc = m ? keys().get(m.keyId) : null;
      io.stdout.write(m ? `machine key: ${m.keyId}, ${mc?.kind === 'machine' && mc.revokedAt === null ? `on ${id.branch}: MIRAI's records are signed with it` : `not on ${id.branch} yet: commit and push .mirai/keys/${m.keyId}.machine.pub by itself`}\n` : 'machine key: none (mirai key new --machine)\n');
      if (action === 'status') {
        const h = holderStatus(io.env);
        const ms = unlockSetting(io.env);
        io.stdout.write(h ? `unlocked until ${new Date(h.until).toLocaleString()} (mirai key lock locks it)\n` : `locked; signing.unlock: ${ms ? `${Math.round(ms / 3_600_000 * 10) / 10} h after your passphrase` : 'each (your passphrase for each decision)'}\n`);
      }
      return EXIT.OK;
    }

    requireTty(io, `mirai key ${action}`);
    const prompter = createPrompter(io);
    try {
      if (action === 'new' && machine) {
        const made = createMachineKey(io.env, { replace });
        const file = writePublicKeyFile(id.checkout, made.keyId, made.publicPem, { machine: true });
        io.stdout.write(`made the machine key ${made.keyId}: it signs MIRAI's records (the baseline, red-team results, branch records, proofs), never your decisions\npublic key: ${file}\nnext: commit that file by itself and push it to ${id.branch} yourself (not through MIRAI)\n`);
        deniesLine(io);
        return EXIT.OK;
      }
      if (action === 'new') {
        // One key per machine (D-52): in another repo, publish the key you have.
        if (!replace && checkPrivateFile(keyPaths(io.env).privateKey)) {
          const mine = publicPemOf(io.env);
          const file = writePublicKeyFile(id.checkout, mine.keyId, mine.publicPem);
          io.stdout.write(`this machine's key is ${mine.keyId}; its public key is in ${file}\nnext: commit that file by itself and push it to ${id.branch} yourself (not through MIRAI)\nto make a new key instead: mirai key new --replace (then revoke the old one)\n`);
          return EXIT.OK;
        }
        let old = null;
        if (replace) {
          try {
            old = publicPemOf(io.env).keyId;
          } catch {
            old = null;
          }
        }
        const passphrase = await newPassphrase(prompter);
        const made = createKeyPair(io.env, { label, replace, passphrase });
        const file = writePublicKeyFile(id.checkout, made.keyId, made.publicPem);
        io.stdout.write(`made key ${made.keyId}, protected with your passphrase\npublic key: ${file}\nnext: commit that file by itself and push it to ${id.branch} yourself (not through MIRAI)\n`);
        if (old) io.stdout.write(`then revoke the old key: mirai key revoke ${old}\n`);
        deniesLine(io);
        return EXIT.OK;
      }
      if (action === 'protect') {
        if (keyIsProtected(io.env)) throw new UsageError('your key is protected already', 'to change the passphrase: mirai key passphrase');
        const passphrase = await newPassphrase(prompter);
        const r = protectKey(io.env, passphrase);
        io.stdout.write(`protected: your key ${r.keyId} needs your passphrase from now on (its id is the same, so everything it signed still verifies)\n`);
        deniesLine(io);
        return EXIT.OK;
      }
      if (action === 'passphrase') {
        if (!keyIsProtected(io.env)) throw new UsageError('your key isn\'t protected yet', 'mirai key protect');
        const current = await prompter.askHidden('your passphrase now: ');
        loadSigningKey(io.env, { passphrase: current });
        const next = await newPassphrase(prompter);
        protectKey(io.env, next, { current });
        lockHolder(io.env);
        io.stdout.write('changed: your key needs the new passphrase from now on\n');
        return EXIT.OK;
      }
      if (action === 'unlock') {
        const ms = unlockSetting(io.env);
        if (!ms) throw new UsageError('signing.unlock is "each": your key is never kept unlocked', 'to keep it unlocked for a while, set [signing] unlock = "8h" in ~/.config/mirai/config.toml (the cost is in docs/signing.md)');
        if (!keyIsProtected(io.env)) throw new UsageError('your key isn\'t protected, so there\'s nothing to unlock', 'mirai key protect');
        const passphrase = await prompter.askHidden('your passphrase: ');
        const key = loadSigningKey(io.env, { passphrase });
        const s = await startHolder(io.env, { passphrase, keyId: key.keyId, ms });
        io.stdout.write(`unlocked until ${new Date(s.until).toLocaleString()}: while it is, any program running as you can sign with your key (mirai key lock locks it)\n`);
        return EXIT.OK;
      }
      const file = writeRevocation(id.checkout, keyId, { reason });
      io.stdout.write(`revoked ${keyId}: ${file}\nnext: commit that file by itself and push it to ${id.branch} yourself\n`);
      return EXIT.OK;
    } finally {
      prompter.close();
    }
  },
};
