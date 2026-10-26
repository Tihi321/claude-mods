# Global departments

A department is a skill with its own loop. Entries here are only for what is installed globally
(`~/.claude/skills/`). A repo adds its own through `## Departments` in its profile.

Launch rule for all of them: run as a background subagent when it can go unattended, as a session
when it is long or the user should see it (desktop app: `start_session`; plain CLI: give the user
the one-line prompt). The first line of the prompt is the skill invocation. If nesting is off
(`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`), sessions only. In the request file, track the
subagent or session and link the state location.

## implement

- **When:** an approved plan exists (`.claude/tickets/<ticket>/plan.md`) and should become code.
  Global instructions require plan implementation to go through this skill.
- **Launch:** `/implement .claude/tickets/<ticket>/plan.md` (absolute path when the session is in
  another folder). Session by default: it cuts a ticket branch and runs `implementer` children.
- **Returns:** code on the ticket branch (uncommitted unless the user asked), the plan's checklist
  updated with verification evidence and deviations, and `changelog.md` in the ticket folder.
- **State:** the ticket folder `.claude/tickets/<ticket>/` and the branch. Link both.
- **Escalates:** asks when the plan is ambiguous or the working tree holds uncommitted user work
  (never stashes it); reports unresolved dependencies instead of widening the plan.

## factory

- **When:** a feature that should go through spec, build, four reviews and an approval, in a repo
  that has (or may get) a `factory/` folder.
- **Launch:** `/factory <feature>`; also `/factory next`, `/factory approve <job-id>`,
  `/factory rework <job-id> <note>`. Session: it is a long loop and the user may need to approve.
  One job at a time per repo.
- **Returns:** a merged-locally branch `factory/<id>` or a job in `needs-human`; never pushes.
- **State:** `factory/board.json`, `factory/jobs/<id>/` (spec, build, reviews, decision). The
  factory orchestrator is the only writer of `board.json`; the director only reads it. Link the
  job folder.
- **Escalates:** `needs-human` after two review rounds or on an approver ESCALATE; the user runs
  `/factory approve` or `/factory rework`. Requires a clean working tree (ignoring `factory/`).

## replay-ticket

- **When:** the same change made in one repo should be carried over to other repos.
- **Launch:** `/replay-ticket <source repo>/.claude/tickets/<name> <target repos... | all>`.
  Background subagent is fine once the targets are named; session if the targets must be chosen.
- **Returns:** a branch and `plan.md` per target, one `implementer` per repo, a status table and
  a `changelog.md` per target. Nothing is committed.
- **State:** `replay-bundle.md` in the source ticket folder, and each target's
  `.claude/tickets/<name>/`. Link the bundle.
- **Escalates:** stops and asks when a target repo is dirty or the bundle is empty or on the
  wrong branch.

## handoff and resume-handoff

- **When:** `handoff` to save a session's state for a fresh session; `resume-handoff` to start
  from one. The director uses them when a department's session must be ended and picked up.
- **Launch:** `/handoff` (in the session that holds the work; ticket inferred from context), and
  `/resume-handoff .claude/tickets/<ticket>` in the new session. Both are sessions, not
  subagents: `handoff` needs the conversation it summarises, and `resume-handoff` is read-only
  and stops after a summary until the user says continue.
- **Returns:** `handoff.md` in the ticket folder (replaced, not appended); a verified summary of
  the current state and the next step.
- **State:** `.claude/tickets/<ticket>/handoff.md` next to `plan.md`. Link it from the request.
- **Escalates:** `handoff` asks only if the ticket cannot be inferred; `resume-handoff` reports
  any mismatch between the handoff and the repository.

## gstack skills

Skills such as `review`, `qa`, `investigate` and `ship` are not routed by the director unless the
user asks for them. If asked, treat each as a department, read its SKILL.md for the launch line,
and note in the request which ones were used. `ship` and `land-and-deploy` publish or deploy:
always ask first.
