import { lstatSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';

import { pathOfIn, readUnder, relIn, writeUnder } from './common.js';

// The repo store (unit 38, Scope 2): documents under the docs root in the working tree, as they
// were before stores existed. Where a document lives, reading, writing and the proof step are here;
// query, status and publish (the docs merge request) are added by verbs.js, so the code the red
// team's cage covers (the lint, init) doesn't pull in the approval and publish code.

export function repoStore({ def, store, config }) {
  const base = store.checkout;
  const docsRoot = config.docs?.root ?? 'docs/mirai';
  const self = {
    name: 'repo',
    kind: 'repo',
    def,
    base,
    docsRoot,
    checkout: store.checkout,
    teamCanSee: true,
    dir: (initiative) => join(base, docsRoot, initiative),
    pathOf: (type, initiative, name) => pathOfIn(self, type, initiative, name),
    relOf: (abs) => relIn(base, abs),
    write: (type, initiative, name, bytes) => writeUnder(base, self.pathOf(type, initiative, name), bytes),
    read: (type, initiative, name) => readUnder(base, self.pathOf(type, initiative, name)),
    // The proof step (run at init and by doctor): the docs root is a real folder inside the repo,
    // or isn't made yet; a link anywhere on the way is refused.
    setup() {
      let at = base;
      for (const part of docsRoot.split('/')) {
        at = join(at, part);
        let info;
        try {
          info = lstatSync(at);
        } catch {
          return { ok: true, detail: `the repo store: ${docsRoot}/ isn't made yet; the first document makes it` };
        }
        if (info.isSymbolicLink()) return { ok: false, detail: `${docsRoot}/ leads through a symbolic link (${at})`, hint: 'documents are real files in the repo: replace the link with a folder' };
        if (!info.isDirectory()) return { ok: false, detail: `${at} isn't a folder`, hint: `[docs] root names a folder: move the file, or set another root` };
      }
      if (!realpathSync(at).startsWith(realpathSync(base) + sep)) return { ok: false, detail: `${docsRoot}/ is outside the repo` };
      return { ok: true, detail: `the repo store: documents in ${join(base, docsRoot)}` };
    },
  };
  return self;
}
