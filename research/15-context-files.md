# 15 — The context files: business, journeys, feature map, project facts, conventions

Research date: 2026-11-20, for unit 36. Jet's standing rule: each document's format is researched
in depth in its own unit. This file covers the five files in `.mirai/context/` that every agent
run loads:

- `business.md`;
- `journeys.md`;
- `feature-map.md`;
- `project-<service>.md`;
- `conventions-<service>.md`.

Every fact below comes from a live fetch of the URL next to it on this date. Licenses are as the
page or its repo states them; "not stated" means the page shows none. Findings are in MIRAI's own
words, with short quotes only. This is not legal advice. Wording follows `mirai-write`.

---

## 1. Summary

| File | What the best sources agree on | What MIRAI takes |
|---|---|---|
| All five | A file every run loads must be short and concrete. Claude Code targets under 200 lines per `CLAUDE.md`, Copilot at most 2 pages, Codex 32 KiB in all. Each line costs attention on every task. | `business.md` is capped at 1,000 words (warn at 800). The others hold tables and one-line rules, not prose. |
| `business.md` | A customer-first page with a hard length cap (Amazon's press release: under one page). It names the problem, who it's for, the goals and what's left out (Shape Up's no-gos; Atlassian's project poster). One shared vocabulary (Fowler, "UbiquitousLanguage"). | Sections from D-43, a Glossary, and "what this repo isn't". Every claim cites its source, so a reviewer can check it. |
| `journeys.md` | A critical user journey is a sequence of tasks core to a user's experience. List them, and order them by business impact (Google SRE workbook; Google Cloud blog). Keep the end-to-end tests few, on the paths that carry the product's value (Fowler; Vocke). | Each journey says why it's critical (users or money lost), with a source. It names one end-to-end test, or "none yet". Few journeys, most important first. |
| `feature-map.md` | Find elements the way a person does: role and accessible name first, test IDs last (Testing Library; Playwright). `data-testid` is the default test-ID attribute. | Each handle is `role "name"` or `data-testid="…"`. The lint finds each handle in the code. |
| `project-<service>.md` | Commands must be exact and must work; agents run them (agents.md, Copilot, Claude Code). Name where key files are. BMAD warns that copied trees and script lists go stale. | Only what the lint can verify: paths that exist, commands whose scripts exist. No copied manifests, no full trees. |
| `conventions-<service>.md` | A tool that enforces a rule beats prose (Go's gofmt, Prettier, ESLint's move to formatters). Claude Code and Codex both say to leave lint and formatting to CI. Guidance is for what no tool checks (Google eng-practices: the style guide where it requires, judgement otherwise). | Each rule is tagged `enforced by <check>` (a named check that must exist) or `judgment` with an example. The lint warns when a judgment rule repeats a check's tool. |

---

## 2. Shared sources: files agents load on every run

### 2.1 AGENTS.md

- **Site:** https://agents.md/ (Agentic AI Foundation, a Linux Foundation project). License: not
  stated on the site.
- **Repo:** https://github.com/agentsmd/agents.md. License: MIT.
- Findings:
  - It is a "README for agents": build steps, tests and conventions, kept out of the human README.
  - Suggested sections: overview, build and test commands, code style, testing, security. Commit
    rules and gotchas are optional.
  - No required fields and no length limit. The nearest file wins in a monorepo.
  - Agents run the listed test commands and try to fix failures, so the commands must be real.

### 2.2 Claude Code: memory and best practices

- **"How Claude remembers your project":** https://code.claude.com/docs/en/memory (Anthropic).
  License: not stated.
  - `CLAUDE.md` is "context, not enforced configuration". A rule that must always hold belongs in
    a hook.
  - Concrete, checkable lines work: "Run `npm test` before committing", not "Test your changes".
  - Target "under 200 lines per CLAUDE.md file"; longer files lower adherence. Imports organize a
    file but don't lower its cost.
  - Contradictions are resolved arbitrarily, so review the files from time to time.
  - Claude Code's own audit flags references to files or commands that don't exist.
- **"Best practices for Claude Code":** https://code.claude.com/docs/en/best-practices (the old
  anthropic.com engineering post redirects here). License: not stated.
  - Keep the file short: each line costs attention "on *every* task". Hold only what Claude
    couldn't work out from the code.
  - Include the exact test, typecheck and lint commands, the code's traps, and "anything you've
    had to correct twice already".
  - A rule with zero exceptions belongs in a hook or CI; a preference ("Prefer named exports")
    stays as guidance. "Keep the enforced set small."

### 2.3 OpenAI Codex and GitHub Copilot

- **Codex, AGENTS.md:** https://learn.chatgpt.com/docs/agent-configuration/agents-md (OpenAI).
  License: not stated.
  - Files are joined from the repo's top folder down; closer files override earlier ones.
  - `project_doc_max_bytes` defaults to 32 KiB for all of them together.
  - For review rules: say what to flag, and "leave formatting and lint checks to CI".
- **Copilot, repository instructions:**
  https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
  (GitHub). License: not stated on the page.
  - Include what the repo does, its stack and versions, and how to build, test, run and lint it.
    Commands should be "validated by running them".
  - Say where the key files and config are, and which checks CI runs.
  - Instructions "must be no longer than 2 pages" and "must not be task specific".

### 2.4 BMAD project context

- https://docs.bmad-method.org/existing-codebases/set-and-maintain-project-context/ (BMad Code).
  License: MIT (page footer and repo).
- Findings:
  - Keep only "what is expensive to rediscover", or what an agent learns only after it went
    wrong: policy, command caveats, conventions that differ from the usual way, and pitfalls.
  - Leave out repo overviews, folder trees, stack lists and copies of `package.json` scripts:
    "Agents read code better than prose", and copies go stale.
  - An audit leaves the block "smaller or equal, never larger".

**The tension, and MIRAI's answer.** D-43 and the unit's spec ask for a stack, commands and a
layout in `project-<service>.md`; BMAD says such lists go stale. MIRAI keeps the sections, but the
lint checks every path and every command's script against the code, so a stale line fails
`mirai lint`. The template says not to copy a manifest or a folder tree.

---

## 3. `business.md`

| Source | License | Findings |
|---|---|---|
| Amazon, "An insider look at Amazon's culture and processes" (excerpt of *Working Backwards*, 2021-02-09): https://www.aboutamazon.com/news/workplace/an-insider-look-at-amazons-culture-and-processes | not stated (Amazon copyright) | Start from the customer, not the company. The press release is "always less than one page"; the FAQ is five pages or less. Expect ten drafts or more: a hard cap backed by revision. |
| Colin Bryar, "Working Backwards: How to write an Amazon PR/FAQ": https://docs.superhuman.com/@colin-bryar/working-backwards-how-write-an-amazon-pr-faq | not stated | Three parts: the press release (customer, problem, solution), an external FAQ, an internal FAQ (risks). About six pages, read in 20 minutes: length is reading time. |
| Basecamp, *Shape Up*, ch. 6 "Write the Pitch": https://basecamp.com/shapeup/1.5-chapter-06 | all rights reserved (37signals); cited, not copied | Problem, appetite, solution, rabbit holes, no-gos. No-gos name what's left out. |
| Atlassian Team Playbook, "Project poster": https://www.atlassian.com/team-playbook/plays/project-poster | Atlassian copyright; no open license | Why it matters to customers and the business, the goals, the open risks. A living page, updated with stakeholders. |
| Lenny Rachitsky, "My favorite product management templates" (2020-08-04): https://www.lennysnewsletter.com/p/my-favorite-templates-issue-37 | not stated | The one-pagers it lists start with who, why and what, focus on success criteria and risks, and stay to one page at first. |
| Martin Fowler, "UbiquitousLanguage" (2006): https://martinfowler.com/bliki/UbiquitousLanguage.html | © Martin Fowler | One rigorous language shared by developers and users; it changes as understanding grows. |

**What MIRAI takes:**

- The sections are D-43's: what the product does; who it's for (users, customers, who pays);
  the model and goals; what this repo is and isn't responsible for; business rules; glossary;
  constraints; stakeholders (optional); sources.
- **A hard cap**, as Amazon's page limit: 1,000 words, a warning at 800 (Jet's decision 3), the
  Sources table not counted. Detail stays in the linked sources.
- **Every claim cites a source** (Jet's decision 2). None of the sources above requires it; MIRAI
  adds it because agents load the file as fact, and a reviewer must be able to check each claim.
  "You said" with a date covers what only the owner knows.
- **The glossary** follows the ubiquitous-language idea: the business's words, which the code
  should use too.
- **"What this repo isn't responsible for"** is the no-gos idea, applied to a repo, so an agent
  doesn't build here what belongs elsewhere.

---

## 4. `journeys.md`

| Source | License | Findings |
|---|---|---|
| Google SRE Workbook, ch. 2 "Implementing SLOs": https://sre.google/workbook/implementing-slos/ | CC BY-NC-ND 4.0 | "A critical user journey is a sequence of tasks that is a core part of a given user's experience". Example: search, add to cart, buy. Keep the set small and centred on what matters to users. |
| Google SRE Workbook, ch. 5 "Alerting on SLOs": https://sre.google/workbook/alerting-on-slos/ | CC BY-NC-ND 4.0 | Measure reliability as customers experience it. (Background only.) |
| Google Cloud blog, "Setting SLOs: a step-by-step guide" (Cindy Quach, 2020-07-11): https://cloud.google.com/blog/products/management-tools/practical-guide-to-setting-slos | not stated (Google copyright) | Step 1: "List out critical user journeys and order them by business impact." Checkout ranks above browsing, because it's closer to money. |
| Martin Fowler, "TestPyramid": https://martinfowler.com/bliki/TestPyramid.html | © Martin Fowler | Many more unit tests than UI tests; UI tests are brittle, slow and expensive. |
| Ham Vocke, "The Practical Test Pyramid" (2018): https://martinfowler.com/articles/practical-test-pyramid.html | © Martin Fowler | End-to-end tests are "notoriously flaky". Keep them few, on the high-value paths that define the product's core value. |

**What MIRAI takes:**

- **A journey is a sequence of steps a person takes**, named by what they get done, with an ID
  `J-n` (D-44, D-35). The steps name screens in bold, as the feature map names them.
- **"Why critical:"** says who is stopped, or what money is lost, when it breaks, with a source.
  This is the SRE rule: order by business impact.
- **One end-to-end test per journey**, or "none yet". The pyramid sources say to keep these few,
  which is why only critical journeys get them (D-44). The checklist asks for five or fewer for
  most products, most important first.

---

## 5. `feature-map.md`

| Source | License | Findings |
|---|---|---|
| Testing Library, "About Queries": https://testing-library.com/docs/queries/about/ | MIT (testing-library-docs repo) | Priority: queries everyone can perceive (`getByRole`, `getByLabelText`, …), then semantic ones, then `getByTestId` last. "The user cannot see (or hear)" test IDs; use them where the text changes. |
| Playwright, "Locators": https://playwright.dev/docs/locators | Apache-2.0 (microsoft/playwright) | `getByRole` "reflects how users and assistive technology perceive the page"; pass the accessible name to pick one element. `getByTestId` reads `data-testid` by default, and a project can change the attribute. |
| Playwright, "Best Practices": https://playwright.dev/docs/best-practices | Apache-2.0 | Prefer user-facing attributes and explicit contracts; avoid CSS and DOM-structure selectors. |
| MDN, "Accessible name": https://developer.mozilla.org/en-US/docs/Glossary/Accessible_name | Creative Commons (version not named) | The name comes from content, a label, `alt` or `aria-label`; prefer visible text. |

**What MIRAI takes:**

- One row per screen: its name as people say it, its route, and its handles.
- **Handles in the order the sources rank them:** a role and its accessible name
  (`button "Log in"`), `label "Email"` for a labelled field, and `data-testid="…"` only where the
  text changes. A changing part is written `<like-this>`.
- **The lint checks the handles exist in the code** under the folders the map lists. Tests are
  left out of that search: a handle a test names but the code doesn't have isn't real.
- **A route is only a warning when it isn't found**: routers often build routes at run time.
- **Not taken:** Playwright's configurable test-ID attribute. The map reads `data-testid` only; a
  project with another attribute writes its handles by role. A later unit can add the setting.

---

## 6. `project-<service>.md`

From §2: Claude Code asks for the exact test, typecheck and lint commands, and how to run one
test file. Copilot asks for commands "validated by running them", with versions, and where the
key files are. Codex puts per-service commands in nested files. BMAD warns against copied
manifests and trees.

**What MIRAI takes:**

- Five sections: stack and versions (each with the file that sets it), commands, layout (the
  places an agent needs first, not a tree), test levels, and where the service's own
  instructions are.
- **Every path is checked**: the Layout table's paths, the Stack table's "Set in" files, and the
  Instructions. **Every command that runs a package script is checked** against the manifest in
  the service's folder. The forms come from each stack's `[[scripts]]` data (`npm run x`,
  `npm test`, `composer run-script x`), as 17a reads named checks from data, not code.
- It isn't approved (Jet's decision 5): facts are checked by the lint, not by you.

---

## 7. `conventions-<service>.md`

| Source | License | Findings |
|---|---|---|
| Google eng-practices, "What to look for in a code review": https://google.github.io/eng-practices/review/reviewer/looking-for.html | CC-BY 3.0 | Where the style guide requires something, it is the authority; where it only recommends, the reviewer judges; otherwise match the code. Don't block a change on personal style. |
| Google eng-practices, "The Standard of Code Review": https://google.github.io/eng-practices/review/reviewer/standard.html | CC-BY 3.0 | "Technical facts and data overrule opinions and personal preferences." |
| Google Style Guides: https://google.github.io/styleguide/ | CC-BY 3.0 (code samples Apache 2.0) | Consistency makes a large codebase readable; the guides point to formatters that enforce them. |
| Effective Go, "Formatting": https://go.dev/doc/effective_go | not verified (page footer not read) | Formatting is "the most contentious but the least consequential" issue; Go lets the machine handle it. |
| Prettier, "Why Prettier?": https://prettier.io/docs/why-prettier | not stated on the page | A formatter ends debates over style nits; a pre-commit hook takes them out of review. |
| ESLint, "Deprecation of formatting rules" (2023-10-26): https://eslint.org/blog/2023/10/deprecating-formatting-rules/ | MIT (eslint.org footer) | ESLint dropped its formatting rules and points to a dedicated formatter. |

With §2: Claude Code says a rule with zero exceptions belongs in a hook or CI and a preference
stays as guidance; Codex says to leave formatting and lint to CI; BMAD keeps only conventions that
differ from the usual way, and observed pitfalls.

**What MIRAI takes:**

- **Two kinds of rule, tagged** (design/01 setup step 4):
  - `(enforced by <check>)`: one line. The check must be a named check in the config, or the
    rule fails: a tag that names no real check is a claim nobody enforces.
  - `(judgment)`: a short rule with an example from this code. An example makes the rule
    concrete, as Claude Code's "checkable lines" advice asks.
- **A judgment rule that names a check's tool is a warning**: a check already holds it, so the
  prose is noise (the formatter sources; Codex's "leave it to CI").
- **What's worth a rule:** what this code does differently, and mistakes made twice (Claude Code,
  BMAD). The checklist asks it; the lint can't.
- You approve the file (Jet's decision 5): the rules are decisions, not facts.

---

## 8. Sources not reached

- Lenny Rachitsky's own one-pager (a Google Doc linked from the newsletter): not fetched.
- An Amazon-authored PR/FAQ template: none found; the book excerpt and Bryar's guide were used.
- Google Cloud documentation pages on critical user journeys: none found beyond the blog post.
- The licenses of GitHub Docs, Prettier's site and go.dev weren't verified.

## 9. What unit 36 takes, and what it leaves

**Takes:** the five formats in §§3–7; the business cap and source IDs (Jet's decisions 2 and 3);
handles by role first; checks against the code for the two files that aren't approved; the
enforced or judgment tag with its two lints.

**Leaves:**

- A cap on the number of journeys: the checklist asks for five or fewer, and the lint doesn't
  count them.
- Playwright's configurable test-ID attribute.
- Path-scoped rules (Copilot's `applyTo`, Claude's `.claude/rules/`): a conventions file is per
  service already.
- How agents load the files (setup, 39, and the agent units): this unit defines the files only.
