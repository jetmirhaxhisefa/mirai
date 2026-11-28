---
id: csv-import-research-questions
type: research-questions
template: research-questions@v1
owner: jet
created: "2026-11-28"
initiative: csv-import
---
# Design questions: CSV import

## Stack summary

Laravel 11 on PHP 8.3 with MySQL 8 and Redis; one VM, workers under Supervisor; a React front end.

## Questions

### Q-1: Should a 200 MB CSV import run as a queued job or inside the upload request?

Why it matters: it sets the timeouts, whether we need a worker, and how the user sees progress.

### Q-2: Which library reads a large CSV in PHP without loading it into memory?

Why it matters: the import must stay under the worker's 512 MB memory limit.
