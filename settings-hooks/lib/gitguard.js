'use strict';
// git-guard: `git switch -c ABC-123-x origin/master` makes the new branch track origin/master,
// so a later plain `git push` fails (or, worse, someone runs `git push origin HEAD:master`).
// After any branch-creating command, drop an upstream whose branch name differs from the local one,
// and turn on push.autoSetupRemote so the first `git push` creates origin/<same-name> and tracks it.

const path = require('path');
const c = require('./common');

const CREATES_BRANCH = /\bgit\b[^\n;&|]*\b(switch\s+(-c|-C|--create|--force-create)\b|checkout\s+-[bB]\b|branch\s+(?!-)\S+\s+\S+|worktree\s+add\b[^\n;&|]*\s-[bB]\b)/;

function fixRepo(dir) {
  const root = c.repoRoot(dir);
  if (!root) return null;
  const head = c.git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
  if (!head.ok || head.out === 'HEAD') return null;
  const up = c.git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], root);
  if (!up.ok || !up.out) return null;
  const remote = c.git(['config', '--get', `branch.${head.out}.remote`], root).out || 'origin';
  const upBranch = up.out.startsWith(remote + '/') ? up.out.slice(remote.length + 1) : up.out;
  if (upBranch === head.out) return null;
  const unset = c.git(['branch', '--unset-upstream'], root);
  if (!unset.ok) return { root, branch: head.out, upstream: up.out, error: unset.err };
  let autoSetup = false;
  if (c.config().gitGuard.setAutoSetupRemote && !c.git(['config', '--get', 'push.autoSetupRemote'], root).out) {
    autoSetup = c.git(['config', 'push.autoSetupRemote', 'true'], root).ok;
  }
  return { root, branch: head.out, upstream: up.out, autoSetup };
}

function afterBash(input, out) {
  const cfg = c.config().gitGuard;
  const command = (input.tool_input && input.tool_input.command) || '';
  if (!cfg.enabled || !CREATES_BRANCH.test(command)) return;
  const seen = new Set();
  for (const d of c.commandDirs(command, input.cwd)) {
    const r = fixRepo(d);
    if (!r || seen.has(r.root)) continue;
    seen.add(r.root);
    const repo = path.basename(r.root);
    if (r.error) {
      out.tellUser(`git-guard: ${repo}/${r.branch} tracks ${r.upstream}; could not unset it (${r.error})`);
      continue;
    }
    out.tellUser(`git-guard: ${repo}/${r.branch} was tracking ${r.upstream}; upstream removed so \`git push\` creates origin/${r.branch}${r.autoSetup ? ' (push.autoSetupRemote on)' : ''}`);
    out.addContext(`git-guard: the new branch ${r.branch} in ${repo} had upstream ${r.upstream}; it was unset so pushes can't target ${r.upstream}. A plain \`git push\` (or \`git push -u origin HEAD\`) will create origin/${r.branch}. Never suggest \`git push origin HEAD:${r.upstream.split('/').pop()}\`.`);
  }
}

module.exports = { afterBash, fixRepo, CREATES_BRANCH };
