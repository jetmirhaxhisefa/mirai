import { join } from 'node:path';

import { EXIT } from '../exit-codes.js';
import { UsageError } from '../errors.js';
import { shown } from '../../status/text.js';
import { openStore } from '../../store/home.js';
import { snapshot, trustedStrict } from '../../trust/snapshot.js';
import { canonicalSha256, expectedInit, launchArgs, launchFacts, MODES, readableEnv, renderStrict } from '../../launch/strict.js';

// mirai sandbox show [<agent> | --mode read-write|read-only] (unit 13b). Prints the settings an
// agent would run under in this checkout, with this machine's paths filled in, plus the launch
// flags and the environment's names. It starts nothing and creates no launch folder; the trust
// root is built (or reused) the way every launch builds it. The token is never shown.
export default {
  name: 'sandbox',
  summary: 'Show the rules an agent runs under here',
  usage: 'mirai sandbox show [<agent> | --mode read-write|read-only]',
  positionals: { min: 1, max: 2 },
  options: {
    mode: { type: 'string', description: 'an access mode instead of an agent: read-write or read-only' },
  },
  run(args, io) {
    const [action, agent] = args.positionals;
    if (action !== 'show') throw new UsageError(`unknown action ${shown(action)}`, 'see: mirai sandbox --help');
    const mode = args.values.mode;
    if (agent && mode) throw new UsageError('give an agent or --mode, not both', 'see: mirai sandbox --help');
    if (mode !== undefined && !MODES.includes(mode)) throw new UsageError(`--mode is read-write or read-only, not ${shown(mode)}`, 'see: mirai sandbox --help');
    const name = agent ?? mode ?? 'read-write';

    const store = openStore({ cwd: io.cwd, env: io.env });
    const trust = snapshot({ cwd: io.cwd, env: io.env });
    const template = trustedStrict(trust, name);
    const launchDir = join(store.repoHome, 'launches', 'EXAMPLE');
    const facts = launchFacts({ trust, checkout: store.checkout, env: io.env, launchDir, scratchDir: '/private/tmp/mirai-EXAMPLE0', template });
    facts.hookCommand = `"<node>" "${join(trust.dir, 'tree', '.mirai', 'framework', 'bin', 'hook.js')}" "${join(launchDir, 'input', 'hook-policy.json')}" <policy sha256>`;
    const settings = renderStrict(template, facts);
    // MIRAI's MCP server (unit 14d), when the template has test levels or checks to offer.
    const tests = template.tests;
    const { refused } = readableEnv(template, facts.tracked);
    const flags = launchArgs({ template, settingsFile: join(launchDir, 'input', 'settings.json'), agentsJson: template.agent ? '<the agent from the trust root>' : null, mcpConfig: tests ? join(launchDir, 'input', 'mcp.json') : null });
    const expected = expectedInit(template);
    io.stdout.write([
      `${template.agent ? `agent ${template.agent}` : `mode ${template.mode}`} (${template.mode}), from the trust root at ${trust.baseSha.slice(0, 12)}`,
      '',
      'launch:',
      `  claude -p <prompt> ${flags.map((f) => (/[\s"<>]/.test(f) ? JSON.stringify(f) : f)).join(' ')}`,
      '',
      'environment (nothing else of yours):',
      '  PATH LANG TERM USER HOME (yours; PATH keeps absolute folders outside the project only);',
      '  TMPDIR, CLAUDE_CODE_TMPDIR (the launch\'s own short scratch folder, /private/tmp/mirai-<8 hex>);',
      '  CLAUDE_CONFIG_DIR (a fresh, empty folder per launch); GIT_CONFIG_NOSYSTEM=1, GIT_CONFIG_GLOBAL (MIRAI\'s);',
      '  CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR=3 (the token goes on fd 3, from mirai token)',
      '  MCP_TOOL_TIMEOUT, MCP_TIMEOUT (fixed: how long a test call and the server\'s start may take)',
      '',
      ...(tests ? [
        'MIRAI\'s MCP server (from the trust root, outside the sandbox; its policy in the launch\'s input/):',
        ...(tests.levels.length ? [`  run_tests(level, path?): ${tests.levels.join(', ')}`] : []),
        ...(tests.checks.length ? [`  run_check(name): ${tests.checks.join(', ')}`] : []),
        '  a path is a file or folder of the project (letters, digits, _ . / @ -; no leading - or /, no "." or ".." parts)',
        '',
      ] : ['MIRAI\'s MCP server: none (no [compose] files and env_file, or no level or check with a service)', '']),
      `checked after launch: tools ${expected.tools.join(', ')}; no API key; no memory; permission mode ${expected.permissionMode}; ${expected.mcpServers.length ? 'MIRAI\'s MCP server connected, ' : ''}no MCP server MIRAI didn't pass; only Claude Code ${template.builtin.version}'s own plugins, skills and agents`,
      '',
      ...(refused.length ? ['readable env files the config names but that stay denied:', ...refused.map((r) => `  ${r.path}: ${r.why}`), ''] : []),
      `canonical bundle hash (what red-team results are keyed by): ${canonicalSha256(template).slice(0, 16)}`,
      '',
      `settings (written to the launch's input/settings.json; EXAMPLE stands for the launch id):`,
      JSON.stringify(settings, null, 2),
      '',
    ].join('\n'));
    return EXIT.OK;
  },
};
