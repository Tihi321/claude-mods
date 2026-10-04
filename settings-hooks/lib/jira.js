'use strict';
// jira-prefetch: when a prompt mentions a Jira key (link, bare key, or a file like "[ABC-123].pdf"),
// inject the ticket into context before Claude starts, so it doesn't spend turns on getJiraIssue.
// Sources, best first: the repo's saved .claude/tickets/<KEY>*/ticket.md (from /jira-plan),
// a 30-minute cache, then the Jira REST API (v2, plain-text description) with ATLASSIAN_* credentials.

const fs = require('fs');
const path = require('path');
const c = require('./common');

const CACHE_DIR = path.join(c.MODS_DIR, 'cache', 'jira');
const FIELDS = 'summary,status,issuetype,priority,assignee,reporter,labels,components,fixVersions,parent,subtasks,issuelinks,description,comment';

function extractKeys(prompt, cfg) {
  const found = [];
  const add = (k) => { if (k && !found.includes(k)) found.push(k); };
  const re = /(?:browse\/|selectedIssue=)?\b([A-Z][A-Z0-9]{1,9}-\d{1,7})\b/g;
  let m;
  while ((m = re.exec(prompt || ''))) add(m[1]);
  const allow = (cfg.projects || []).map((p) => p.toUpperCase());
  return found.filter((k) => !allow.length || allow.includes(k.split('-')[0])).slice(0, cfg.maxIssues);
}

function credentials() {
  const e = process.env;
  const email = e.ATLASSIAN_EMAIL || e.JIRA_EMAIL;
  const token = e.ATLASSIAN_API_TOKEN || e.JIRA_API_TOKEN;
  return email && token ? 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64') : null;
}

function savedTicket(key, cwd) {
  const root = c.repoRoot(cwd) || cwd;
  const dir = root && path.join(root, '.claude', 'tickets');
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name === key || name.startsWith(key + '-') || name.startsWith(key + '_')) {
        const f = path.join(dir, name, 'ticket.md');
        if (fs.existsSync(f)) return { text: fs.readFileSync(f, 'utf8'), where: c.rel(f, root) };
      }
    }
  } catch (_) {}
  return null;
}

function cached(key, cfg) {
  const f = path.join(CACHE_DIR, key + '.md');
  try {
    if (Date.now() - fs.statSync(f).mtimeMs < cfg.cacheMinutes * 60000) return fs.readFileSync(f, 'utf8');
  } catch (_) {}
  return null;
}

async function fetchIssue(key, cfg, auth) {
  const bases = [];
  if (process.env.JIRA_PREFETCH_BASE_URL) bases.push(process.env.JIRA_PREFETCH_BASE_URL.replace(/\/$/, ''));
  if (cfg.site) bases.push(`https://${cfg.site}`);
  if (cfg.cloudId) bases.push(`https://api.atlassian.com/ex/jira/${cfg.cloudId}`); // scoped API tokens only work here
  // Try the base that worked last time first.
  const prefFile = path.join(CACHE_DIR, '_base.txt');
  try { const p = fs.readFileSync(prefFile, 'utf8').trim(); if (bases.includes(p)) bases.unshift(...bases.splice(bases.indexOf(p), 1)); } catch (_) {}

  let lastErr = '';
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/rest/api/2/issue/${encodeURIComponent(key)}?fields=${FIELDS}`, {
        headers: { Authorization: auth, Accept: 'application/json' },
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
      if (res.ok) {
        c.ensureDir(CACHE_DIR);
        try { fs.writeFileSync(prefFile, base); } catch (_) {}
        return { issue: await res.json(), base };
      }
      // 401/403/404 from the site can also mean "scoped token": fall through to the next base.
      lastErr = res.status === 404 ? 'not found or no access' : res.status === 401 ? 'HTTP 401, check ATLASSIAN_API_TOKEN' : `HTTP ${res.status}`;
    } catch (e) {
      if (!/^(HTTP|not found)/.test(lastErr)) lastErr = e.name === 'TimeoutError' ? 'timeout' : e.message; // keep the more useful HTTP error
    }
  }
  return { error: lastErr };
}

const name = (u) => (u && (u.displayName || u.name)) || '-';
const list = (a, f = (x) => x.name || x) => (a && a.length ? a.map(f).join(', ') : '-');
function trim(s, n) {
  s = String(s || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return s.length > n ? s.slice(0, n) + '\n[...truncated]' : s;
}

function render(key, issue, cfg) {
  const f = issue.fields || {};
  const out = [];
  out.push(`## ${key}: ${f.summary || ''}`);
  if (cfg.site) out.push(`Link: https://${cfg.site}/browse/${key}`);
  out.push(`Type / Status / Priority: ${f.issuetype ? f.issuetype.name : '-'} / ${f.status ? f.status.name : '-'} / ${f.priority ? f.priority.name : '-'}`);
  out.push(`Assignee / Reporter: ${name(f.assignee)} / ${name(f.reporter)}`);
  out.push(`Labels: ${list(f.labels)} | Components: ${list(f.components)} | Fix version: ${list(f.fixVersions)}`);
  if (f.parent) out.push(`Parent: ${f.parent.key} ${(f.parent.fields && f.parent.fields.summary) || ''}`);
  out.push('', '### Description', trim(f.description, 3500) || '(empty)');
  const links = (f.issuelinks || []).map((l) => {
    const o = l.outwardIssue || l.inwardIssue;
    if (!o) return null;
    const rel = l.outwardIssue ? l.type.outward : l.type.inward;
    return `- ${rel} ${o.key}: ${(o.fields && o.fields.summary) || ''} (${(o.fields && o.fields.status && o.fields.status.name) || '?'})`;
  }).filter(Boolean);
  if (links.length) out.push('', '### Linked issues', ...links);
  const subs = (f.subtasks || []).map((s) => `- ${s.key}: ${(s.fields && s.fields.summary) || ''} (${(s.fields && s.fields.status && s.fields.status.name) || '?'})`);
  if (subs.length) out.push('', '### Subtasks', ...subs);
  const comments = ((f.comment && f.comment.comments) || []).slice(-3);
  if (comments.length) {
    out.push('', `### Last ${comments.length} comment(s)`);
    for (const cm of comments) out.push(`**${name(cm.author)} - ${(cm.created || '').slice(0, 10)}**`, trim(cm.body, 700), '');
  }
  return out.join('\n').trim();
}

function onceToday(tag) {
  const f = path.join(c.ensureDir(path.join(c.TMP_ROOT, 'once')), tag + '-' + new Date().toISOString().slice(0, 10));
  if (fs.existsSync(f)) return false;
  try { fs.writeFileSync(f, ''); } catch (_) {}
  return true;
}

async function onPrompt(input, out) {
  const cfg = c.config().jiraPrefetch;
  const prompt = input.prompt || '';
  if (!cfg.enabled) return;
  if ((cfg.skipWhenPromptHas || []).some((s) => prompt.includes(s))) return;
  const keys = extractKeys(prompt, cfg);
  if (!keys.length) return;

  const st = c.readState(input.session_id, 'jira');
  const todo = keys.filter((k) => !(st.injected || {})[k]);
  if (!todo.length) return;

  // No site configured: only saved ticket.md files are used, and the API is never called.
  const hasSite = !!(cfg.site || cfg.cloudId || process.env.JIRA_PREFETCH_BASE_URL);
  const auth = hasSite ? credentials() : null;
  const blocks = [];
  const shown = [];
  const failed = [];
  await Promise.all(todo.map(async (k) => {
    const saved = savedTicket(k, input.cwd);
    if (saved) { blocks.push({ k, text: `(from ${saved.where})\n` + trim(saved.text, 5000) }); shown.push(`${k} (saved ticket.md)`); return; }
    const hit = cached(k, cfg);
    if (hit) { blocks.push({ k, text: hit }); shown.push(`${k} ${hit.split('\n')[0].replace(/^## [^:]+: /, '').slice(0, 60)}`); return; }
    if (!auth) return;
    const r = await fetchIssue(k, cfg, auth);
    if (r.error) { failed.push(`${k} (${r.error})`); return; }
    const text = render(k, r.issue, cfg);
    try { c.ensureDir(CACHE_DIR); fs.writeFileSync(path.join(CACHE_DIR, k + '.md'), text); } catch (_) {}
    blocks.push({ k, text });
    const f = r.issue.fields || {};
    shown.push(`${k} · ${(f.summary || '').slice(0, 60)} · ${f.status ? f.status.name : ''}`);
  }));

  if (!auth && !blocks.length) {
    if (hasSite && onceToday('jira-nocreds')) out.tellUser('jira-prefetch: set ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN (same as /jira-plan uses) to prefetch tickets');
    return;
  }
  if (failed.length) out.tellUser(`jira-prefetch: could not fetch ${failed.join(', ')}`);
  if (!blocks.length) return;

  blocks.sort((a, b) => keys.indexOf(a.k) - keys.indexOf(b.k));
  let body = blocks.map((b) => b.text).join('\n\n---\n\n');
  if (body.length > cfg.maxChars) body = body.slice(0, cfg.maxChars) + '\n[...truncated]';
  out.addContext(`jira-prefetch: Jira ticket(s) referenced in the user's prompt, fetched ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Use this instead of calling getJiraIssue or reading a ticket PDF, unless you need attachments or the full comment history.\n\n${body}`);
  out.tellUser('jira-prefetch: ' + shown.join(' | '));
  c.updateState(input.session_id, 'jira', (s) => {
    s.injected = s.injected || {};
    for (const b of blocks) s.injected[b.k] = Date.now();
    return s;
  });
}

module.exports = { onPrompt, extractKeys, render };
