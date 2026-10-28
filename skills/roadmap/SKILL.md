---
name: roadmap
description: Implement a repo's open ROADMAP.md items as tickets - one ticket per item, all on one branch, one commit per ticket, each reviewed and verified before it is committed, ending with a DONE / NOT DONE / UNTESTED table. Use for "/roadmap", "implement the roadmap", "turn the roadmap into tickets", "do the next roadmap items".
---

# Roadmap

Turn the open items of a repo's roadmap into tickets and ship them on one branch, one commit per
ticket. Arguments, all optional: which items (`/roadmap 3-5`, `/roadmap "lyrics panel"`), a ticket
prefix (`--prefix SPD`), a branch name, `--push`.

## 1. Read the roadmap and the repo

1. Find the roadmap: `ROADMAP.md` at the repo root, else `docs/ROADMAP.md`, else ask. Also read
   `CLAUDE.md`/`AGENTS.md`, the README and `.github/workflows` (the exact commands CI runs).
2. List the open items (unchecked boxes, or items not marked done). If the user named items, take
   only those; otherwise take every open item in roadmap order.
3. Find the ticket prefix and the next number: from `--prefix`, else from existing ticket folders
   in `.claude/tickets/`, branch names and commit subjects (`git log --oneline -200`). Take the
   highest existing number for that prefix and count on from it, so no id clashes with an old one.
   With no prefix anywhere, ask once.
4. Find the verify commands: test, typecheck, lint, build, from `package.json` scripts, the CI
   workflow or the README. Node is managed by fnm: if `node` is not on PATH, run each command as
   `fnm exec --using default <command>`.

## 2. Confirm the scope, once

Before writing any code, post one short message and wait for the OK:

- the tickets: `<PREFIX>-<NN>  <item>`, one line each, with what "done" means for it (the
  observable result, e.g. "reads aloud live like Supertonic", not "engine added")
- the branch: `<PREFIX>-<first>-<last>_roadmap` from the default branch, unless the user named one
  or the current branch already belongs to these tickets
- the verify commands, and which items can only be checked in the real app or device

Items whose wording allows a narrow and a full reading are where earlier runs went wrong: say
which reading you will build. Skip this step only when the user said to go ahead without asking.

## 3. Plan each ticket

For each ticket write `.claude/tickets/<PREFIX>-<NN>-<slug>/plan.md`: goal, files, steps, and
**acceptance criteria that can be checked** (real values, not "works": the real song duration,
the right port, text readable at its real size). Never write into another ticket's folder.

## 4. Implement

Hand the tickets to the global `implement` skill, one ticket at a time, passing the plan path and
the branch from step 2 as an explicit instruction (so it does not cut a branch per ticket).
Tickets that touch disjoint files may run as parallel implementers; tickets that share files run
in order.

## 5. Gate each ticket before its commit

A ticket is committed only after all of these:

1. A checker (`director-checker` agent, fresh context) reviews the ticket's diff against its
   acceptance criteria and returns PASS or FAIL per criterion. FAIL goes back to the implementer,
   up to 3 rounds; after that the ticket is NOT DONE with the reason.
2. The verify commands pass. Run the CI commands as CI runs them; if the ticket changes a
   lockfile or the package manager, update the CI workflow in the same commit.
3. Where the feature can be run (a CLI, an endpoint, a page, an app), run it once end to end and
   note what you saw. What cannot be run here is UNTESTED, never DONE.

Then commit: subject `<PREFIX>-<NN>: <what changed>`, a blank line, a body. Write the message with
a Bash heredoc (`git commit -F - <<'EOF'`), not PowerShell. Tick the item in the roadmap in the
same commit (`- [x] ... (<PREFIX>-<NN>)`).

## 6. Finish

- Push only with `--push` or when the user asked to; never force-push.
- End with this table, every requested item on it, and nothing implied beyond it:

| Ticket | Item | Status | Verified by | Left open |
|---|---|---|---|---|
| SPD-07 | Playlist panel | DONE | tests 41/41, opened in the app | - |
| SPD-08 | Echo Show sign-in | UNTESTED | tests pass | not run on the device |
| SPD-09 | Offline cache | NOT DONE | - | checker FAIL x3: cache never evicts |

Status is DONE (gate passed and run where it can be), UNTESTED (gate passed, not run in the real
app or device), or NOT DONE (with the reason). Then the branch, the commit list, and whether it
was pushed.
