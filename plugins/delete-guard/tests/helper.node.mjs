// Runs the real Node helper against temp folders: node tests/helper.node.mjs
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { HELPER } from '../hooks/register.js'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-home-'))
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-work-'))
const run = (cmd, args) => {
  const r = spawnSync('node', ['-e', HELPER, cmd, JSON.stringify(args)], { env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}
fs.mkdirSync(path.join(work, 'build', 'sub'), { recursive: true })
for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(work, 'build', 'sub', 'f' + i + '.js'), 'x'.repeat(100))
fs.writeFileSync(path.join(work, 'build', 'index.html'), '<html>')
fs.mkdirSync(path.join(work, 'my dir'))
fs.writeFileSync(path.join(work, 'my dir', 'a.txt'), 'a')

const st = run('stat', { cwd: work, targets: ['build', 'my dir', 'missing'] })
assert.equal(st[0].files, 41); assert.equal(st[0].bytes, 4006); assert.equal(st[0].isDir, true)
assert.deepEqual(st[0].sample.sort(), ['index.html', 'sub'])
assert.equal(st[1].files, 1); assert.equal(st[2].exists, false)

const t = run('trash', { cwd: work, targets: ['build', 'my dir'], command: 'rm -rf build "my dir"' })
assert.equal(t.items.length, 2); assert.equal(t.failed.length, 0)
assert.ok(!fs.existsSync(path.join(work, 'build'))); assert.ok(!fs.existsSync(path.join(work, 'my dir')))
assert.ok(t.root.startsWith(home))
const t2 = run('trash', { cwd: work, targets: ['missing'] })
assert.equal(t2.items.length, 0)

const list = run('list', {})
assert.equal(list.length, 1); assert.equal(list[0].items[0].files, 41)

// Something recreated at the original place blocks only that item.
fs.mkdirSync(path.join(work, 'my dir'))
const r = run('restore', {})
assert.deepEqual(r.restored, [path.join(work, 'build')])
assert.equal(r.skipped.length, 1)
assert.equal(fs.readdirSync(path.join(work, 'build', 'sub')).length, 40)
fs.rmdirSync(path.join(work, 'my dir'))
const r2 = run('restore', {})
assert.deepEqual(r2.restored, [path.join(work, 'my dir')])
assert.equal(run('list', {}).length, 0)
assert.equal(run('restore', {}).error, 'nothing in the trash to restore')

// Purge
run('trash', { cwd: work, targets: ['build'] })
const dir = path.join(home, '.claude', 'mods-trash')
const stamp = fs.readdirSync(dir)[0]
const mf = path.join(dir, stamp, 'manifest.json')
const m = JSON.parse(fs.readFileSync(mf, 'utf8')); m.when = '2020-01-01T00:00:00Z'; fs.writeFileSync(mf, JSON.stringify(m))
assert.deepEqual(run('purge', { days: 14 }).removed, [stamp])
// ~ expansion
fs.mkdirSync(path.join(home, 'tmpx'))
assert.equal(run('stat', { cwd: work, targets: ['~/tmpx'] })[0].exists, true)
console.log('helper: all checks passed')
