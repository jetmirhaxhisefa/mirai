# Credits

`mirai-interview` is MIRAI's own text. Its method was written in MIRAI's words after reading the
two sources below once, on 2026-11-20 (unit 35, decision 2; D-27, D-31). None of their text is
copied. MIRAI keeps no copy of either and doesn't track their changes.

## addyosmani/agent-skills: `interview-me`

- https://github.com/addyosmani/agent-skills, file `skills/interview-me/SKILL.md`, read at commit
  `8c99fa36d90068c82d547f7c12a9d67a3e95f4ee` (the `main` branch on 2026-11-20), by Addy Osmani.
- What MIRAI took:
  - one question at a time, each with the agent's guess and its reason;
  - a first guess in one sentence, with a confidence number and what's still missing;
  - the "want against should-want" probe: "if you didn't have to justify this to anyone, what
    would you want?";
  - the 95% test: stop when you can predict the reactions to the next three questions;
  - the stuck check: no rise in confidence over several questions means step back and ask;
  - the restatement (outcome, user, why now, success, constraint, out of scope), where MIRAI
    names the last two "Limits" and "Not included";
  - the explicit yes: "sounds good" and "whatever you think" are not one;
  - when not to interview: a clear request, a pure question, a mechanical change.
- What MIRAI changed: in a non-interactive run the source flags a blocker; MIRAI writes the
  questions into `interview.md` and parks (decision 5). The source keeps the intent only if the
  user asks; MIRAI always keeps the record, written after each answer (decisions 3 and 4).
- License: MIT. Its notice:

```text
MIT License

Copyright (c) 2025 Addy Osmani

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## mattpocock/skills: `grilling`

- https://github.com/mattpocock/skills, file `skills/productivity/grilling/SKILL.md`, read at
  commit `abeeaf95660ba9e8b7c753eb38f441ca707a8823` (the `main` branch on 2026-11-20; the file
  last changed in `7739eaed7f8f3915437a8def198a6d0d7206dbc7`), by Matt Pocock. The spec calls
  it `productivity/grilling`; it lives under `skills/` in the repo.
- What MIRAI took (decision 1):
  - finding facts is the agent's job, never the owner's: look them up, and ask only decisions;
  - each question with its choices and the agent's recommended answer, so a short reply ("B",
    "yes") is enough;
  - nothing is acted on until the owner confirms the shared understanding.
- What MIRAI left out: rounds of several questions at once (the "frontier"). MIRAI asks one
  question at a time, because an answer often changes the next question.
- License: MIT. Its notice:

```text
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

