# Director mode (global)

Status: phases 0 to 3 implemented and installed on this machine 2026-10-26 (uncommitted);
phase 4 (optional) not started. Results: "Acceptance (orchestrator)" at the end, and
`changelog.md`.
Ticket: none (`NO-TASK`), folder `director-mode`.
Branch: `director-mode` in `claude-mods`, from `master` at `e252e0f` (equal to `origin/master`).
The user's uncommitted `README.md` and `settings-hooks/*` edits stay in the working tree as they
were; they are not staged or changed.

Decisions (user, 2026-10-26: "use the recommended answers"): 1 copy by `install.js`; 2 opt-in
`/director`; 3 the director never commits request files and asks once per repo about
`.gitignore`; 4 `director-scribe` does the request-file updates.

Layout decided at implementation (matches the repo's existing `skills/replay-ticket/`): the skill
is `skills/director/`, the roles are `agents/director-*.md`, both at the repo root. `install.js`
gets a `--skills-only` flag that copies only the skills and agents, so installing the director
does not copy `settings-hooks/` (which holds the user's uncommitted edits) or rewrite
`settings.json`.

Sources: the three transcripts in `Downloads\Factory\` ("How the Pros Actually Work With AI Now",
"Work Like the Pros: AI Agent Teams, Explained", "Using Jev In Your Agent Harness") and the
earlier `Downloads\Factory\plan.md`. That plan was written for the Pixotope work repo (one repo,
gitignored `.claude/`, `/factory` as the build department). This plan replaces it with a global
version that works in every repo on both machines.

## Goal

A main session you talk to as a **director** (🎬), in any repo. It understands the request,
splits it, hands each piece to a **role** (subagent) or a **department** (a skill that runs its
own loop, usually in its own session), picks the model tier per piece, keeps a **request file**
per request, reports status, and steers work in flight. It does as little of the work itself as
it can.

Global means: the director skill, the generic roles, the tier map and the file formats are
installed once for the user. A repo adds only its state (request files) and, when it wants, a
**profile** that names its own departments, roles and limits.

## Where it lives

- **Source: this repo (`claude-mods`).** It is in git, and `install.js` already puts skills,
  hooks and plugins into `~/.claude` on both machines. `~/.claude` itself is not under git.
- **Installed into `~/.claude` by `install.js`**, which copies the skill to
  `~/.claude/skills/director/` and the roles to `~/.claude/agents/`, the way it already copies
  `skills/replay-ticket`. A plugin would be called `/director:director` (plugin skills are always
  `/<plugin>:<skill>`, per the Claude Code plugin docs), so the copy is the default (open
  question 1).
- **Not in `~/.claude/CLAUDE.md`.** Every subagent reads CLAUDE.md, which would turn every worker
  into a director, and it would make every session a director whether wanted or not.

## Non-goals

- No repo profiles in this ticket. The creative hub and the Pixotope repos each get their own
  ticket in their own repo later, only when the user asks.
- No change to the existing global skills and agents (`implement`, `factory`, `replay-ticket`,
  `handoff`, `resume-handoff`, `implementer`, `factory-*`). The director uses them as they are.
- No Jev or other external decision model, and no custom harness (see **Jev** at the end).
- Never touch the user's uncommitted changes in this repo (`README.md`, `settings-hooks/*` at
  the time of writing). Commit only the director's own files.

## Design

### Concepts → primitives

| Concept (videos) | Primitive | Notes |
|---|---|---|
| Director / producer | `/director` skill, opt-in per session | Loaded only in the session that runs it, so subagents never inherit it |
| Role | Agent file (`agents/director-*.md` globally, `.claude/agents/*.md` per repo) | One file = scope, rules, self-check, output |
| Department (sub-director) | A skill with its own loop (`implement`, `factory`, `replay-ticket`, a repo skill), run in its own session or as a background subagent | Subagents can start subagents up to three levels below the main session (Claude Code docs), so a department can be a subagent; a session is used when the user should see or steer it directly |
| Checks (evals) | A **Self-check** section in every role, plus `director-checker` for the whole result | Departments keep their own reviewers |
| State | `.claude/director/requests/REQ-<nnnn>-<slug>.md` per repo, written by `director-scribe` | Links to the repo's own state (tickets, run logs) instead of copying it |
| Model dial | Tier label per role (`light` / `standard` / `deep`) → `haiku` / `sonnet` / `opus` | Tier labels keep the roles portable; the model is set only where the harness allows it |
| Limits (dials) | `## Dials` in the repo profile | Concurrency, quotas, cost gates, "ask before" rules |
| Steering in flight | `SendMessage` to a running subagent or session | |
| Self-learning | The director proposes a new role after the third repeat of the same kind of piece; creates it only after the user says yes | Generic roles go into this repo, repo-specific ones into the repo |

### Constraints found while checking

- **Two harnesses.** The global `implement` and `factory` skills say that in "this harness" a role
  file is not an agent type and per-child model choice is off. Claude Code has both (agent types
  and the Agent tool's `model`). So every brief the director writes starts with "read your role
  file first" (works everywhere), and it uses `subagent_type` and `model` only where they exist.
  The tier is written in the request file either way.
- **Where a department runs.** Per the Claude Code docs, a subagent may start its own subagents
  down to three levels below the main session (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` changes
  that; `1` turns it off). So a department can run as a background subagent: director → department
  (level 1) → its workers (level 2). For long or user-facing work (a production, a factory job) the
  director starts a session instead, in the Claude desktop app with `start_session`; in a plain
  CLI it gives the user the one-line prompt to start one. If nesting is off, departments always
  go to sessions.
- **What subagents see.** Subagents load the repo's CLAUDE.md (except Explore and Plan) but not
  skills invoked in the main session, so `/director` stays in the director's own session. Roles
  with no `tools:` field also get the session's MCP tools.
- **No timer.** The director reports on every completion notification, on `/director status`, and
  when asked. A `/loop` heartbeat is a phase 4 experiment.
- **Hooks already in use.** `~/.claude/settings.json` has Edit/Write, Bash and Stop/SubagentStop
  hooks (lint-changed and the plugin mods). Phase 1 adds no hook.
- **Windows.** Paths in request files use `C:/...` with forward slashes, as the factory does.
- **Global instructions win.** Plans still go to `.claude/tickets/<ticket>/plan.md`, temp files to
  `.claude/temp/`, and implementation of a plan still goes through the `implement` skill.

### File layout

In this repo (exact folder set by phase 0's packaging choice):

```
director/                               copied by install.js into ~/.claude
  skills/director/
    SKILL.md                            the director: identity, rules, routing loop, commands
    reference/
      tiers.md                          light/standard/deep → haiku/sonnet/opus, when to use each
      departments.md                    the global departments: when to pick, how to launch, what comes back
      request-format.md                 the request file format and statuses
      profile-format.md                 the per-repo profile format, with an example
  agents/
    director-scribe.md                  light: creates and updates request files
    director-scout.md                   light: read-only lookups and output triage
    director-checker.md                 standard: checks a finished result against the request
README.md                               a section on the director (in this repo's README)
```

Per repo, created on first use:

```
.claude/director/requests/REQ-0001-<slug>.md
.claude/director.md                     optional profile, written by hand or by the director with the user's yes
```

The `director-` prefix keeps the global roles from clashing with a repo's own agents.

### `/director` skill

Frontmatter: `name: director`; the description triggers on `/director`, `/director status`,
`/director roles`, `/director resume`, "be my director".

1. **Identity.** Every message starts with 🎬. A partner: curious, opinionated about the problem,
   and it does not do the work.
2. **What it may do itself.** Talk, ask, decide; read a handful of files to route well; read
   request files, profiles and results; verify results. Editing code, broad searches, running
   test suites, writing docs and running long tool loops go to a role or a department.
3. **Start of a session.** Read the repo's `CLAUDE.md`, `.claude/director.md` if present, the
   open request files, and the list of available skills and agents. Build the routing table from
   the global departments, the repo's skills and agents, and the generic roles.
4. **Routing loop**, per request:
   1. `director-scribe` opens `REQ-<nnnn>-<slug>.md` with the request word for word.
   2. Split the request into pieces. For each piece pick a role or department and a tier. Run
      pieces in parallel when they don't touch the same files and the profile's dials allow it.
   3. Tell the user the split in a few lines, then start. Each brief is self-contained: goal,
      files, done-criteria, output format, and "read your role file first".
   4. On each completion: check it against that piece's done-criteria, have `director-scribe`
      update the request, give the user one status line.
   5. When all pieces are done: `director-checker` checks the whole result against the original
      request; report; `director-scribe` closes the request.
5. **Steering.** When the user changes a request mid-flight: update the request file and
   `SendMessage` the affected roles or sessions; don't wait for them to finish.
6. **Tiers.** Default from the role file; override per piece when it is clearly lighter or
   harder. Write the choice in the request file.
7. **Departments.** Start as a background subagent, or as a session when the work is long or the
   user should see it, with the department's skill as the first line of the prompt (for example
   `/implement .claude/tickets/X/plan.md`). Track the subagent or session, not its internal agents. The department's own state (ticket folder, factory board,
   run log) is linked from the request file.
8. **Dials.** Follow the profile's dials: what must run one at a time, quotas, what costs money,
   what to ask the user before. With no profile: never spend money or start a service without
   asking.
9. **Learning.** When the same kind of piece comes up a third time with no matching role,
   propose a role (name, tier, scope, self-check, global or repo). Create it only after the user
   agrees, and record the decision in the request file.
10. **Commands.**
    - `/director`: director mode for this session.
    - `/director status`: open requests and running pieces, from the request files and the
      session's running agents and sessions.
    - `/director roles`: every role, department and dial with its rules and self-checks, so
      hardened rules can be reviewed (the videos' warning).
    - `/director resume`: read the open requests, check what each piece left (files, branches,
      ticket folders, sessions) and carry on, or ask.

### Role file format

```markdown
---
name: director-<role>
description: <when the director picks it, one sentence>
tools: <smallest set>
model: haiku | sonnet | opus
---
Tier: light | standard | deep

## Scope        what it owns, what it never touches
## Read first   the repo's CLAUDE.md + whatever its brief names
## Do           the rules
## Self-check   3 to 6 checks it runs before returning
## Output       exact return format (or the one file it writes)
```

### `director-scribe` (light)

- Tools: Read, Write, Edit, Glob.
- Writes only under `.claude/director/requests/`.
- `open` (next number, slug, the request word for word), `update` (a row in Pieces, a line in
  Log, the status), `close` (outcome and date).
- Request file:

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

- Self-check: the file parses, the id is unique, no other file was touched, the request text is
  word for word.

### `director-scout` (light)

- Tools: Read, Grep, Glob, Bash (read-only commands only: `git log`, `git status`, `git diff`,
  `ls`, `cat`).
- Jobs: "where is X", "which files use Y", summarise test, lint or log output, read a
  department's state file, list what a session or branch left behind.
- Returns a short answer with `path:line` references. Never edits.
- Self-check: every claim has a path; says "not found" rather than guessing.

### `director-checker` (standard)

- Tools: Read, Grep, Glob, Bash (read-only).
- Gets the request text, the done-criteria per piece and where the results are. Checks the
  result against them in a fresh context, so the director never grades its own routing.
- Returns PASS or FAIL per criterion with evidence (path, command output), plus anything the
  request asked for that nobody did.
- Self-check: every verdict has evidence; it doesn't fix anything.

### `tiers.md`

| Tier | Model | Use for |
|---|---|---|
| light | haiku | state files, lookups, output triage, classification |
| standard | sonnet | a scoped change, a review, tests, docs, checking a result |
| deep | opus | specs, architecture, security review, unclear debugging, writing that matters |

Plus the videos' rule: when unsure whether a cheaper tier is enough, run both for a while on the
same kind of piece, compare, and write the result here.

### `departments.md` (global)

One entry each, only for what is installed: `implement` (a plan → code on a ticket branch),
`factory` (a feature → spec, build, four reviews, approval), `replay-ticket` (the same change in
other repos), `handoff` / `resume-handoff` (save and pick up a session). Gstack skills (`review`,
`qa`, `investigate`, `ship` ...) are listed as departments only if the user wants them routed.
Each entry: when to use, how to launch, what it returns, where its state lives, when it
escalates.

### `profile-format.md` (per repo)

A repo's `.claude/director.md` has five optional sections:

- **Departments**: the repo's skills that run their own loop, how to launch each.
- **Roles**: the repo's agents and when to pick them.
- **Dials**: what must run one at a time, quotas, cost gates, what to ask before.
- **State**: where the repo already keeps state (tickets, run logs); request files link there.
- **Checks**: a checklist per kind of work.

The example in `profile-format.md` is made up; it is not the creative hub's real profile.

## Phases

### Phase 0: check and choose the packaging

Already confirmed from the Claude Code docs (2026-10-26): plugin skills are `/<plugin>:<skill>`;
subagents can nest three levels; roles without `tools:` get MCP tools; `model:` takes
`haiku`/`sonnet`/`opus`/`inherit` or a model id, and the Agent tool's per-call `model` wins over it.

1. Test in a scratch folder: a role in `~/.claude/agents/` started with a per-call `model` runs on
   that model; a subagent starts a nested subagent; check `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`
   is not set to `1` on either machine.
2. Confirm the packaging (open question 1) and write it into this plan.

### Phase 1: the director and three roles

1. Write the skill and its `reference/` files.
2. Write `director-scribe`, `director-scout`, `director-checker`.
3. Extend `install.js` to copy the skill and the three roles (`--dry-run` shows them,
   `--uninstall` removes them), then install.
4. Add a director section to this repo's `README.md`, without touching the user's own edits there.

Acceptance, in a scratch repo and then in one real repo with a read-only request:
- `/director` in a fresh session answers with 🎬 and makes no file edits itself.
- A small question creates `REQ-0001-*.md` through `director-scribe`, goes to `director-scout`
  on the light tier, and closes with the answer.
- A two-piece request runs both pieces in parallel and reports each completion in one line.
- A subagent the director starts does not start with 🎬 or act as a director.
- `/director roles` lists every role with tier and self-checks.

### Phase 2: departments, steering, resume

1. Route a real plan through `implement` as a session and track it from the request file.
2. Change the request while it runs; the director steers it with `SendMessage` and logs it.
3. Restart the session, run `/director resume`; it picks up open requests from the files alone.
4. `/director status` with at least two open requests.

Acceptance: all four work without the user explaining the state again.

### Phase 3: profile support

1. Write `profile-format.md` and make the director read `.claude/director.md`.
2. Test with a throwaway profile in a scratch repo: a dial that forbids parallel runs of one
   department is followed; a repo role is picked over a generic one.

Real profiles (creative hub, Pixotope) are separate tickets in those repos.

### Phase 4: tuning experiments (optional)

- A SessionStart hook that says "N open director requests" when a repo has any (a small
  `director-status` plugin in this repo, or a settings hook; SessionStart output is added to the
  session's context).
- A light `director-triage` role that picks department and tier before the director plans,
  compared with the director alone over about 10 requests; kept only if it helps.
- A `/loop` heartbeat while long departments run.
- Tier comparisons as in `tiers.md`.

## Verification

Run each phase's acceptance by hand in a fresh session. Each time check the request file, which
model each agent ran on (agent results show it), that the director made no file edits itself,
and that `git status` shows nothing outside `.claude/director/` in the test repo.

## Implementation notes

- Implement with the global `implement` skill and this plan's path.
- Work on a branch in this repo (`director-mode`); stage only the director's files, never the
  user's uncommitted `README.md` and `settings-hooks/*` changes.
- File edits go through `implementer` children; the main session checks them.

## Open questions

1. **Packaging:** a skill and roles copied by `install.js` (called `/director`, roles named
   `director-scribe` ...) or a plugin (`director@tihi-mods`: one switch in `enabledPlugins`, but
   called `/director:director` and roles `director:scribe`). Recommended: the copy.
2. **Activation:** opt-in `/director` (planned) or always on through an output style? Opt-in
   keeps normal sessions as they are.
3. **Request files in git:** commit them, or have the director offer to add
   `.claude/director/` to the repo's `.gitignore`? Recommended: the director never commits them
   and asks once per repo.
4. **Scribe round trips:** a `director-scribe` call for every update (planned, as the videos
   suggest) or small updates by the director itself? Revisit if it feels slow.

## Jev (decision)

Per the transcript, Jev is a decision model (choice, score, yes/no with probabilities) for custom
agent loops: model routing, risk gating, skill selection, re-ranking, triage, filtering. Claude
Code subagents run Claude models only, and Claude Code already does skill selection and
permission gating, so Jev doesn't fit here. Light-tier roles fill the same "cheap decision" slot.
Revisit only for a custom harness, and prefer local open decision models there so nothing leaves
the machine. Nothing about Jev beyond the transcript has been verified; the name may be
mis-transcribed.

## Progress (implementation)

Phases 1 and 3, files only (2026-10-26). Not committed. Phase 0 tests, the acceptance runs in real
sessions, and installing into the real `~/.claude` are not done by this slice.

- **Phase 1 step 1 (skill + reference): done.** `skills/director/SKILL.md` (143 lines) and
  `skills/director/reference/{tiers,departments,request-format,profile-format}.md`. `departments.md`
  entries were written from the installed SKILL.md files of `implement`, `factory`, `handoff`,
  `resume-handoff` and `skills/replay-ticket/SKILL.md`; gstack skills are a short note (routed only
  if the user asks).
- **Phase 1 step 2 (roles): done.** `agents/director-scribe.md` (haiku; Read, Write, Edit, Glob),
  `agents/director-scout.md` (haiku; Read, Grep, Glob, Bash read-only), `agents/director-checker.md`
  (sonnet; Read, Grep, Glob, Bash read-only). All three carry `disallowedTools: Agent`.
- **Phase 1 step 3 (install.js): done.** Every folder under `skills/` and every `agents/*.md` is
  copied (`installSkills`); `--skills-only` copies only those (no `settings-hooks/`, no
  `settings.json`, no plugins); `--uninstall` removes only the shipped skill folders and the agent
  files this repo ships (`uninstallSkills`); `--dry-run` prints copy/remove lines and changes
  nothing. Usage comment updated.
- **Phase 1 step 4 (README): done.** New `## /director` section before `## Develop`, plus two added
  lines (an installer bullet and a `--skills-only` line). No existing line was edited; the user's
  changed line (status line row) is untouched.
- **Phase 3 step 1 (profile): done.** `profile-format.md` (five sections, made-up bakery example)
  and the skill reads `.claude/director.md` at session start. Phase 3 step 2 (scratch-repo test
  of a dial and a repo role) is not run.

Verification (Node via `fnm exec --using=24 node`; `node` is not on PATH in this shell):
- `node --check install.js`: exit 0.
- `node install.js --dry-run --skills-only` and `--dry-run --uninstall --skills-only`: print the
  expected lines (director + replay-ticket skills, three agents); with `--home` pointing at a
  missing folder, nothing was created.
- Real install then uninstall in `.claude/temp/fakehome` with `--skills-only`: installed 11 files
  (director 5, replay-ticket 2, agents 3, plus the pre-placed `agents/implementer.md` and
  `skills/other/SKILL.md` in the first run); after uninstall only the pre-placed
  `agents/implementer.md` (and `skills/other/SKILL.md` in the first run) remained. Fake home removed.
- Full (non `--skills-only`) `--dry-run` install and uninstall against the fake home: run, no
  `mods/` created.
- Frontmatter of the SKILL.md and three agent files parses (checked by a small script, not a YAML
  library).
- `git diff settings-hooks/` is byte-identical to before; `git status` shows only `README.md`,
  `install.js`, `agents/`, `skills/director/` (plus the user's four pre-existing modified files and
  `.claude/`).

Deviations:
- `--hooks-only`, `--plugins-only` and `--skills-only` now exit with an error when combined
  (previously combining the first two silently did nothing).
- Skill copying moved out of `install()`/`uninstall()` into `installSkills()`/`uninstallSkills()`,
  so `--hooks-only` still installs skills (as before), `--plugins-only` does not, and the old
  hard-coded `replay-ticket` path is gone (it is covered by the generalised loop).
- With `--skills-only` the closing message says to restart Claude Code, not to run `/mod-doctor`.
- `director-scribe` has no clock tool, so the brief must give it the date and time; it says so in
  its output when they are missing.
- Correction (coordinator): the Learning section of `skills/director/SKILL.md` no longer hard-codes
  `C:/projects/Personal/claude-mods/agents/`; it says the `agents/` folder of the user's claude-mods
  clone (this machine: that path; ask if it does not exist), then reinstall with `--skills-only`.
- Correction (coordinator, from acceptance runs): the Identity section of `skills/director/SKILL.md`
  now says every message starts with 🎬 with no exceptions, naming one-line status updates, progress
  notes and the final report.
- Correction (coordinator, after the acceptance runs): the Identity rule now says every director
  message starts with 🎬, including one-line status updates.

## Acceptance (orchestrator)

Installed with `node install.js --skills-only` into `C:/Users/Infplane/.claude` (skill, reference
files, three roles; `skills/replay-ticket` recopied, it was identical). Runs were headless
`claude -p` sessions (Claude Code 2.1.310, Opus 5.5) in throwaway git repos in the session
scratchpad, `--permission-mode auto`.

Phase 0 (this machine):
- [x] Per-call `model: haiku` on a subagent ran on `claude-haiku-5-5`.
- [x] That subagent started a nested subagent (it had the Agent tool, ran on haiku).
- [x] `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` is not set.
- [ ] The other machine: not checked.

Phase 1:
- [x] `/director` answers with 🎬; the director made no Write/Edit itself in any run (it read
  files and ran read-only Bash).
- [x] Small question: REQ-0001 opened by `director-scribe` (haiku), answered by `director-scout`
  (haiku), closed with the answer.
- [x] Two-piece request: both pieces ran in parallel as background sonnet workers, one status
  line per completion, `director-checker` PASS, REQ-0002 closed, nothing committed.
- [x] No subagent message started with 🎬.
- [x] `/director roles` lists every role with tier and quoted self-checks, the departments,
  tiers and the no-profile dial.
- [ ] One real repo with a read-only request: not run (it would create `.claude/director/` in a
  real repo before the user's `.gitignore` answer).

Phase 2:
- [x] Department: a plan routed to `/implement` as a background subagent; it cut
  `T-1_rename-format-badge-count`, ran its own `implementer`, checker PASS, nothing committed.
  The session variant (`start_session`) is not tested: headless `-p` has no sessions.
- [x] Steering: a second user message 75 s in changed the request; the director sent both
  workers `SendMessage` (narrow scope; drop and delete), logged it, marked the piece `dropped`,
  checker PASS.
- [x] Resume: a fresh session with `/director resume` found REQ-0003's dead agent, checked what
  it left with `director-scout`, restarted and finished it; left REQ-0004 waiting on the user.
- [x] `/director status` with two open requests: one line each, no work started.

Phase 3:
- [x] Profile in a scratch repo: the repo role `bell-tester` was picked over a generic worker,
  the two test pieces ran one at a time (the dial), and the `.gitignore` question was not asked
  (the profile answered it).

Found:
- In `--permission-mode acceptEdits` the scribe's writes under `.claude/` are denied (Claude Code
  protects `.claude/`); in `auto` they go through. In a manual or acceptEdits interactive
  session, expect a permission prompt per request-file write.
- Some status lines lacked 🎬 (fixed in the skill, see the correction above).
- Git Bash rewrote a leading `/director` argument of `claude -p` into a path in one run (a test
  harness quirk; the model recovered by invoking the skill).

Phase 4: not started (optional).
