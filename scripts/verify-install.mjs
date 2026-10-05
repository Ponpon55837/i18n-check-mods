// Tests scripts/install.mjs against throwaway config folders (CLAUDE_CONFIG_DIR), never the real one.
// Usage: node scripts/verify-install.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const script = path.join(repo, 'scripts', 'install.mjs')
const plugin = path.join(repo, 'plugins', 'i18n-pixel')
const KEY = 'CLAUDE_CODE_PLUGIN_DIRS'

const sandbox = () => fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-pixel-install-'))
const run = (dir, ...args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, stdio: 'pipe' }) }
  } catch (error) {
    return { code: error.status, out: String(error.stdout) + String(error.stderr) }
  }
}
const read = dir => JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))
const write = (dir, value) => fs.writeFileSync(path.join(dir, 'settings.json'), typeof value === 'string' ? value : JSON.stringify(value, null, 2))
const dirs = []

try {
  // 1. Existing settings are kept, the folder is appended to an existing list, and a backup is made.
  const a = sandbox()
  dirs.push(a)
  const other = path.join(os.tmpdir(), 'some-other-plugin')
  const original = { theme: 'dark', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo hi' }] }] }, env: { FOO: 'bar', [KEY]: other } }
  write(a, original)
  assert.equal(run(a).code, 0)
  const installed = read(a)
  assert.equal(installed.theme, 'dark')
  assert.deepEqual(installed.hooks, original.hooks)
  assert.equal(installed.env.FOO, 'bar')
  assert.deepEqual(installed.env[KEY].split(path.delimiter), [other, plugin])
  assert.ok(fs.existsSync(path.join(a, 'settings.json.bak')), 'backup written')

  // 2. Running it again changes nothing.
  const before = fs.readFileSync(path.join(a, 'settings.json'), 'utf8')
  assert.match(run(a).out, /已經安裝過了/)
  assert.equal(fs.readFileSync(path.join(a, 'settings.json'), 'utf8'), before)

  // 3. Uninstall restores the original settings exactly.
  assert.equal(run(a, '--uninstall').code, 0)
  assert.deepEqual(read(a), original)
  assert.match(run(a, '--uninstall').out, /沒有安裝/)

  // 4. No settings file yet: one is created, and uninstall removes the env block it added.
  const b = sandbox()
  dirs.push(b)
  fs.rmSync(b, { recursive: true })
  assert.equal(run(b).code, 0)
  assert.equal(read(b).env[KEY], plugin)
  assert.equal(run(b, '--uninstall').code, 0)
  assert.deepEqual(read(b), {})

  // 5. A settings file that is not valid JSON is left untouched.
  const c = sandbox()
  dirs.push(c)
  write(c, '{ "theme": "dark", ')
  const result = run(c)
  assert.notEqual(result.code, 0)
  assert.equal(fs.readFileSync(path.join(c, 'settings.json'), 'utf8'), '{ "theme": "dark", ')
  assert.ok(!fs.existsSync(path.join(c, 'settings.json.bak')))

  console.log(`✔ install checks passed on ${process.platform} (merge, idempotent, uninstall round-trip, new file, invalid JSON)`)
} finally {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true })
}
