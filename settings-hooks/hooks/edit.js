'use strict';
// PreToolUse / PostToolUse for Edit|Write|MultiEdit. Runs eol-guard before lint-changed, in one process,
// so the linter never sees a half-fixed file.  Usage: node edit.js pre|post
const c = require('../lib/common');
const eol = require('../lib/eol');
const lint = require('../lib/lint');

c.run(async () => {
  const phase = process.argv[2];
  const input = c.readInput();
  const out = new c.Output(input.hook_event_name || (phase === 'pre' ? 'PreToolUse' : 'PostToolUse'));
  const step = (name, fn) => { try { fn(); } catch (e) { c.log(`${name}: ${e.stack || e}`); } };
  if (phase === 'pre') {
    step('eol.pre', () => eol.pre(input, out));
    step('lint.pre', () => lint.pre(input, out));
  } else {
    step('eol.post', () => eol.post(input, out));
    step('lint.post', () => lint.post(input, out));
  }
  await out.flush();
});
