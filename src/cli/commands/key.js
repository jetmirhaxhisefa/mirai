import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { requireTty } from '../tty.js';
import { shown } from '../../status/text.js';
import { repoIdentity } from '../../store/home.js';
import { branchKeys, createKeyPair, fingerprintOf, KEY_ID, keyPaths, loadSigningKey, publicPemOf, writePublicKeyFile, writeRevocation } from '../../sign/keys.js';
import { checkPrivateFile } from '../../store/files.js';

// mirai key new | show | revoke (unit 06; D-17). `new` and `revoke` change what can sign as you,
// so they need a real terminal too. The private key never appears in any output.
export default {
  name: 'key',
  summary: 'Make, show or revoke your signing key',
  usage: 'mirai key <new|show|revoke> [<key-id>] [--label <name>] [--replace] [--reason <text>]',
  positionals: { min: 1, max: 2 },
  options: {
    label: { type: 'string', description: 'with new: a name for this machine (default: its host name)' },
    replace: { type: 'boolean', description: 'with new: replace this machine\'s key (then revoke the old one)' },
    reason: { type: 'string', description: 'with revoke: why, in one line' },
  },
  run(args, io) {
    const [action, keyId] = args.positionals;
    const { label, replace, reason } = args.values;
    if (!['new', 'show', 'revoke'].includes(action)) throw new UsageError(`unknown action ${shown(action)}`, 'see: mirai key --help');
    if (action !== 'revoke' && keyId !== undefined) throw new UsageError(`unexpected argument ${shown(keyId)}`, 'see: mirai key --help');
    if (action === 'revoke' && !KEY_ID.test(keyId ?? '')) throw new UsageError('revoke needs a key id such as k-0123456789abcdef', 'see your key: mirai key show');
    if ((label !== undefined || replace) && action !== 'new') throw new UsageError('--label and --replace go with new', 'see: mirai key --help');
    if (reason !== undefined && (action !== 'revoke' || !/^[^\u0000-\u001f\u007f]{1,200}$/.test(reason))) throw new UsageError('--reason is one line of up to 200 characters, with revoke', 'see: mirai key --help');
    if (label !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(label)) throw new UsageError('--label is a short name such as "jet-macbook"', 'see: mirai key --help');

    const id = repoIdentity({ cwd: io.cwd, env: io.env });

    if (action === 'show') {
      const key = loadSigningKey(io.env);
      const committed = branchKeys(id.checkout, id.branch, io.env).get(key.keyId);
      io.stdout.write(`key: ${key.keyId}${key.label ? `  (${shown(key.label)})` : ''}\nfingerprint: ${fingerprintOf(key.publicKey)}\n`);
      if (!committed) io.stdout.write(`not committed yet: commit and push .mirai/keys/${key.keyId}.pub to ${id.branch} (run mirai key new here to write it, or pull if it's merged)\n`);
      else if (committed.revokedAt !== null) io.stdout.write(`revoked${committed.revokedAt > 0 ? ` on ${new Date(committed.revokedAt).toISOString()}` : ' (from the start: its revocation has no readable date)'}\n`);
      else io.stdout.write(`on ${id.branch}: signatures with this key verify\n`);
      return EXIT.OK;
    }

    requireTty(io, `mirai key ${action}`);
    if (action === 'new') {
      // One key per machine (D-52): in another repo, publish the key you have.
      if (!replace && checkPrivateFile(keyPaths(io.env).privateKey)) {
        const mine = publicPemOf(io.env);
        const file = writePublicKeyFile(id.checkout, mine.keyId, mine.publicPem);
        io.stdout.write(`this machine's key is ${mine.keyId}; its public key is in ${file}\n`);
        io.stdout.write(`next: commit that file by itself and push it to ${id.branch} yourself (not through MIRAI)\n`);
        io.stdout.write('to make a new key instead: mirai key new --replace (then revoke the old one)\n');
        return EXIT.OK;
      }
      let old = null;
      if (replace) {
        try {
          old = loadSigningKey(io.env).keyId;
        } catch {
          old = null;
        }
      }
      const made = createKeyPair(io.env, { label, replace });
      const file = writePublicKeyFile(id.checkout, made.keyId, made.publicPem);
      io.stdout.write(`made key ${made.keyId}\n`);
      io.stdout.write(`public key: ${file}\n`);
      io.stdout.write(`next: commit that file by itself and push it to ${id.branch} yourself (not through MIRAI)\n`);
      if (old) io.stdout.write(`then revoke the old key: mirai key revoke ${old}\n`);
      return EXIT.OK;
    }
    const file = writeRevocation(id.checkout, keyId, { reason });
    io.stdout.write(`revoked ${keyId}: ${file}\n`);
    io.stdout.write(`next: commit that file by itself and push it to ${id.branch} yourself\n`);
    return EXIT.OK;
  },
};
