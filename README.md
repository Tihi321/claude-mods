# claude-mods

Claude Code mods, packaged so any machine can install them with one command. There are three kinds:

- **Plugin mods** (`plugins/`). Real Claude Code mods (function-hook plugins) that add bands above the prompt, status-line entries and tool hooks. This folder is a plugin marketplace named `tihi-mods`.
- **Settings-hook mods** (`settings-hooks/`). Classic hook scripts and a status line, wired into `~/.claude/settings.json`.
- **Skill** (`skills/replay-ticket/`). The `/replay-ticket` skill.

## Install

You need Node 18+, git, and Claude Code 2.1.289 or newer (`claude update`).

```sh
git clone git@github.com:Tihi321/claude-mods.git
cd claude-mods
node install.js
```

Then restart Claude Code (or run `/reload-plugins`), and run `/mod-doctor` to check that everything loaded.

The installer:
- adds this clone as the `tihi-mods` marketplace and installs every plugin in `plugins/` for your user;
- copies `settings-hooks/` to `~/.claude/mods/` and the skill to `~/.claude/skills/replay-ticket/`;
- backs up `~/.claude/settings.json`, then merges in the hooks and the status line, leaving your other settings alone.

Running it again updates in place without creating duplicates. An existing status line is kept unless you pass `--force-statusline`; the old one is saved and comes back on `--uninstall`.

Options: `--dry-run`, `--uninstall` (removes everything), `--hooks-only`, `--plugins-only`, `--force-statusline`.

The marketplace is read in place from the clone, so keep the clone where it is. After an edit, `/reload-plugins` picks it up; no reinstall is needed.

Plugins only, without cloning:

```sh
claude plugin marketplace add Tihi321/claude-mods
claude plugin install ci-watch@tihi-mods   # and so on for each plugin below
```

## Plugin mods

| Mod | What it does | Model usage |
|---|---|---|
| `ci-watch` | After a successful `git push`, polls GitHub Actions for that commit. Shows `CI ⏳/✓/✗` in the status line and a toast with the result. On a failure, a band shows the failed job, step and log tail, with **Ask Claude to fix**, **Open run** and **Dismiss** buttons. | none (the fix button sends one prompt) |
| `ship-bar` | One row above the prompt: branch · changed files · commits to push · PR state. Buttons: **Commit & push**, **Open PR**, **View PR**, **Diff**. `/ship-bar` hides or shows it. | none (the commit and PR buttons send a prompt) |
| `cache-clock` | `cache warm 43m · hit 97% · ctx 160K/200K 80% · 5h 34%   0: compact`. It turns yellow 5 minutes before the cache goes cold and red once it has, with one toast at 5 minutes. `0` or the button compacts. `/cache`, `/cache ttl 5\|60\|auto`, `/cache warn <min>`, `/cache off\|on`. | none |
| `next-steps` | After each finished turn, suggests three next prompts. Type `1`, `2` or `3` into the empty prompt (or click) to send one. `/next`, `/next manual`, `/next off`, `/next model <name>`. | one Haiku call per turn (~1–3K in, ~150 out) |
| `delete-guard` | Holds `rm -r`, `Remove-Item -Recurse`, `rmdir /s`, `del /s` and `git clean -f`. It counts what would go and asks: **Move to trash**, **Delete permanently** or **Refuse**. `/undo-delete` restores the last batch, and `/trash` lists batches; batches older than 14 days are purged. `/delete-guard ask\|trash\|off`. | none |
| `eol-guard` | After Write, Edit, Bash or PowerShell, restores the CRLF/LF line endings git checks a file out with, and tells Claude to re-read the file. In a `core.autocrlf=true` checkout, adds `--end-of-line auto` to direct `prettier --check` calls. | none |
| `plan-to-ticket` | When a plan is approved, saves it as `.claude/tickets/<ticket>/plan.md` in the project. The ticket ID comes from your prompt, and an existing folder for that ID is reused. | none |
| `session-ref` | When a prompt contains an earlier session's ID, attaches a digest of it: prompts, files changed, commits and the last reply. Python cuts transcripts over 4 MiB down first. | none (adds input tokens) |
| `mod-doctor` | `/mod-doctor` writes one health report covering every plugin and settings hook, the config, Node, mods-log errors and ESLint timings. | none |

GitHub access (ci-watch, and ship-bar's PR state) goes through `gh api` when `gh` is installed, otherwise through the REST API using `GITHUB_TOKEN`/`GH_TOKEN`, otherwise anonymously. Anonymous access covers public repositories, at 60 requests an hour.

## Settings-hook mods

| Mod | Event | What you see | Model usage |
|---|---|---|---|
| lint-changed | PreToolUse + PostToolUse `Edit\|Write`, Stop, SubagentStop | `lint-changed: 2 new error(s) in StatusPanel.jsx` | none |
| git-guard | PostToolUse `Bash\|PowerShell` | `git-guard: app/ABC-123-x was tracking origin/master; upstream removed…` | none |
| status line | statusLine | `my-app  ABC-123-status-panel ↑1  3 changed  vite:5173 ●  Opus 5.5` | none |
| eol-guard (hook) | PreToolUse + PostToolUse | off by default; the `eol-guard` plugin replaces it | none |

- **lint-changed.** The first time Claude touches a JS/TS file in a session, ESLint records the errors already in it. After each edit, only *new* errors are reported to Claude. When Claude or a subagent finishes, every file it edited is re-linted, and the stop is blocked once if new errors remain. It uses the repo's own `node_modules/eslint` and config.
- **git-guard.** After a command that creates a branch tracking a differently named upstream (`git switch -c ABC-123 origin/master`), it unsets that upstream and turns on `push.autoSetupRemote`, so a plain `git push` creates `origin/<branch>`.
- **Status line.** Repo, branch, ahead/behind, changed and new file counts, a warning when the upstream doesn't match, "not pushed", the configured dev ports (up or down), and the model.

### Configure

The shipped `settings-hooks/config.json` is generic: no dev ports. Put machine-specific values in `settings-hooks/config.local.json`, which is git-ignored; copy `config.local.example.json` to start one. `install.js` merges it in. After installing, edit `~/.claude/mods/config.json` directly; reinstalling keeps your values. Every mod has an `enabled` flag. Logs and per-session state live in `%TEMP%\claude-mods\`.

## /replay-ticket

`/replay-ticket <repo>/.claude/tickets/<name> <target repos…>` carries a change made in one repo over to others. It bundles the source branch (commits, the diff including uncommitted work, and the ticket's notes) into `replay-bundle.md`, then in each target creates the same branch with `--no-track` and writes a `plan.md`. One `implementer` runs per repo in parallel, and it finishes with a status table and a `changelog.md` per repo. Target names resolve through a `repos.yaml` in a sibling skill folder if one exists; otherwise give paths. Nothing is committed.

## Develop

```sh
claude plugin validate .                 # the marketplace
claude plugin validate ./plugins/<mod>   # what a mod hooks and calls, and anything the engine would refuse
claude plugin test ./plugins/<mod>       # runs its tests/*.test.ts
node plugins/delete-guard/tests/helper.node.mjs
```

A plugin is `.claude-plugin/plugin.json`, plus `hooks/hooks.json` naming one hooks module, plus a `types/index.d.ts` contract when it keeps `$.state`. Claude Code writes `.claude-plugin/types/` and `tsconfig.json` beside a plugin when it loads it; both are git-ignored. To ship a change to installed copies elsewhere, bump `version` in the plugin's `plugin.json`.
