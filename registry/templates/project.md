---
id: product-project-web
type: project
template: project@v1
service: web
root: web
updated: "2026-01-01"
---
<!--
The project facts template, one per service (MIRAI, unit 36). It lives at
.mirai/context/project-<service>.md. It isn't approved: mirai lint checks it against the code.
Replace every line below; keep the headings.
- service: the service's name, as in the file name. root: its folder from the repo's top folder
  ("." for the top folder); its commands' scripts are read from the manifest there.
- Paths in backticks are from the repo's top folder, and must exist: the Layout table's Path
  column, the Stack table's "Set in" column, and the Instructions.
- Commands in backticks must run: a package script they name (npm run lint) must be in the
  manifest. Write the command as you'd type it, from the repo's top folder.
- Write what an agent can't read quickly from the code: the commands, where things are, what to
  read first. Don't copy the manifest's scripts or a folder tree.
-->
# Project: the service's name

What the service is, in one sentence.

## Stack

<!-- done when: the language, the framework, the test tools and the runtime, each with its version and where it's set -->
| Part | Version | Set in |
|---|---|---|
| The framework | 1.0 | `web/package.json` |

## Commands

<!-- done when: how to start it, run its tests (one file too), lint it and build it, as you'd type them -->
| What | Command |
|---|---|
| Run the tests | `npm test` |

## Layout

<!-- done when: the folders and files an agent needs first, each with what it holds; not a full tree -->
| Path | What it holds |
|---|---|
| `web/src/` | The service's code |

## Test levels

<!-- done when: each test level the config names for this service, with its command and what it covers -->
| Level | Command | What it covers |
|---|---|---|
| `unit` | `npm test` | What these tests check |

## Instructions

<!-- done when: each file with this service's own instructions, and what it says; or Not applicable — <reason> -->
- `web/README.md`: what an agent learns there.
