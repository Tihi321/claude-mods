# Request file format

One file per request, in the repo being worked on: `.claude/director/requests/REQ-<nnnn>-<slug>.md`
(`<nnnn>` is the next free four-digit number, `<slug>` a few kebab-case words). Only
`director-scribe` writes these files. The director never commits them (see the director's
`.gitignore` rule).

```markdown
---
id: REQ-0007
title: <short>
status: open | in-progress | waiting-on-user | done | dropped
created: 2026-10-27
updated: 2026-10-27
links: [.claude/tickets/X/, runs/<slug>.md]
---
## Request
<word for word>

## Pieces
| # | piece | role / department | tier | agent or session id | status |
|---|---|---|---|---|---|

## Log
- 2026-10-27 14:02 opened

## Outcome
```

## Statuses

| Status | Meaning |
|---|---|
| `open` | written down, no piece started |
| `in-progress` | at least one piece is running or waiting to start |
| `waiting-on-user` | a decision, approval or a play-through is the user's |
| `done` | all pieces finished and checked; the Outcome says what was and was not verified |
| `dropped` | the user no longer wants it; the Log says when and why |

A piece's status in the Pieces table uses: `todo`, `running`, `done`, `failed`, `dropped`.

## Rules

- The Request section is the user's words, unedited. Corrections made later go in the Log, not
  over the original.
- `links:` points to the repo's own state (ticket folders, run logs, factory jobs, branches)
  instead of copying it. Paths use forward slashes (`C:/...` when absolute).
- Pieces: one row per piece; the `agent or session id` column holds the subagent id or session id
  to `SendMessage`, or `-` before a piece starts.
- Log: one line per event, `- YYYY-MM-DD HH:MM <what>`, oldest first, never rewritten. Steering
  changes, role proposals and the user's answers (for example the `.gitignore` question) go here.
- Outcome: empty until the request closes, then the result, the date, and what was not verified.
