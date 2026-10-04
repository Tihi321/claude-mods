# claude-mods

Claude Code mods: plugins of function hooks that add status lines, bands above the prompt and tool hooks. Packaged as a plugin marketplace so any machine can install them.

| Mod | What it does | Usage cost |
|---|---|---|
| [`ci-watch`](ci-watch) | After a successful `git push`, polls GitHub Actions for that commit. Shows `CI ⏳/✓/✗` in the status line and a toast with the result. On a failure, a band shows the failed job, step and log tail, with **Ask Claude to fix**, **Open run** and **Dismiss** buttons. | None while watching. The fix button sends one prompt. |
| [`eol-guard`](eol-guard) | After Write, Edit, Bash or PowerShell, restores the CRLF/LF line endings git checks a file out with, and tells Claude to re-read it. In a `core.autocrlf=true` checkout, adds `--end-of-line auto` to direct `prettier --check` calls. | None |
| [`ship-bar`](ship-bar) | A row above the prompt: branch · changed files · commits to push · PR state, refreshed after each turn and every 15 s. Buttons: **Commit & push**, **Open PR**, **View PR**, **Diff**. `/ship-bar` hides or shows it. | The row and Diff are free. The commit and PR buttons send a normal prompt. |
| [`plan-to-ticket`](plan-to-ticket) | When a plan is approved, saves it as `.claude/tickets/<ticket>/plan.md` in the project. The ticket ID comes from your prompt, and an existing folder for that ID is reused. Claude is told to use that copy. | None |
| [`session-ref`](session-ref) | When a prompt contains an earlier session's ID, attaches a digest of that session (prompts, files changed, commits, last reply) and logs one line saying so. | No model call. The digest adds input tokens. |

## Install

```sh
claude plugin marketplace add Tihi321/claude-mods
claude plugin install ci-watch@tihi-mods
claude plugin install eol-guard@tihi-mods
claude plugin install ship-bar@tihi-mods
claude plugin install plan-to-ticket@tihi-mods
claude plugin install session-ref@tihi-mods
```

Installed mods load in every new session. In a session that is already open, run `/reload-plugins`.

### Update

Bump `version` in the mod's `.claude-plugin/plugin.json` and push. Then, on each machine:

```sh
claude plugin marketplace update tihi-mods
claude plugin update <mod>@tihi-mods
```

Then run `/reload-plugins` in any open session.

### Working from a local clone

To edit the mods and use them on the same machine, add the clone as the marketplace instead of GitHub:

```sh
claude plugin marketplace add C:\projects\Personal\claude-mods
```

Plugins installed from a folder marketplace are read from the folder itself. After an edit, `/reload-plugins` picks it up, with no version bump or reinstall.

## Requirements

- Claude Code 2.1.289 or newer. The function-hook API is early access and can change between releases. If a mod stops loading, `claude plugin validate <mod>` says why.
- `git` on PATH, for ci-watch, ship-bar and eol-guard.
- `python` on PATH, for session-ref with transcripts over 4 MiB (`session-ref/scripts/compact.py`).
- Optional: `gh` logged in, or `GITHUB_TOKEN`/`GH_TOKEN` set. Without either, ci-watch and ship-bar's PR lookup call the GitHub API anonymously, which covers public repositories at 60 requests an hour.

## Develop

```sh
claude plugin validate ./ci-watch   # what it hooks and calls, and anything the engine would refuse
claude plugin test ./ci-watch       # runs ci-watch/tests/*.test.ts
```

Each mod is `.claude-plugin/plugin.json`, plus `hooks/hooks.json` naming one hooks module (`hooks/register.ts(x)`), plus a `types/index.d.ts` contract when it keeps `$.state`. Claude Code writes `.claude-plugin/types/` and `tsconfig.json` beside a mod when it loads it. Both are ignored here.
