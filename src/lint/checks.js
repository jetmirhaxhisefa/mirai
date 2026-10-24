// Built-in checks a document type switches on by name (`lint_checks = ["ticket"]`, unit 08a).
// They cover what the generic rules can't express. Each adds problems like the rules do. The
// names must match BUILT_IN_CHECKS in src/config/registry.js (a test pins it).

// Trackers compare ticket keys without regard to case, so MIRAI does too.
const sameKey = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

export const CHECKS = Object.freeze({
  // A ticket (story or bug): its repo is one of the config's repos (D-42); it doesn't wait
  // for itself or name a prerequisite twice; under a tickets/ folder its file is <id>.md
  // (design/03, the repo layout).
  ticket(doc, def, ctx, add) {
    const { value, positions } = doc;
    const at = (key) => {
      const p = positions.get(key);
      return p ? { line: p.line, column: p.valueColumn ?? p.column } : { line: 1, column: 1 };
    };
    const repos = ctx.project?.repos ?? [];
    if (typeof value.repo === 'string' && value.repo !== '' && !repos.includes(value.repo)) {
      add({ code: 'unknown-repo', ...at('repo'), reason: '"repo" is not one of the repos in the config', hint: `use one of: ${repos.join(', ')}` });
    }
    if (Array.isArray(value.after)) {
      value.after.forEach((item, i) => {
        const p = positions.get(`after[${i}]`);
        const where = { line: p?.line ?? 1, column: p?.column ?? 1 };
        if (sameKey(item, value.id)) add({ code: 'after-self', ...where, reason: "a ticket can't wait for itself" });
        else if (value.after.slice(0, i).some((earlier) => sameKey(earlier, item))) add({ code: 'duplicate', ...where, reason: `after[${i}] repeats an earlier entry` });
      });
    }
    const parts = (ctx.file ?? '').split('/');
    if (parts.length >= 2 && parts.at(-2).toLowerCase() === 'tickets' && typeof value.id === 'string') {
      const stem = parts.at(-1).replace(/\.(?:md|markdown)$/i, '');
      if (!sameKey(stem, value.id)) add({ code: 'file-name', ...at('id'), reason: "the file name doesn't match the ticket's id", hint: 'name ticket files <id>.md' });
    }
  },
});
