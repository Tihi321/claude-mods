# Ticket state files (write side)

Short copy for writers. Canonical: `docs/conventions.md` in the software-factory repo
(`C:/projects/Personal/software-factory`); if the two differ, that doc wins.

All live in the ticket folder `.claude/tickets/<ticket>/` (or `.codex/tickets/<ticket>/`). Every
file is optional; readers cope with its absence. Old files without these keep working.

## 1. plan.md front matter

First lines, `---` fenced, flat keys only:

```markdown
---
status: draft
request: REQ-0007
repos: [software-factory, claude-mods]
branch: none
updated: 2026-11-04
---
```

- `status: draft|approved|in-progress|blocked|done|dropped`
- `request: REQ-nnnn` (same repo) or `<repo-folder>/REQ-nnnn` (other repo) or `none`
- `repos: [<folder>, ...]`
- `branch: <name>|none`
- `updated: YYYY-MM-DD`

Every write to the front matter block sets `updated` to today's local date. Write the front matter
first, then append the matching event.

Writers: the planner (`draft`), director-scribe (`approved` on the user's yes; `done` after a PASS
checker verdict (or on the user's word after a 2nd re-check FAIL); `dropped` on the user's word; edits only this block), implement (`in-progress` plus `branch` at branch
cut, `blocked`; `done` at changelog only when `request` is `none`). A `request` that is a REQ id marks
the ticket director-managed: implement stays `in-progress` after `changelog.written`, appends no
`ticket.done`, and the director closes it.

## 2. attention.md

One `## A-<nnn> <what, one line>` heading per item, then `- key: value` lines:

```markdown
## A-001 Pick the auth provider
- status: open
- asked: 2026-11-04 14:02
- by: implement
- why: two providers fit; the choice changes the schema
- options:
  - Provider A
  - Provider B
- recommendation: Provider A
- default: Provider A is used after the next planning pass
- answer:
```

Keys: `status: open|answered|withdrawn`, `asked: YYYY-MM-DD HH:MM` (local time), `by: <actor>` (the actor that asks, not necessarily the one that writes the item), `why:`,
`options:` (nested `  - ` lines), `recommendation:`, `default:` (what happens with no answer),
`answer:` (empty until answered; then the user's words and date, local time). Items are never deleted;
answering sets `status: answered`. Writers: director-scribe, implement orchestrator.

## 3. events.jsonl

Append-only, one JSON object per line, UTF-8. Each event is one line; several lines may be appended
in one write when they happened together; never rewrite or reorder earlier lines:

```json
{"ts":"2026-11-04T14:02:11Z","actor":"director-scribe","type":"plan.approved","request":"REQ-0007","ticket":"HUB-09-x","detail":"user approved the plan"}
```

Required: `ts`, `actor`, `type`, `ticket`, `detail`. `request` may be null; optional `data` object.

- `ts` is when the event happened (UTC ISO). Append each event when it happens, not in a batch at
  the end. A writer without a clock uses the time its brief gives.
- `actor`: `planner`, `director`, `director-scribe`, `implement`, `implementer`, `director-checker` or
  `user`.
- `detail`: one line, at most ~80 characters; counts and lists go in `data`.
- A slice is one child launch; list the plan tasks it covers in `data.tasks`, e.g.
  `["T1","T2"]`.
- Date-times in `attention.md` (`asked`, `answer`) are local time; event `ts` is UTC.

Types and their writer (unknown types are kept and shown):

| type | writer | when |
|---|---|---|
| `plan.created` | director-scribe | after the planner returns the plan |
| `plan.approved` | director-scribe | on the user's yes |
| `implement.started` | implement | at branch cut |
| `slice.started` | implement | when a child is launched |
| `slice.done` | implement | when the child reports success |
| `slice.failed` | implement | when the child reports failure |
| `verify.passed` | implement | when verification finishes and passes |
| `verify.failed` | implement | when verification finishes and fails |
| `attention.opened` | the writer of the item: implement for its own, else director-scribe | when the item is added |
| `attention.answered` | whoever relays the answer (director-scribe under a director, implement standalone) | when the answer is recorded |
| `checker.verdict` | director-scribe | after director-checker returns |
| `changelog.written` | implement | when `changelog.md` is written |
| `ticket.done` | director-scribe under a director; implement standalone | on done (see `status` writers) |
| `ticket.dropped` | director-scribe | on the user's word |
| `note` | the current owner | any time |

Handover: the scribe writes until `plan.approved`; implement owns the ticket from
`implement.started` until `changelog.written` or `blocked`; then the scribe again. On resume
after `blocked`, the scribe records the answer (`attention.answered`), then implement sets
`in-progress` and owns the ticket until `changelog.written`. Exactly one writer per ticket at a
time: while implement owns the ticket the scribe writes none of its state files; a director
attention item or a drop in that window waits until implement hands back (or the director stops
implement first). `blocked` is written by implement: front matter `status: blocked` first, then
`attention.opened`.

## 4. discoveries.md

Out-of-scope defects or oddities found while working (not ideas; ideas stay under `Extra ideas`):

```markdown
- 2026-11-04 implementer: retry loop never exits on 401 (src/api.js:88) - suggested: add a max count
```

Format: `- YYYY-MM-DD <actor>: <finding> (<path>[:line]) - suggested: <action>` (one parenthesised group
only). Never acted on
without the user. Writers: the implement orchestrator for work run through `implement`; director-scribe only for
workers the director runs directly (roles), never re-copying a department's discoveries. The dashboard shows the count.

## 5. Stale rule and read-only promise

The dashboard only reads these files and never writes them. A request is stale when `open` or
`in-progress` and idle longer than `staleDays`, or `waiting-on-user` longer than `staleDays`; a
ticket is "abandoned?" when not `done` or `dropped` and idle longer than `abandonDays`. Details in
the canonical doc.
