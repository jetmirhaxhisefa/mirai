---
status: draft
version: 1
---

# 17 — Debug and operate (stage 5)

Decisions PM-17 to PM-23 and PM-34.

## 1. What this stage adds

MIRAI builds features. This stage lets you also use it to **understand and operate** the
product:

- **debug** an issue you found;
- **learn** how something works (`teach-me`);
- get help with **database queries**, including data fixes;
- a **nightly run** that detects problems and diagnoses them;
- a **security audit** on demand.

They share one base: read-only evidence tools through the broker, and one findings record.

**No automatic fix anywhere in this stage.** A confirmed problem becomes a ticket with its
evidence and goes through the normal flow.

## 2. Evidence sources (P31, P32)

### 2.1 The rule

An agent never gets credentials, a database connection or a shell on a server. It calls broker
tools. The broker holds the access, limits what comes back and removes secrets and personal
data before the agent sees anything.

### 2.2 The tools

| Tool (proposed) | What it does | Limits |
|---|---|---|
| `logs_search(source, since, until, pattern, limit)` | Returns matching log lines from a configured source | A time window is required. Lines and bytes are capped. Redaction runs on every line |
| `db_query(source, sql)` | Runs one `SELECT` on a configured database | The controls of §2.6: the database enforces read-only, the broker adds a statement check, a row cap and a timeout. Local and staging mask columns marked personal. Production returns only allow-listed views or columns |
| `db_schema(source, table?)` | Returns tables, columns, keys and indexes | No data |
| `metrics_query(source, metric, since, until)` | Returns a series for a named metric (CPU, memory, error rate, latency) | Only metrics named in config |
| `ui_explore(env, script)` | Runs a Playwright script in the Playwright container and returns screenshots and output | Ivy's existing mechanism (unit 51) with the limits of §2.7. **Local and staging only.** Production never takes a script: it takes the name of a committed journey (§7.3) |

Code needs no new tool: agents already read the checkout.

### 2.3 Sources and adapters

Each source is one entry in config, and each kind of source is one adapter file behind one
interface, so a new kind (Datadog, for example) is one file.

```toml
[[evidence.logs]]
name = "api-local"
env = "local"
kind = "docker"             # docker logs of a compose service
service = "api"

[[evidence.logs]]
name = "api-prod"
env = "production"
kind = "gcp-logging"        # or "aws-cloudwatch", "file"

[[evidence.database]]
name = "main-staging"
env = "staging"
kind = "mysql"              # or "postgres"
personal_columns = ["users.email", "users.phone"]
```

| Adapter | Unit | Access comes from |
|---|---|---|
| Docker logs of a compose service, log files in the project (Laravel logs and the like) | P31 | The local stack |
| MySQL and PostgreSQL | P31b | A read-only user you create. The password lives in `~/.config/mirai/`, never in the repo. MIRAI has no dependencies, so it has no database driver: **check first** how the broker connects. The likely answer is the database's own command-line client inside a container (§2.6) |
| GCP Cloud Logging and Monitoring | P32 | Your own `gcloud` login with a read-only role |
| AWS CloudWatch Logs and metrics | P32 | Your own `aws` login with a read-only role |
| Log files on a server | P32 | **Check first:** over SSH with a restricted key, or not at all. The ssh-agent is one of the things the cage keeps from agents |
| Datadog and others | Later | One adapter file each |

In a workspace each source belongs to a service, and the tools take the service as part of the
source name.

### 2.4 Environments (PM-18)

In this order: **local**, then **staging**, then **production**.

- **Local** needs no new access and comes first (P31, P31b).
- **Staging** uses the same adapters with staging access (P32).
- **Production** is needed for real bugs whose data exists nowhere else. It gets the tightest
  setup (P32):
  - a setup step of its own, `mirai evidence setup --env production`, which checks each source
    before it can be used;
  - for a database: the user has only `SELECT`, and **only on views or columns you list**.
    Production is an allow-list, never "everything except the marked columns". Setup tries a
    write and a read outside the list and must see both refused;
  - for cloud logs: a role that can only read;
  - lower caps than staging;
  - **its own red-team cases**, and no production source is usable until they pass;
  - every production call is logged with the query and the row or line count, never the data.

### 2.5 Threats this design answers

- **Instructions hidden in logs or data.** Anyone who can make the app log a sentence, or store
  one in a database field, can try to steer the agent. So: evidence is fenced as untrusted
  data, every claim in a finding must cite the line or row it rests on, and no evidence tool can
  change anything.
- **Personal data and secrets.** Redaction runs in the broker on every result: secret patterns,
  email addresses, phone numbers, tokens, and the columns you mark. Pattern matching misses
  things, so redaction **reduces** what an agent sees and doesn't guarantee it. That is why
  production uses an allow-list (§2.4). What an agent has seen can end up in a finding, a ticket
  or a log.
- **Data leaves your machine.** Whatever an evidence tool returns is sent to the model provider
  as part of the agent's context. For local and staging data that is the same as today's test
  data. **For production data it is a decision you make per project**, recorded when
  `mirai evidence setup --env production` is run (§2.8).
- **Cost.** A query can be large. Caps and timeouts are enforced by the broker, not asked of
  the agent.
- **A write disguised as a read.** §2.6.
- **A browser script that sends data out.** §2.7.

### 2.6 How a query is kept read-only

The database is the primary control. The broker's check is the second one.

1. **On the server:** the user has no write grants. Each query runs in a read-only transaction
   with a statement timeout. For production the user sees only the listed views.
2. **The client:** the database's command-line client, run in a container, with its start-up
   files off and exactly one statement passed. Client commands that reach the shell or the file
   system (`\!`, `\copy`, `source`) can't appear, because the statement is passed as data and
   the client's interactive commands are disabled. **Check first** the exact flags per client.
3. **The broker's check** is a tokenizer with a deny-list, and it refuses anything that is not
   one `SELECT`. It also refuses what a bare `SELECT` can still do: `INTO OUTFILE` and
   `INTO DUMPFILE`, `FOR UPDATE`, executable comments, stacked statements, and functions with
   side effects or file and network access (for example `pg_sleep`, `set_config`, `nextval`,
   `dblink`, `LOAD_FILE`). The list is per database kind and is tested.
4. A row cap and a byte cap are applied to the result by the broker.

### 2.7 How browser exploration is kept in

An agent-written Playwright script is agent code with a logged-in session. In the same launch
the agent may have seen database rows and logs, and may have read text planted in them. Without
limits that is a way to send data out. So:

- **The container's network reaches only the configured base URL** of the environment, through
  a proxy that refuses every other host. Today's exploratory QA runs on an internal network
  (unit 51). Staging needs this one opening and nothing wider.
- **Dedicated test accounts with low privileges**, named in config. Never a real user's or an
  admin's.
- **Production takes no script.** Only a committed journey, by name (§7.3).
- **No launch holds production-data tools and `ui_explore` together.** A launch that can read
  production logs or rows gets no browser, and the reverse.
- **Red-team cases** for each of these four, before the tool is usable on staging.

### 2.8 The decision on production data

Before the first production source is set up in a project, MIRAI asks you to confirm, with your
key, that data from the listed views and log sources may be sent to the model provider. The
confirmation names the sources and is recorded. Adding a source asks again. This gets a
decision record when P32 is specced.

## 3. The findings record (P33)

Decision PM-21. One record type for everything this stage produces.

- **Fields:** id, source (`debug`, `nightly`, `security`, `learn`), service, title, what was
  observed, the evidence (each item with where it came from: a file and line, a log line
  reference, a query and its row count, a screenshot), how sure the finding is and why,
  whether a tool confirmed it or only an agent judged it, a suggested next step, and its state.
- **States:** `draft` → `ticket` (you turned it into one) or `dismissed` (with a reason). A
  dismissed finding is remembered, so the same thing isn't raised again.
- **A finding is never a ticket by itself.** `mirai finding promote <id>` creates a bug or
  investigation ticket draft with the evidence attached. It then goes through ticket approval
  like any other.
- **Where they go:** the morning report, the notification channels as a `finding-drafted`
  event (`14`), and the hub's findings page (`15` H6). The notification carries the id, the
  source and the severity, and no title, because a title is written by an agent.
- **One home: your store.** A finding is a draft on your machine, and so is the memory of what
  you dismissed. It may hold evidence from production, so it is never committed by itself. When
  you promote it, the ticket carries the evidence you chose to keep. Sharing findings across a
  team is later (`09` §7).

## 4. `mirai debug` (P34)

Decision PM-17. An investigation run that never changes code.

- **Input:** a symptom or a question, in your words, plus anything you paste (an error, a
  ticket key, a URL). Optionally the service and the environment.
- **Two intents here:**
  - **diagnose:** something is broken and the cause is unknown;
  - **verify:** check that something behaves as intended.

  The third, understanding how something works, is `mirai learn` (§5).
- **Context the agent gets:** the business context (`business.md`), the conventions, the change
  records for the area when record search exists (`15` P23), and the evidence tools for the
  environments you allowed.
- **The hypothesis ledger.** The agent keeps a list. Each entry is a claim, the evidence for and
  against it with references, and a status: `open`, `confirmed`, `refuted`. It writes the
  ledger as it goes, so you can read where it stands.
- **It stops:**
  - when a hypothesis is confirmed with evidence;
  - **after three refuted hypotheses**, with a report of what was ruled out and what it would
    check next. It doesn't wander;
  - at its budget.
- **Supervised by default.** In your session it pauses after each hypothesis is settled and
  shows the ledger. You can redirect it. It can also run to the end unattended.
- **Output:** a findings record with the ledger. For a confirmed bug that a test can show, a
  **failing test** written on a branch, which proves the bug and becomes the red test of the
  bug ticket.
- **No fix.** The bug ticket carries the cause and the evidence, so Kai doesn't search again.
- **Prior art to vet first** (`research/06` gate): superpowers `systematic-debugging`, Addy
  Osmani's `debugging-and-error-recovery`, pstack's bug-fix and forensics skills, BMAD's
  investigate. None covers verify or learn without a defect, so MIRAI's skill takes their
  method for diagnosing and adds the rest.

The earlier decision D-39 deferred a "debugger agent". This unit is that agent, limited to
investigation. D-39 gets an update when the unit is specced.

## 5. `mirai learn` (`teach-me`) (P35)

Decision PM-34. It teaches the project to you or to a developer who joins.

- **Input:** a topic ("how does invoicing work", "what happens when a user is deactivated") and
  optionally how deep to go.
- **Sources:** the documents (PRD, HLD, ADRs), the code, the change records, the business
  context, and with your permission the evidence tools: the database schema, logs, and the
  interface through Playwright, with screenshots of the real screens.
- **What it explains:** the flow step by step through the real code and screens, the business
  rule behind each step, and **why it exists**, taken from the PRD, the ADRs and the change
  records. Where the reason isn't recorded anywhere, it says so and doesn't invent one.
- **Teaching mode:** it goes one step at a time at the learner's level and asks a few questions
  to check understanding before moving on. A plain mode gives the explanation in one piece.
- **Every statement cites its source**: a file and line, a document section, a record.
- **Output:** the session itself. On your command it saves the explanation as a document in
  the workspace repo, through the normal document path, so the next person doesn't start from
  zero. Nothing is saved to the repo without that command.
- **It never writes into `business.md` or a design document by itself.** A gap it finds (a rule
  in the code that no document mentions) is reported as a finding.

## 6. The database skill (P36)

Decision PM-19.

- **Reading:** it writes and runs `SELECT` statements through `db_query` to answer your
  question, and shows the statement with the result.
- **Writing, for a data fix:** it never runs the statement. It hands you a package:
  1. a `SELECT` that shows the rows before;
  2. the `INSERT`, `UPDATE` or `DELETE`, inside a transaction, with the expected row count
     stated;
  3. the same `SELECT` to check after;
  4. the statement that undoes it.

  On local and staging it can try the package against the test database first and report the
  result. **You run it on production yourself.**
- **Recreating a bug's case** (PM-22). For a bug whose data doesn't exist on staging or local,
  it finds the rows involved in production (read-only), and writes a seed that recreates the
  case elsewhere, with personal fields replaced by made-up values of the same shape. You review
  the seed before it is used.
- It knows the schema through `db_schema` and the project's conventions (soft deletes, tenant
  columns, audit columns), which setup records.
- **Not planned:** MIRAI running writes on production, and a full anonymised copy of production
  (`09` §6).

## 7. The nightly run

Decision PM-20. Two layers. Scripts detect, an agent diagnoses.

### 7.1 Nightly detect (P37), no model

- **Journeys.** A tagged subset of the Playwright tests (`@health`), built from the critical
  journeys MIRAI records at setup (unit 39), runs against **staging** by default, under the
  network limits of §2.7. A failure is retried
  once, with traces and screenshots kept. With the flaky list from the baseline, a known flaky
  test is reported as such.
- **Logs and metrics from the configured environment** (production if you configured it,
  read-only). A script computes what is **new or abnormal**:
  - error messages not seen in the last seven days, grouped by a normalised form (numbers and
    ids removed);
  - error rates that rose clearly above their usual range;
  - endpoints that became slower;
  - CPU or memory above their usual range.
- **The morning comparison** with the previous night: new failure, still failing, recovered.
- **A missed run is reported loudly.** If the run didn't start or didn't finish, the morning
  report and a notification say so. A silent miss looks like a green night.
- It runs at a set time, outside ticket runs, and its cost is logs and test minutes only.

### 7.2 Nightly diagnose (P38), an agent with a budget

- Takes the **top few** anomalies and new failures (proposed default: three), ranked by the
  script.
- For each, it runs the `mirai debug` method with the evidence tools: reads the log lines, the
  code and the database, and tries to reproduce the problem **on staging** with Playwright.
  Because of §2.7, reading production evidence and driving the staging browser are **two
  separate launches**: the first writes down what to try, as a short note the orchestrator
  checks for size and passes on, and the second reproduces it.
- **Exploratory testing of what changed.** It gets the list of yesterday's merges and tests
  those areas on staging the way a tester would, including the unhappy paths, with Ivy's
  mechanism. This covers ground without E2E tests for every scenario.
- **Output:** findings as drafts (§3), each sorted into "caused by a recent merge" (naming it),
  "environment" or "flaky", with how sure it is.
- **A fixed budget per night**, counted against the night cap (D-57). When ticket work and
  diagnosis compete, your queue wins unless you set otherwise.

### 7.3 Production

- **Reading** production logs and metrics for detection is the configured case and uses the
  production setup of §2.4.
- **Running journeys against production is off by default.** If you switch it on for a project:
  it is a setting you sign, only journeys marked safe for production run (they create no data,
  or only data marked as test data that the project already filters out), and every other
  journey is refused. The risk stays, which is why staging is the default.

## 8. The security audit (P39)

Decision PM-23. On demand (`mirai audit security`), with an optional schedule.

- **Scanners first, in containers pinned by digest, with no agent:**
  - code patterns (Semgrep's community edition);
  - leaked secrets in the repo and its history (gitleaks);
  - known-vulnerable dependencies (`composer audit`, `npm audit`, and an OSV-based scanner for
    other ecosystems).

  Each tool is vetted and pinned before use (`research/06` gate). **Check first** the licences
  and what each sends over the network: the containers run with no network except for the
  vulnerability database download, which is fetched separately.
- **Then one agent pass:**
  - removes duplicates across tools;
  - checks whether a reported path is reachable from an entry point;
  - reviews what scanners can't see, mainly **who is allowed to do what**: missing permission
    checks, access to another user's or tenant's records;
  - uses a short checklist taken from OWASP ASVS, not the whole standard.
- **Every finding is labelled** `tool-confirmed` or `agent-only`. From research, an audit by an
  agent alone is right about one time in six, so the label matters when you read the list.
- **Output:** findings as drafts (§3), sorted by severity, each with the file and line, the
  tool, and the suggested fix. A dependency update you accept becomes a normal ticket with
  system-facing criteria (`09` PM-07).
- **Scope now:** application code and dependencies.
- **Later, in this order:** the running interface (a passive scan of staging, never an active
  scan of production), the cloud setup (GCP, AWS), and git-host settings (branch protection, CI
  secrets, token scopes), which is optional and needs a read-only token.

## 9. Units

| # | Unit | Depends on | Why here | Done when |
|---|---|---|---|---|
| P31 | **Evidence source contract, logs:** the broker tools `logs_search` and `metrics_query`, the adapter interface, `[evidence]` config, Docker and file log adapters, caps in the broker, redaction, fencing, the call log | Review | The base of the stage | On the sample app: a log search returns capped, redacted lines; a log line with a planted instruction reaches the agent fenced; a search without a time window is refused; every call is logged without data |
| P31b | **Evidence: databases.** `db_query` and `db_schema` for MySQL and PostgreSQL, after checking how the broker connects with no driver; the read-only user, read-only transaction and timeout on the server; the client in a container with one statement; the tokenizer deny-list per database kind; masking of marked columns; row and byte caps | P31 | Database evidence has its own risks | On the sample app: each statement of a seeded attack list (`INTO OUTFILE`, `FOR UPDATE`, stacked statements, executable comments, side-effect functions, client shell commands) is refused by the broker; with the broker's check bypassed in a test, the database still refuses a write; a marked column comes back masked; a result over the cap is cut |
| P32 | **Staging and production adapters:** GCP and AWS log and metric adapters through your own CLI login, `mirai evidence setup` per environment with its checks (a write and a read outside the allow-list must be refused), the signed confirmation of §2.8 and its decision record, lower production caps, production red-team cases, server log files after checking how | P31, P31b | Real bugs live in production | On a personal cloud project: logs and a metric are read through a read-only role; setup refuses a database user that can write; a production source is unusable until its red-team cases pass and you have confirmed it with your key; a production query for a column outside the allow-list is refused by the database; no credential is readable by an agent (red-team case) |
| P33 | **Findings record and drafts:** the schema, registered with the file-format contract when that exists (`15` P18), states, `mirai finding list\|show\|promote\|dismiss`, remembered dismissals, the `finding-drafted` event when the event stream exists (`14` P14), the morning report section | P31 | Every later unit writes findings | A promoted finding becomes a ticket draft with its evidence and needs your ticket approval; a dismissed finding isn't raised again by the same source; the notification holds the id, source and severity and no agent-written text |
| P34 | **`mirai debug`:** the diagnose and verify intents, the context bundle, the hypothesis ledger, the three-refuted stop, pauses in the session, the findings record, the failing test on a branch, external debugging skills vetted first, D-39 updated | P31, P31b, P33 (and P23 when built) | Your most-requested capability | On the sample app with a seeded bug: the run confirms the cause with cited evidence and writes a failing test that passes once the bug is fixed by hand; with a seeded false trail it stops after three refuted hypotheses and reports; it changes no file outside the new test; a verify run on correct behaviour reports "as intended" with evidence |
| P35 | **`mirai learn` (`teach-me`):** the topic input, the sources, step-by-step explanation with business reasons and citations, "no recorded reason" where none exists, teaching mode with check questions, the explanation saved as a document on your command, `ui_explore` on local and staging under §2.7 with its red-team cases | P31, P31b | Understanding the product, and onboarding | For a seeded feature with a PRD and an ADR: the explanation follows the real flow, each step cites a file or document, the business reason comes from the PRD, and a step with no recorded reason is marked as such; in teaching mode it waits for an answer before continuing; a browser script that tries to reach a host other than the base URL is blocked (red-team case); nothing is written to the repo without your command |
| P36 | **The database skill:** answering with shown `SELECT`s, the four-part data-fix package, the trial on local or staging, the case-recreation seed with replaced personal fields, project conventions from setup | P31b | Database work is part of most debugging | A data-fix request returns the package and runs no write (the database log shows only `SELECT`s); the package applied by hand on the test database changes the stated row count and the undo restores it; a recreated case reproduces a seeded bug locally and contains no original personal value |
| P37 | **Nightly detect:** the `@health` journeys on staging with one retry and traces, the anomaly scripts over logs and metrics, the comparison with the previous night, the loud missed-run report (a `run-missed` event), the schedule | P32, P33, MVP units 39 and 51 | Problems found before you build on them | With a seeded regression, the morning report shows a new failure with its trace; a new error message in the logs is listed once in normalised form; a recovered failure is shown as recovered; a run that was prevented from starting produces a notification and a report line |
| P38 | **Nightly diagnose and exploratory testing:** the top-few selection, the debug method per item, reproduction on staging, exploratory testing of yesterday's merges, sorting by cause, the two-launch split of §7.2, the per-night budget, production journeys by committed name behind the signed setting | P34, P35, P37 | Beyond what E2E tests cover | A seeded anomaly caused by a seeded merge is diagnosed with that merge named; an unhappy-path defect in a merged feature is found by exploration and reported as a draft; the run stops at its budget; no single launch held production-data tools and a browser (from the log); a journey not marked safe, and any script, is refused against production |
| P39 | **Security audit: code and dependencies** (`mirai audit security`): pinned scanner containers, the agent triage pass with the short checklist, `tool-confirmed` and `agent-only` labels, findings as drafts, the optional schedule | P33 | Your main security worry | On a sample app with a seeded vulnerable dependency, a planted secret and a missing permission check: the first two are `tool-confirmed`, the third is found and labelled `agent-only`; duplicates across tools appear once; the scanners ran with no network; nothing was changed in the repo |
