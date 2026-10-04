'use strict';
// UserPromptSubmit: jira-prefetch.
const c = require('../lib/common');
const jira = require('../lib/jira');

c.run(async () => {
  const input = c.readInput();
  const out = new c.Output('UserPromptSubmit');
  try { await jira.onPrompt(input, out); } catch (e) { c.log('jira: ' + (e.stack || e)); }
  await out.flush();
});
