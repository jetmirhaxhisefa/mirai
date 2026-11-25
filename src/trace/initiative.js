import { join } from 'node:path';

import { readApprovedFile } from '../cli/human-move.js';
import { readTicketFolder } from '../lint/lint.js';
import { checkInitiative } from '../store/connectors/common.js';
import { docsStoreFor } from '../store/connectors/index.js';
import { openStore } from '../store/home.js';
import { effectiveRegistry } from '../trust/overlays.js';
import { snapshot } from '../trust/snapshot.js';
import { traceDocuments } from './documents.js';

// `mirai trace <initiative>` and `mirai show <initiative>` (unit 43): the documents' scope, read from
// the project's docs store (the repo, or MIRAI's local store). Kept apart from documents.js, which
// MIRAI's MCP server reaches (a cage root), so the server imports no docs-store code.

// The trace of an initiative as its documents are now, read from its docs store (repo or local):
// traceDocuments' result. Refused for a name that isn't an initiative's.
export function traceInitiative({ cwd, env, initiative, store = openStore({ cwd, env }), trust = snapshot({ cwd, env }) }) {
  checkInitiative(initiative);
  const { conn } = docsStoreFor({ cwd, env, store });
  const registry = effectiveRegistry(trust, store);
  const read = (abs) => {
    try {
      const r = readApprovedFile(conn.base, conn.base, abs);
      return { path: conn.kind === 'repo' ? conn.relOf(abs) ?? abs : abs, text: r.bytes.toString('utf8') };
    } catch {
      return null;
    }
  };
  const dir = conn.dir(initiative);
  let folder = [];
  try {
    folder = readTicketFolder(dir, { root: conn.base }).all;
  } catch {
    folder = [];
  }
  const tickets = folder.map((t) => read(join(dir, t.path))).filter(Boolean);
  return traceDocuments({
    initiative, registry,
    brief: read(conn.pathOf('brief', initiative)), prd: read(conn.pathOf('prd', initiative)), epic: read(conn.pathOf('epic', initiative)),
    interview: read(conn.pathOf('interview', initiative)), tickets,
  });
}

