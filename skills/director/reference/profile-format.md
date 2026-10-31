# Repo profile format

A repo may have `.claude/director.md`, written by hand or by the director with the user's yes. It
tells the director what is special about this repo. Without it the director uses the global
departments and generic roles only, and never spends money or starts a service without asking.

Five sections, all optional, in this order:

- **Departments**: the repo's skills that run their own loop, and how to launch each.
- **Roles**: the repo's agents (`.claude/agents/*.md`) and when to pick them. A repo role beats a
  generic one for the same job.
- **Dials**: what must run one at a time, quotas, cost gates, what to ask before.
- **State**: where the repo already keeps state (tickets, run logs); request files link there.
- **Checks**: a checklist per kind of work, which `director-checker` is given.

The profile may also hold a line recording the answer to the one-time `.gitignore` question, for
example `Request files: .claude/director/ is git-ignored (asked 2026-10-27)`.

## Example (made up)

```markdown
# Director profile: bakery-app

## Departments
- `/release-notes <version>`: writes the changelog and the store text. Run as a background
  subagent. Returns `releases/<version>.md`.
- `/migrate-db <ticket>`: runs a schema migration on the staging database. Run as a session,
  never unattended.

## Roles
- `bakery-copy` (standard): shop copy and product descriptions in the shop's voice. Pick it for
  any text a customer reads.
- `bakery-tester` (standard): runs the Playwright suite and reports failures with the trace path.

## Dials
- One `/migrate-db` at a time; never in parallel with a deploy.
- The staging database and the paid image API cost money: ask before the first use in a session.
- At most three subagents at once; the test machine has 8 GB of RAM.
- Ask before touching `infra/`.

## State
- Tickets: `.claude/tickets/<ticket>/plan.md`.
- Release runs: `releases/<version>.md`.
- Request files link to both.

## Checks
- Code change: `pnpm lint` and `pnpm test` pass; the diff touches only the files named in the plan.
- Shop text: no price or opening time that is not in `data/shop.json`; reads in the shop's voice.
- Release: the changelog lists every merged PR since the last tag.

Request files: .claude/director/ is git-ignored (asked 2026-10-27).
```
