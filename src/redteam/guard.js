import { posix } from 'node:path';

// The canaries-only rule for every red-team case and probe (moved from unit 13a's harness in
// unit 18a). Every string a case carries (commands, tool paths, the question, its environment,
// its settings' allow lists) is checked:
// - no known secret store is named, no `$` or backtick expansion, no `..`;
// - every absolute path, normalised, is inside the work folder or one of the host items the
//   runner knows (the docker and ssh-agent sockets, claude, the launcher), or in the case's own
//   reviewed allowPaths;
// - `git credential` only for the canary host;
// - settings may deny anything (a deny is harmless), but every allow must pass the path rule.
const FORBIDDEN = [
  /~/,
  /\$/,
  /`/,
  /\.\./,
  /\.ssh\//,
  /\.aws\//,
  /\.kube\//,
  /\.docker\/config/,
  /\.netrc/,
  /\.config\/(mirai|gh)/,
  /Library\/Keychains/,
  /Library\/Application Support\/mirai/,
  /Claude Code-credentials/i,
  /security\s+(dump|unlock|export)/,
  /find-(generic|internet)-password(?![^;|]*-s mirai-probe-canary)/,
];
const PATH = /(?:^|[\s'"=([,<>])(\/+[A-Za-z][^\s'"`;|&)\]},<>]*)/g;

function pathsIn(text) {
  return [...text.matchAll(PATH)].map((m) => posix.resolve(m[1]));
}

export function guardProbe(probe, ctx) {
  const where = `probe ${probe.id}`;
  // A case whose call names the launch's own folders gets it at launch time, and is guarded then.
  const a = probe.action ?? {};
  const allowed = [ctx.root, ctx.host.dockerSocket, ctx.host.sshAuthSock, ctx.host.claude, ctx.host.testedClaude, ctx.host.launcher, '/dev/null', ...(probe.allowPaths ?? [])].filter(Boolean);
  const inside = (p) => allowed.some((root) => p === root || p.startsWith(`${root}/`));
  const texts = [a.command, a.path, a.ask, a.then, a.pattern, ...(a.input ? [JSON.stringify(a.input)] : []), ...Object.values(probe.env ?? {})].filter((t) => typeof t === 'string');
  // Known secret names count only outside the work folder: a fixture may hold canaries under
  // .config/mirai and a MIRAI home's path on purpose (unit 13c's interactive probes).
  const inFixture = new RegExp(`${ctx.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\s'"\`;|&()\\]},<>$~]*`, 'g');
  // A case may name an exact secret-looking path it has reviewed (unit 18b: the canary in
  // ~/.config/mirai, a folder of your home checked by exit code only); nothing else of it passes.
  const exact = (probe.allowSecretPaths ?? []).filter(Boolean);
  for (const text of texts) {
    const masked = exact.reduce((t, p) => t.split(p).join('<reviewed>'), text).replace(inFixture, '<fixture>');
    for (const re of FORBIDDEN) {
      if (probe.allowVars && re.source === '\\$' && !/\$(?!TMPDIR\b|\?)/.test(text)) continue;
      // The "~" case names one throwaway file in your home folder, removed by its check.
      if (probe.allowTilde && re.source === '~' && text === `~/${ctx.tildeName}`) continue;
      if (re.test(masked)) throw new Error(`${where}: names a real secret location or expands something (${re})`);
    }
    if (/git\s+credential/.test(text) && !/host=mirai-probe\.invalid/.test(text)) throw new Error(`${where}: git credential for a host other than the canary`);
    // A reviewed exact path is taken out first: it may hold a space ("Application Support", unit 18g's
    // kept Claude Code), which the path scan would split. The fixture's own paths stay, so ".." is seen.
    const unreviewed = exact.reduce((t, p) => t.split(p).join('<reviewed>'), text);
    for (const p of pathsIn(unreviewed)) if (!inside(p) && !exact.includes(p)) throw new Error(`${where}: names ${p}, outside the fixture`);
  }
  const reviewedPath = (p) => exact.includes(p) || (probe.allowPaths ?? []).some((x) => p === x || p.startsWith(`${x}/`));
  if (a.path && !(probe.allowTilde && a.path === `~/${ctx.tildeName}`) && !reviewedPath(a.path) && !posix.resolve(a.path).startsWith(`${ctx.root}/`)) throw new Error(`${where}: a tool path outside the fixture`);
  const settings = probe.settings ?? {};
  const allows = [...(settings.permissions?.allow ?? []), ...(settings.sandbox?.filesystem?.allowRead ?? []), ...(settings.sandbox?.filesystem?.allowWrite ?? [])];
  for (const entry of allows) {
    for (const re of FORBIDDEN.slice(4)) if (re.test(entry)) throw new Error(`${where}: allows a real secret location (${re})`);
    for (const p of pathsIn(entry)) if (!inside(p)) throw new Error(`${where}: allows ${p}, outside the fixture`);
  }
}
