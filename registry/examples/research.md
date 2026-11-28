---
id: csv-import-research
type: research
template: research@v1
owner: arlo
created: "2026-11-28"
initiative: csv-import
questions: research-questions.md
---
# Research: CSV import

## Answers

### Q-1: Should a 200 MB CSV import run as a queued job or inside the upload request?

- **Option A:** a queued job, reading the file in chunks. [S-1]
- **Option B:** the import inside the upload request. [S-3]
- **Pick:** A, because a 200 MB file takes longer than a request may run. [S-1] [S-3]
- **Runner-up:** B, when files stay small enough to finish within the request. [S-3]
- **Against the pick:** a queue needs a running worker and a way to show progress. [S-1]

### Q-2: Which library reads a large CSV in PHP without loading it into memory?

- **Option A:** League CSV, which reads records as an iterator. [S-2]
- **Option B:** PHP's own fgetcsv, line by line. [S-4]
- **Pick:** A, because it streams and handles encodings and headers for us. [S-2]
- **Runner-up:** B, when no dependency may be added. [S-4]
- **Against the pick:** one more dependency to keep up to date. [S-2]

## Sources

- **S-1:** [Queues - Laravel 11.x](https://laravel.com/docs/11.x/queues) — accessed 2026-11-28 — "time consuming tasks"
- **S-2:** [League CSV: Reader](https://csv.thephpleague.com/9.0/reader/) — accessed 2026-11-28 — "The Reader class extends the general connections capabilities"
- **S-3:** [max_execution_time](https://www.php.net/manual/en/info.configuration.php) — accessed 2026-11-28 — "maximum time in seconds a script is allowed to run"
- **S-4:** [fgetcsv](https://www.php.net/manual/en/function.fgetcsv.php) — accessed 2026-11-28 — "Gets line from file pointer and parse for CSV fields"

## Sources consulted

- https://example-blog.dev/csv-tips: a 2016 post, older than PHP 8.

## Suspicious pages

None.
