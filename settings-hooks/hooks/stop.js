'use strict';
// Stop / SubagentStop: lint-changed gate.  Usage: node stop.js main|subagent
const c = require('../lib/common');
const lint = require('../lib/lint');

c.run(async () => {
  const input = c.readInput();
  const kind = process.argv[2] === 'subagent' || input.hook_event_name === 'SubagentStop' ? 'subagent' : 'main';
  const out = new c.Output(input.hook_event_name || (kind === 'subagent' ? 'SubagentStop' : 'Stop'));
  try { lint.stop(input, out, kind); } catch (e) { c.log('lint.stop: ' + (e.stack || e)); }
  await out.flush();
});
