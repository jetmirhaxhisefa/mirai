// A project's own ADR folder (unit 61, Scope 6; D-20: its folder and numbering win). Read from the
// integration branch's file list: the first folder of the usual names that holds files numbered
// like ADRs ("adr-0001-….md", "ADR-0001-….md", "0001-….md"). Its numbering is the first number as
// those files write it. Null when there is none.

const FOLDERS = ['docs/decisions', 'docs/adr', 'docs/adrs', 'doc/adr', 'doc/decisions', 'docs/architecture/decisions', 'docs/architecture/adr', 'adr', 'decisions'];
const NUMBERED = /^([A-Za-z]{0,8}-?)([0-9]{3,6})-[^/]+\.md$/;

export function adrFolderOf(files) {
  const paths = files instanceof Map ? [...files.keys()] : [...files];
  for (const folder of FOLDERS) {
    const names = paths.filter((p) => p.startsWith(`${folder}/`) && !p.slice(folder.length + 1).includes('/')).map((p) => p.slice(folder.length + 1));
    const numbered = names.map((n) => NUMBERED.exec(n)).filter(Boolean);
    if (!numbered.length) continue;
    // The prefix most of them use, and its width.
    const counts = new Map();
    for (const m of numbered) {
      const key = `${m[1]}\u0000${m[2].length}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const [prefix, width] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split('\u0000');
    return { folder, numbering: `${prefix}${'1'.padStart(Number(width), '0')}`, files: numbered.length };
  }
  return null;
}
