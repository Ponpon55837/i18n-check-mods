// Security check for the i18n-pixel mod.
//
// 1. Runs `claude plugin validate`, which reads the hooks module the way the engine will and lists
//    every `$` call it makes, and fails if any call is outside the allow-list below.
// 2. Scans the plugin's source for constructs a read-only checker never needs.
// 3. Checks the manifest has no fields that widen what the plugin can reach.
//
// Usage: node scripts/security-check.mjs
import { execFileSync, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const plugin = path.join(repo, 'plugins/i18n-pixel')
const failures = []

// Everything the mod is allowed to call on `$`. Notably absent: $.fs.write, $.process.*,
// $.net / fetch, $.store, $.settings, $.prompt.submit, $.session.append, $.model.*.
const ALLOWED_CALLS = new Set([
  '$.clock.after', '$.clock.now',
  '$.command.register',
  '$.fs.list', '$.fs.read',
  '$.session.cwd',
  '$.state.get', '$.state.set',
  '$.tool.register',
  '$.ui.open', '$.ui.resolve', '$.ui.status',
])

// 1. What the engine says the module calls.
let validate
try {
  // CLAUDE_CMD overrides how the CLI is reached (CI: `pnpm dlx @anthropic-ai/claude-code`).
  // On Windows `claude` is a .cmd shim, which only runs through a shell; the path is ours, quoted.
  const cli = process.env.CLAUDE_CMD
  validate = cli !== undefined || process.platform === 'win32'
    ? execSync(`${cli ?? 'claude'} plugin validate "${plugin}"`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    : execFileSync('claude', ['plugin', 'validate', plugin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
} catch (error) {
  console.error(String(error.stdout ?? '') + String(error.stderr ?? ''))
  console.error('✘ claude plugin validate failed (is the `claude` CLI on PATH?)')
  process.exit(1)
}
if (!/Validation passed/.test(validate)) failures.push('claude plugin validate did not pass')
const callsLine = validate.split(/\r?\n/).find(line => /register\.tsx calls:/.test(line)) ?? ''
const calls = [...callsLine.matchAll(/\$\.[\w.]+/g)].map(m => m[0])
if (calls.length === 0) failures.push('could not read the list of $ calls from claude plugin validate')
for (const call of calls) if (!ALLOWED_CALLS.has(call)) failures.push(`unexpected engine call: ${call}`)

// 2. Source patterns a read-only, offline checker has no use for.
const FORBIDDEN = [
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\s*\(/, 'new Function()'],
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bXMLHttpRequest\b|\bWebSocket\b/, 'network API'],
  [/\bimport\s*\(/, 'dynamic import()'],
  [/\$\.fs\.write\b/, '$.fs.write'],
  [/\$\.process\b/, '$.process'],
  [/https?:\/\/(?!localhost)/, 'hard-coded remote URL'],
]
// .claude-plugin/types/ is the engine's own API declaration, written there whenever it loads the mod
// (git-ignored); it names every API by design, so it is not the plugin's code.
const GENERATED = path.join(plugin, '.claude-plugin', 'types')
const walk = dir => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (full === GENERATED) return []
    return entry.isDirectory() ? walk(full) : [full]
  })
for (const file of walk(plugin).filter(f => /\.(tsx?|jsx?|mjs|cjs|json)$/.test(f))) {
  const text = fs.readFileSync(file, 'utf8')
  for (const [pattern, label] of FORBIDDEN) {
    if (pattern.test(text)) failures.push(`${path.relative(repo, file)}: contains ${label}`)
  }
}

// 3. Manifest: no MCP servers, no command hooks, no extra dependencies.
const manifest = JSON.parse(fs.readFileSync(path.join(plugin, '.claude-plugin/plugin.json'), 'utf8'))
for (const field of ['mcpServers', 'lspServers', 'dependencies', 'commands', 'agents']) {
  if (manifest[field] !== undefined) failures.push(`plugin.json declares "${field}"`)
}
const hooks = JSON.parse(fs.readFileSync(path.join(plugin, 'hooks/hooks.json'), 'utf8'))
if (JSON.stringify(Object.keys(hooks)) !== '["modules"]') failures.push('hooks.json declares more than function-hook modules (command hooks run shell commands)')

if (failures.length > 0) {
  console.error('✘ security check failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`✔ security check passed: ${calls.length} engine calls, all on the read-only allow-list`)
console.log(`  ${calls.join(', ')}`)
