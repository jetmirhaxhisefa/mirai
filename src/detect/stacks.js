import { besides, dirOf, filesNamed, nameOf } from './walk.js';

// Stacks, their named checks and commit-message rules (unit 17a), from the stacks' data
// (registry/stacks/ and the project's .mirai/custom/stacks/). Nothing about any stack is code
// here: a stack is its markers, a manifest is a JSON file beside one, a check is argv.

const CHECK_NAME = /^[a-z][a-z0-9-]*$/;

// The stacks whose markers the tree has: [{ name, pack, markers: [path], dirs: [dir] }], by name.
export function findStacks(tree, stacks) {
  const found = [];
  for (const s of Object.values(stacks).sort((a, b) => a.name.localeCompare(b.name))) {
    const markers = s.markers.flatMap((m) => filesNamed(tree, m).filter((p) => nameOf(p) === m)).sort();
    if (markers.length === 0) continue;
    found.push({ name: s.name, ...(s.pack ? { pack: s.pack } : {}), markers, dirs: [...new Set(markers.map(dirOf))].sort() });
  }
  return found;
}

// Whether the JSON object `manifest` lists `name` as a key of one of `fields`.
export function listsDependency(manifest, fields, name) {
  return fields.some((f) => {
    const v = manifest?.[f];
    return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.hasOwn(v, name);
  });
}

// A script's name as a check name: lowercase, other characters as "-".
export const checkName = (script) => script.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(?=[0-9])/, 'c-');

// The named checks the found stacks' data gives, in each folder that has the stack's marker:
// [{ name, command, dir, source }]. `reader` reads tracked files (src/detect/walk.js).
export function stackChecks(found, stacks, reader) {
  const out = [];
  for (const f of found) {
    for (const rule of stacks[f.name].checks ?? []) {
      for (const dir of f.dirs) {
        if (rule.names) {
          const file = besides(dir, rule.file);
          const scripts = reader.json(file)?.[rule.field];
          if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) continue;
          for (const script of rule.names) {
            if (!Object.hasOwn(scripts, script)) continue;
            const name = checkName(script);
            if (!CHECK_NAME.test(name)) continue;
            out.push({ name, command: rule.command.map((a) => a.replaceAll('{script}', script)), dir, source: `${file} ${rule.field}.${script}`, stack: f.name });
          }
        } else {
          const file = besides(dir, rule.package.file);
          if (!listsDependency(reader.json(file), rule.package.fields, rule.package.name)) continue;
          out.push({ name: rule.name, command: [...rule.command], dir, source: `${file} lists ${rule.package.name}`, stack: f.name });
        }
      }
    }
  }
  return out;
}

// The tracked files that hold a commit-message rule (G8): a git `commit-msg` hook anywhere (a
// hooks folder the repo keeps, such as .githooks/), and every stack's commit_rules (all stacks,
// found or not: a rule file is a rule file). Sorted paths.
export function commitRuleFiles(tree, stacks, reader) {
  const found = new Set(filesNamed(tree, 'commit-msg'));
  const rules = Object.values(stacks).flatMap((s) => s.commit_rules ?? []);
  reader.prefetch(rules.filter((r) => r.contains).flatMap((r) => filesNamed(tree, r.file)));
  for (const r of rules) {
    for (const p of filesNamed(tree, r.file)) {
      if (nameOf(p) !== r.file) continue;
      if (!r.contains || (reader.text(p) ?? '').includes(r.contains)) found.add(p);
    }
  }
  return [...found].sort();
}
