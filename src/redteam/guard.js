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
  const a = probe.action;
  const allowed = [ctx.root, ctx.host.dockerSocket, ctx.host.sshAuthSock, ctx.host.claude, ctx.host.launcher, '/dev/null', ...(probe.allowPaths ?? [])].filter(Boolean);
  const inside = (p) => allowed.some((root) => p === root || p.startsWith(`${root}/`));
  const texts = [a.command, a.path, a.ask, a.then, a.pattern, ...Object.values(probe.env ?? {})].filter((t) => typeof t === 'string');
  // Known secret names count only outside the work folder: a fixture may hold canaries under
  // .config/mirai and a MIRAI home's path on purpose (unit 13c's interactive probes).
  const inFixture = new RegExp(`${ctx.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\s'"\`;|&()\\]},<>$~]*`, 'g');
  for (const text of texts) {
    const masked = text.replace(inFixture, '<fixture>');
    for (const re of FORBIDDEN) {
      if (probe.allowVars && re.source === '\\$' && !/\$(?!TMPDIR\b)/.test(text)) continue;
      // The "~" case names one throwaway file in your home folder, removed by its check.
      if (probe.allowTilde && re.source === '~' && text === `~/${ctx.tildeName}`) continue;
      if (re.test(masked)) throw new Error(`${where}: names a real secret location or expands something (${re})`);
    }
    if (/git\s+credential/.test(text) && !/host=mirai-probe\.invalid/.test(text)) throw new Error(`${where}: git credential for a host other than the canary`);
    for (const p of pathsIn(text)) if (!inside(p)) throw new Error(`${where}: names ${p}, outside the fixture`);
  }
  if (a.path && !(probe.allowTilde && a.path === `~/${ctx.tildeName}`) && !posix.resolve(a.path).startsWith(`${ctx.root}/`)) throw new Error(`${where}: a tool path outside the fixture`);
  const settings = probe.settings ?? {};
  const allows = [...(settings.permissions?.allow ?? []), ...(settings.sandbox?.filesystem?.allowRead ?? []), ...(settings.sandbox?.filesystem?.allowWrite ?? [])];
  for (const entry of allows) {
    for (const re of FORBIDDEN.slice(4)) if (re.test(entry)) throw new Error(`${where}: allows a real secret location (${re})`);
    for (const p of pathsIn(entry)) if (!inside(p)) throw new Error(`${where}: allows ${p}, outside the fixture`);
  }
}
