'use strict';
// PostToolUse for Bash|PowerShell: git-guard (branch upstream) then eol-guard (mixed line endings).
const c = require('../lib/common');
const gitguard = require('../lib/gitguard');
const eol = require('../lib/eol');

c.run(async () => {
  const input = c.readInput();
  const out = new c.Output(input.hook_event_name || 'PostToolUse');
  for (const [name, fn] of [['gitguard', () => gitguard.afterBash(input, out)], ['eol.bash', () => eol.afterBash(input, out)]]) {
    try { fn(); } catch (e) { c.log(`${name}: ${e.stack || e}`); }
  }
  await out.flush();
});
