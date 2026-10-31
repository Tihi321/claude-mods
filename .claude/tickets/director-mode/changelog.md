# Changelog: director-mode

## 2026-10-26 (NO-TASK): `/director` skill and three roles, installed globally

A global, opt-in `/director` skill with three generic roles, installed into `~/.claude` by
`install.js --skills-only`. Checked in headless sessions in throwaway repos; not committed.

### claude-mods (branch `director-mode`, from `master` e252e0f)

- `skills/director/SKILL.md` (new): the director. Every message starts with 🎬, including status
  lines. It reads `CLAUDE.md`, the optional profile `.claude/director.md`, open request files and
  the visible skills and agents, then routes each piece to a role (subagent) or a department
  (skill with its own loop, as a background subagent or a session) with a tier. It keeps request
  files through `director-scribe`, checks the whole result with `director-checker`, steers running
  work with `SendMessage`, follows the profile's dials (no profile: never spends money or starts a
  service without asking), proposes new roles after the third repeat, and never commits request
  files (asks once per repo about `.gitignore`). Commands: `status`, `roles`, `resume`.
- `skills/director/reference/tiers.md`, `departments.md`, `request-format.md`,
  `profile-format.md` (new): tier map (light/standard/deep → haiku/sonnet/opus); the global
  departments `implement`, `factory`, `replay-ticket`, `handoff`/`resume-handoff` with launch lines
  and state locations; the request file format and statuses; the per-repo profile format with a
  made-up example.
- `agents/director-scribe.md` (new, haiku): the only writer of `.claude/director/requests/`;
  open, update, close.
- `agents/director-scout.md` (new, haiku): read-only lookups and output triage.
- `agents/director-checker.md` (new, sonnet): PASS/FAIL/UNCHECKED per criterion with evidence;
  never fixes.
- `install.js`: copies every folder under `skills/` and every `agents/*.md` (the hard-coded
  `replay-ticket` copy is replaced by the loop). New `--skills-only` (only skills and agents: no
  `settings-hooks/`, no `settings.json`, no plugins). Uninstall removes only the skill folders and
  agent files this repo ships. The `--*-only` flags now refuse to be combined.
- `README.md`: a new `## /director` section, an installer bullet and a `--skills-only` line. The
  user's own uncommitted edit in the status-line row is untouched.

Installed on this machine: `~/.claude/skills/director/` (5 files) and
`~/.claude/agents/director-{scribe,scout,checker}.md`.

### Deviations from the plan

- Layout: `skills/director/` and `agents/` at the repo root (the repo's existing convention), not
  a `director/` folder; installed by copying (open question 1, recommended answer), not as a
  plugin.
- A department's brief starts with its skill invocation (`/implement ...`), not with "Read your
  role file first"; roles keep that first line.
- `director-scribe` has no clock: the director passes the date and time in the brief.
- The test repos lived in the session scratchpad, not `.claude/temp/`: Claude Code denies writes
  under a nested `.claude/` path in headless runs.

### Verification

Run:
- `node --check install.js`; `install.js --dry-run --skills-only` and `--dry-run --uninstall
  --skills-only`; a real install and uninstall into a fake home (a pre-existing
  `agents/implementer.md` survived); frontmatter parse of the four new `.md` files. All passed
  (implementer's run).
- `node install.js --skills-only` into the real home; the installed `SKILL.md` matches the source.
- Phase 0: a per-call `model: haiku` subagent ran on Haiku and started a nested subagent;
  `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` unset.
- Seven headless `claude -p` runs (`--permission-mode auto`) covering every acceptance item of
  phases 1 to 3: lookup through scout and scribe; two parallel pieces with checker PASS; `roles`;
  `status` with two open requests; `resume` of a request whose agent was gone; a plan through
  `/implement` as a background department (branch cut, nested implementer, checker PASS);
  mid-flight steering by a second message; a profile with a repo role and a one-at-a-time dial.
  Details in the plan's "Acceptance (orchestrator)".
- `git diff settings-hooks/` unchanged from before the work.

Not run:
- The other machine (phase 0 checks and the install).
- A department as a separate session (`start_session`); headless runs have no sessions.
- A read-only request in a real repo.
- Discovery of a repo *skill* as a department (a repo *agent* was tested).
- Interactive sessions in manual or acceptEdits mode, where each request-file write will ask
  for permission.

### Follow-ups and limitations

- Phase 4 (optional): SessionStart "N open requests" hook, a triage role, a `/loop` heartbeat,
  tier comparisons.
- Per-repo profiles (creative hub, Pixotope repos) are separate tickets in those repos.
- Request-file writes under `.claude/` prompt in manual/acceptEdits modes; an allow rule for
  `.claude/director/**` would be the user's call.

### Commit status

Committed on `director-mode` as `ae1ac6c` (2026-10-26); the workflow update (triage, plan
checkpoint, scope rule, `director-researcher`) followed as `9efccec` (2026-10-31). Both were
merged into `master` through PR #1 (`72656a4`). The user's status-line effort edits (README row
and `settings-hooks/*`) were committed to `master` separately on 2026-10-31.
