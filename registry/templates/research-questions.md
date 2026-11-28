---
id: initiative-research-questions
type: research-questions
template: research-questions@v1
owner: you
created: "2026-01-01"
initiative: initiative
---
<!--
The design questions template (MIRAI, unit 65b). You and the architect write it in your session
(/mirai design --explore <initiative>); you approve the list there, and MIRAI's research run answers
exactly these questions in research.md.
- Where it lives: docs/mirai/<initiative>/research-questions.md, beside the PRD.
- Stack summary: what the research needs to know of the project, in a few lines (the language and
  framework with versions, the database, how it's deployed). The research run sees this and the PRD,
  nothing else of your project: write nothing here you wouldn't show a web page.
- Questions: one "### Q-n: <the question>" each, numbered from 1, with "Why it matters:" in a line.
  Ask only what the design must decide and the web can inform: choices between approaches,
  libraries, limits. Not your private code (the architect reads it), not product questions.
-->
# Design questions: the initiative

## Stack summary

Laravel 11 on PHP 8.3, MySQL 8, Redis; deployed on one VM with Supervisor.

## Questions

### Q-1: A background job or a synchronous import for CSV files of up to 200 MB?

Why it matters: it decides the queue, the progress screen and the timeout limits.
