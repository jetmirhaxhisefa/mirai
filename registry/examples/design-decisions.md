---
id: csv-import-design-decisions
type: design-decisions
template: design-decisions@v1
owner: jet
created: "2026-11-28"
initiative: csv-import
research: research.md
---
# Design decisions: CSV import

## Decisions

### Q-1: Should a 200 MB CSV import run as a queued job or inside the upload request?

- **Options:** A: a queued job, reading in chunks [S-1]; B: inside the upload request [S-3]
- **Pick:** A
- **Reason:** our largest customer files are 150 MB, and uploads already time out at 60 s.
- **Hard to reverse:** yes

### Q-2: Which library reads a large CSV in PHP without loading it into memory?

- **Options:** A: League CSV [S-2]; B: fgetcsv [S-4]
- **Pick:** (Arlo's call)
- **Hard to reverse:** no

## Log

- 2026-11-28 Q-1: A, the largest files are 150 MB and uploads time out at 60 s.
- 2026-11-28 Q-2: your call, Arlo.
