import { GATE_STAGES, NEVER_AUTO_STAGES, JUDGEMENT_STEPS, STEPS } from './defaults.js';
import { linkHasCredential, remoteHasCredential } from './credentials.js';

// The config schema (unit 03b; the key list in design/07, "Config keys (unit 03b)").

// What each layer may set, as key paths. Personal settings never live in a shared repo
// (D-57); personal files can't change team policy. `*` allows every key below a table.
export const LAYER_KEYS = Object.freeze({
  project: ['schema_version', 'preset', 'git.*', 'models.*', 'testing.*', 'checks.*', 'compose.*', 'repos',
    'workspace.*', 'resources.*', 'gate.*', 'gates.*', 'retention.*', 'run.*'],
  'personal-repo': ['schema_version', 'models.light', 'models.standard', 'models.deep', 'run.stop_by'],
  'personal-global': ['schema_version', 'subscription.*', 'usage.*'],
});

const NAME = /^[a-z][a-z0-9-]*$/;
const NAME_HINT = 'lowercase letters, digits and "-", starting with a letter';

// A git branch name (a subset of git check-ref-format): components don't start with "." or
// end with ".lock"; no "..", "//", "@{", a lone "@", control or special characters.
// A subscription plan name (D-57), shared by the global config, the run log and the usage ledger.
export const PLAN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const BRANCH = /^(?!\/)(?!-)(?!@$)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)(?!.*(?:^|\/)\.)(?!.*\.lock(?:\/|$))(?!.*[/.]$)[^\s~^:?*[\\\x00-\x1f\x7f]+$/;

function relativePath(value, path, report) {
  if (value === '' || value.startsWith('/') || value.includes('\\') || value.split('/').includes('..') || value.includes('\0')) {
    report(path, `${path} must be a relative path inside the repo`, 'no leading "/", no ".." and no "\\"', 'path');
  }
}

const relPath = { type: 'string', check: relativePath };
const argv = { type: 'array', items: { type: 'string', pattern: /\S/, patternHint: 'no empty arguments' }, minItems: 1 };
const globs = { type: 'array', items: { type: 'string', pattern: /\S/, patternHint: 'no empty patterns' } };

const NO_CREDENTIAL_HINT = 'keep links and names only; log in through the tool itself';

const resource = {
  type: 'table',
  fields: {
    name: { type: 'string' },
    url: {
      type: 'string',
      check(value, path, report) {
        if (linkHasCredential(value)) return report(path, `${path} looks like it contains a credential`, NO_CREDENTIAL_HINT, 'credential');
        if (!/^https?:\/\/[^\s/]+/.test(value)) report(path, `${path} must be an http(s) link`, undefined, 'pattern');
        return undefined;
      },
    },
  },
  required: ['url'],
};

// What a test level is required for (D-44, D-48).
export const REQUIRED_FOR = Object.freeze(['all', 'logic', 'endpoint-changes', 'critical-journeys', 'interface-changes']);

const level = {
  type: 'table',
  fields: {
    name: { type: 'string', pattern: NAME, patternHint: NAME_HINT },
    repo: { type: 'string' },
    adapter: { type: 'string' },
    command: argv,
    purpose: { type: 'string' },
    required_for: { type: 'array', items: { type: 'enum', values: REQUIRED_FOR } },
    budget_minutes: { type: 'integer', min: 1 },
  },
  required: ['name', 'command'],
};

// A named check is a command (argv), or a table with the command and where and how long it runs.
const namedCheck = {
  type: 'choice',
  pick: (value) => (Array.isArray(value) ? argv : {
    type: 'table',
    fields: { command: argv, service: { type: 'string', pattern: NAME }, workdir: relPath, timeout_minutes: { type: 'integer', min: 1, max: 240 } },
    required: ['command'],
  }),
};

const repo = {
  type: 'table',
  fields: {
    name: { type: 'string', pattern: /^(\.|[a-z][a-z0-9-]*)$/, patternHint: `"." or ${NAME_HINT}` },
    path: relPath,
    remote: {
      type: 'string',
      check(value, path, report) {
        if (remoteHasCredential(value)) report(path, `${path} looks like it contains a credential`, NO_CREDENTIAL_HINT, 'credential');
      },
    },
    start: argv,
    health: argv,
  },
  required: ['name', 'path'],
};

const tier = { type: 'enum', values: ['light', 'standard', 'deep'] };

export const CONFIG_SCHEMA = {
  type: 'table',
  fields: {
    preset: { type: 'enum', values: ['supervised', 'autonomous'] },
    git: {
      type: 'table',
      fields: {
        integration_branch: { type: 'string', pattern: BRANCH, patternHint: 'a git branch name such as "main"' },
        branch_pattern: {
          type: 'string',
          check(value, path, report) {
            if (!value.includes('{ticket}')) report(path, `${path} must contain {ticket}`, 'for example "feature/{ticket}-{slug}"', 'pattern');
          },
        },
        trailer: { type: 'string', pattern: /^[A-Za-z][A-Za-z0-9-]*$/, patternHint: 'a single word such as "Mirai-Ticket"' },
      },
      required: ['integration_branch'],
      requiredHints: { integration_branch: 'add integration_branch = "main" under [git]' },
    },
    models: {
      type: 'table',
      fields: {
        light: { type: 'string' },
        standard: { type: 'string' },
        deep: { type: 'string' },
        steps: {
          type: 'table',
          fields: Object.fromEntries(STEPS.map((step) => [step, tier])),
          check(value, path, report) {
            for (const step of JUDGEMENT_STEPS) {
              if (value[step] !== undefined && value[step] !== 'deep') {
                report(`${path}.${step}`, `${path}.${step} must stay "deep"`, 'judgement steps are never run on a lower tier (D-14)', 'judgement-tier');
              }
            }
          },
        },
      },
    },
    testing: {
      type: 'table',
      fields: {
        tdd: { type: 'enum', values: ['auto', 'on', 'off'] },
        tests: { type: 'enum', values: ['required', 'optional'] },
        levels: { type: 'array', items: level, uniqueBy: 'name' },
        e2e_budget_minutes: { type: 'integer', min: 1 },
      },
    },
    checks: { type: 'table', map: namedCheck, keyPattern: NAME, keyHint: NAME_HINT },
    compose: { type: 'table', fields: { files: { type: 'array', items: relPath }, env_file: relPath } },
    repos: { type: 'array', items: repo, minItems: 1, uniqueBy: 'name' },
    workspace: { type: 'table', fields: { e2e: { type: 'enum', values: ['local', 'deployed', 'none'] } } },
    resources: { type: 'table', map: resource, keyPattern: NAME, keyHint: NAME_HINT },
    gate: {
      type: 'table',
      fields: {
        code_paths: {
          ...globs,
          check(value, path, report) {
            if (!value.some((p) => !p.startsWith('!'))) report(path, `${path} needs at least one pattern that includes code`, 'for example "**"', 'range');
          },
        },
        risk: { type: 'table', fields: { high: globs } },
      },
    },
    gates: {
      type: 'table',
      fields: Object.fromEntries(GATE_STAGES.map((stage) => [stage, { type: 'enum', values: ['human', 'auto'] }])),
      check(value, path, report) {
        for (const stage of NEVER_AUTO_STAGES) {
          if (value[stage] === 'auto') report(`${path}.${stage}`, `${path}.${stage} can never be automatic`, 'this decision always needs you (D-34)', 'never-auto');
        }
      },
    },
    retention: { type: 'table', fields: { days: { type: 'integer', min: 1, max: 3650 }, auto: { type: 'boolean' } } },
    run: {
      type: 'table',
      fields: {
        stop_by: { type: 'string', pattern: /^([01][0-9]|2[0-3]):[0-5][0-9]$/, patternHint: 'a 24-hour time as a string, for example "06:30"' },
      },
    },
    subscription: {
      type: 'table',
      fields: { plan: { type: 'string', pattern: PLAN, patternHint: 'for example "max-20x" (at most 32 characters)' } },
    },
    usage: {
      type: 'table',
      fields: {
        night_max: { type: 'integer', min: 0, max: 100 },
        week_max: { type: 'integer', min: 0, max: 100 },
        reserve: { type: 'integer', min: 0, max: 100 },
      },
      check(value, path, report) {
        if (Number.isInteger(value.night_max) && Number.isInteger(value.week_max) && value.night_max > value.week_max) {
          report(`${path}.night_max`, `${path}.night_max must not be larger than ${path}.week_max`, undefined, 'range');
        }
      },
    },
  },
  required: ['git'],
  requiredHints: { git: 'add a [git] table with integration_branch = "main"' },
  check(config, path, report) {
    // A test level can name its repo only when that repo is listed.
    const names = new Set((config.repos ?? []).map((r) => r?.name));
    (config.testing?.levels ?? []).forEach((l, i) => {
      if (typeof l?.repo === 'string' && !names.has(l.repo)) {
        report(`testing.levels[${i}].repo`, `testing.levels[${i}].repo is not one of the repos`, 'use a name from [[repos]]', 'unknown-repo');
      }
    });
  },
};
