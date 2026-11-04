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

Writers: planner (`draft`), director-scribe (`approved` on the user's yes; edits only this block),
implement (`in-progress` + branch at branch cut, `blocked`, `done` at changelog).

## 2. attention.md

One `## A-<nnn> <what, one line>` heading per item, then `- key: value` lines:

```markdown
## A-001 Pick the auth provider
- status: open
- asked: 2026-11-04 14:02
- by: director-scribe
- why: two providers fit; the choice changes the schema
- options:
  - Provider A
  - Provider B
- recommendation: Provider A
- default: Provider A is used after the next planning pass
- answer:
```

Keys: `status: open|answered|withdrawn`, `asked: YYYY-MM-DD HH:MM`, `by: <actor>`, `why:`,
`options:` (nested `  - ` lines), `recommendation:`, `default:` (what happens with no answer),
`answer:` (empty until answered; then the user's words and date). Items are never deleted;
answering sets `status: answered`. Writers: director-scribe, implement orchestrator.

## 3. events.jsonl

Append-only, one JSON object per line, UTF-8, never rewrite earlier lines:

```json
{"ts":"2026-11-04T14:02:11Z","actor":"director-scribe","type":"plan.approved","request":"REQ-0007","ticket":"HUB-09-x","detail":"user approved the plan"}
```

Required: `ts` (UTC ISO), `actor` (skill or agent name, or `user`), `type`, `ticket`, `detail`.
`request` may be null; optional `data` object. Types: `plan.created`, `plan.approved`,
`implement.started`, `slice.started`, `slice.done`, `slice.failed`, `verify.passed`,
`verify.failed`, `attention.opened`, `attention.answered`, `checker.verdict`, `changelog.written`,
`ticket.done`, `ticket.dropped`, `note`. Unknown types are kept and shown. One writer per ticket
at a time (the orchestrator, or director-scribe for director events).

## 4. discoveries.md

Out-of-scope defects or oddities found while working (not ideas; ideas stay under `Extra ideas`):

```markdown
- 2026-11-04 implementer: retry loop never exits on 401 (src/api.js:88) - suggested: add a max count
```

Format: `- YYYY-MM-DD <actor>: <finding> (<path:line>) - suggested: <action>`. Never acted on
without the user. Writers: the implement orchestrator for work run through `implement`; director-scribe only for
workers the director runs directly (roles), never re-copying a department's discoveries. The dashboard shows the count.

## 5. Stale rule and read-only promise

The dashboard only reads these files and never writes them. A request is stale when `open` or
`in-progress` and idle longer than `staleDays`, or `waiting-on-user` longer than `staleDays`; a
ticket is "abandoned?" when not `done` or `dropped` and idle longer than `abandonDays`. Details in
the canonical doc.
