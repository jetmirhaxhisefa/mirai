import { lstatSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

import { checkPrivateDir, ensurePrivateDir } from '../files.js';
import { pathOfIn, readUnder, relIn, writeUnder } from './common.js';

// The local store (unit 38, Scope 2; Jet's decision 4): documents in MIRAI's store on this Mac,
// under <MIRAI home>/projects/<repo id>/docs/<initiative>/, outside the repo and never committed.
// For solo or private work: `publish` does nothing and says so, and doctor notes that teammates
// can't see these documents. The folders are private (0700), as all of MIRAI's store is.

export const LOCAL_DOCS = 'docs';

export function localBase(store) {
  return join(store.home, 'projects', store.repoId);
}

export function localStore({ def, store }) {
  const base = localBase(store);
  const make = () => {
    ensurePrivateDir(join(store.home, 'projects'));
    ensurePrivateDir(base);
    ensurePrivateDir(join(base, LOCAL_DOCS));
  };
  const self = {
    name: 'local',
    kind: 'local',
    def,
    base,
    docsRoot: LOCAL_DOCS,
    checkout: store.checkout,
    teamCanSee: false,
    dir: (initiative) => join(base, LOCAL_DOCS, initiative),
    pathOf: (type, initiative, name) => pathOfIn(self, type, initiative, name),
    relOf: (abs) => relIn(base, abs),
    write(type, initiative, name, bytes) {
      make();
      return writeUnder(base, self.pathOf(type, initiative, name), bytes, { dirMode: 0o700, fileMode: 0o600 });
    },
    read: (type, initiative, name) => readUnder(base, self.pathOf(type, initiative, name)),
    // The proof step: the folder is a private real folder outside the repo, and a file written
    // there reads back the same.
    setup() {
      try {
        make();
        for (const d of [base, join(base, LOCAL_DOCS)]) checkPrivateDir(d);
      } catch (err) {
        return { ok: false, detail: `the local store's folder can't be used: ${String(err.message).slice(0, 200)}`, hint: 'run: mirai doctor' };
      }
      const real = realpathSync(join(base, LOCAL_DOCS));
      if (real === store.checkout || real.startsWith(store.checkout + sep)) return { ok: false, detail: `the local store's folder ${real} is inside the repo` };
      const probe = join(base, LOCAL_DOCS, `.setup-${randomBytes(4).toString('hex')}`);
      const token = randomBytes(8).toString('hex');
      try {
        writeFileSync(probe, token, { flag: 'wx', mode: 0o600 });
        if (readFileSync(probe, 'utf8') !== token || lstatSync(probe).isSymbolicLink()) return { ok: false, detail: 'a file written to the local store didn\'t read back the same' };
      } catch (err) {
        return { ok: false, detail: `the local store can't be written (${err.code ?? err.message})` };
      } finally {
        rmSync(probe, { force: true });
      }
      return { ok: true, detail: `the local store: documents in ${join(base, LOCAL_DOCS)}, on this Mac only` };
    },
  };
  return self;
}
