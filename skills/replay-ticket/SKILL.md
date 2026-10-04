---
name: replay-ticket
description: Carry a change already made in one repo over to other repos in one go. Use when the user points at a `.claude/tickets/<name>` folder (or a branch) from one repo and wants "the same change", "this repo same", "same logic" in other repos, e.g. a CI or release-script change replicated across several sibling services. Builds a bundle of the source diff and notes, creates the branch in every target, and runs one implementer per repo in parallel.
argument-hint: <source ticket folder> [target repo keys or names... | all]
---

# Replay a ticket into other repos

Input: `$ARGUMENTS`. The first path is the **source ticket folder** (`<repo>/.claude/tickets/<name>`). Anything else names **targets**: absolute repo paths, keys or names from a repo map (see step 2), or `all`. Free text after that is extra guidance for every implementer.

If the user didn't give a ticket folder but the conversation clearly identifies one, use it. If there is no source at all, ask for it.

## 1. Bundle the source change

```bash
node "${CLAUDE_SKILL_DIR}/scripts/bundle.js" --ticket "<source ticket folder>"
```

Optional: `--branch <name>` if the script picks the wrong branch, `--base <branch>` if it isn't `master`. It writes `replay-bundle.md` into the source ticket folder (commits, diffstat, ticket notes, committed + uncommitted diff) and prints a JSON summary. Check `branchFoundBy`, `commits`, `filesChanged` and `uncommittedFiles`; if the summary shows an empty change or the wrong branch, stop and tell the user.

Read the bundle once yourself so you can judge each target, but don't paste it into prompts: implementers read it from disk.

## 2. Resolve targets

Look for a repo map: a `repos.yaml` in a sibling skill folder (`${CLAUDE_SKILL_DIR}/../*/repos.yaml`), with a `repos:` mapping of `key: { name, path, what }`. If there is one, map each target key or name to its `path`; `all` means every repo in it except the source repo (and any marked as documentation only). Without a map, targets must be repo paths; ask for them if names were given. If no targets were given, ask with AskUserQuestion (multi-select, the source repo excluded), showing each repo's `what` line as the description.

For each target, look quickly at the files the bundle touches, by role (for a release-script change: the CI config, the docs config, `scripts/release.js`, `package.json`). If a target clearly has nothing equivalent, drop it and tell the user why rather than sending an implementer.

## 3. Prepare each target repo

For every remaining target, in order:

1. `git -C <path> status --porcelain`. If dirty, stop and ask (stash, commit, or carry over) - never move someone's work silently.
2. Branch name: the source branch name (without `origin/`). If a branch with that name exists locally or on origin, switch to it and say so. Otherwise:
   `git -C <path> fetch origin master` then `git -C <path> switch --no-track -c <branch> origin/master` (use `main` if there's no master). `--no-track` matters: tracking `origin/master` makes a later plain `git push` fail.
3. Ticket folder `<path>/.claude/tickets/<ticket>/`. Make sure `.claude/tickets/` and `.claude/temp/` are git-excluded (`git check-ignore -q .claude/tickets/x`, else append both to `.git/info/exclude`).
4. Write `<path>/.claude/tickets/<ticket>/plan.md`:

```markdown
# <ticket> (replay from <source repo name>)

Source bundle: <absolute path to replay-bundle.md>
Source branch: <branch> in <source repo path>
Target: <target repo path>, branch <branch>

## Goal
<one paragraph: the intent of the change, in your words>

## Target-specific mapping
- <source file> -> <target file or "no equivalent, skip">

## Extra guidance
<the user's free text, verbatim; omit if none>

## Checklist
- [ ] Apply the change
- [ ] Verification: <the repo's own checks, e.g. yarn lint / cargo check / node scripts/release.js --help>
```

## 4. Run implementers in parallel

Spawn one `implementer` subagent per target **in a single message** so they run concurrently. Prompt for each:

> Plan: `<target>/.claude/tickets/<ticket>/plan.md`. Reference change: `<bundle path>` (read it fully; it is the same change already done in `<source repo>`).
> You own only `<target path>`. You're on branch `<branch>`; don't switch branches, commit, or push.
> Reproduce the intent of the reference change in this repo, following this repo's conventions. Map files by role; skip parts with no equivalent and list them. Keep line endings as the files have them.
> Run the verification in the plan and report: files changed, verification and result, skipped parts and why, anything you couldn't verify.

## 5. Report

As handbacks arrive, keep one table up to date in your replies:

| repo | branch | status | verification | skipped / notes |
|---|---|---|---|---|

When all are back: for each target run `git -C <path> diff --stat`, then write `changelog.md` next to its `plan.md` from the actual diff and verification (new dated entry at the top if it already exists). Finish with the final table and the list of repos the user still needs to commit and push. Don't commit unless the user asks.
