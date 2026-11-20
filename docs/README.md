# MIRAI's docs

One line per page. A new page gets its line here; the docs check (`test/docs/coverage.test.js`)
fails until it has one.

## Start here

- [install.md](install.md): install MIRAI, set up a repo with `mirai init`, see the version and the help.
- [config.md](config.md): every config key, who may set it, its default and what it does.
- [run.md](run.md): take a ticket to its merge request with `mirai run`, `mirai resume` and `mirai show`.
- [doctor.md](doctor.md): check a repo's MIRAI setup with `mirai doctor`, and repair what's safe.

## Documents and tickets

- [documents.md](documents.md): the document types, the summary for approval, the lint and the reader test.
- [agents.md](agents.md): agents, roles, the plan and build steps, fix rounds, MIRAI's commits and `/mirai` in your session.
- [model-tiers.md](model-tiers.md): which model runs each step, and how to change it.
- [loop-rules.md](loop-rules.md): rounds, findings, budgets, your usage caps and parking.
- [tdd.md](tdd.md): how MIRAI proves a test was written first.

## Tests

- [setup-detection.md](setup-detection.md): `mirai detect` and the draft config it writes.
- [test-adapters.md](test-adapters.md): how MIRAI runs one test runner, and how to add one.
- [test-baseline.md](test-baseline.md): `mirai baseline` and the tests that already failed.

## Review, ship and merge

- [pre-push.md](pre-push.md): the check git runs before every push.
- [ship.md](ship.md): `mirai ship`, which pushes the branch and opens the merge request.
- [review-mr.md](review-mr.md): `mirai review-mr` and `mirai merge`.
- [report.md](report.md): `mirai report`, the M1 acceptance rate and `mirai feedback`.

## Safety and trust

- [agent-safety.md](agent-safety.md): what keeps agents in check, your own sessions, MIRAI's git and the login token.
- [signing.md](signing.md): your signing key, what it signs and how long it stays unlocked.
- [red-team.md](red-team.md): `mirai redteam`, which tests the safety rules again on your machine.

## Building MIRAI itself

- [build-runner.md](build-runner.md): the runner that runs MIRAI's own tests and probes while you're away.
- [ci.md](ci.md): MIRAI's CI on GitHub.
- [releasing.md](releasing.md): cutting a release tag.
- [internal-list.toml](internal-list.toml): the few things docs/ leaves out on purpose, each with its reason.
