// Checks that every place carrying the version agrees, and that CHANGELOG.md has an entry for it.
// Usage: node scripts/check-versions.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const json = file => JSON.parse(fs.readFileSync(path.join(repo, file), 'utf8'))

const marketplace = json('.claude-plugin/marketplace.json')
const versions = {
  'plugins/i18n-pixel/.claude-plugin/plugin.json': json('plugins/i18n-pixel/.claude-plugin/plugin.json').version,
  '.claude-plugin/marketplace.json (metadata)': marketplace.metadata.version,
  '.claude-plugin/marketplace.json (plugins[i18n-pixel])': marketplace.plugins.find(p => p.name === 'i18n-pixel')?.version,
  'package.json': json('package.json').version,
}
const expected = versions['plugins/i18n-pixel/.claude-plugin/plugin.json']
const failures = Object.entries(versions).filter(([, v]) => v !== expected).map(([where, v]) => `${where}: ${v} (expected ${expected})`)

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(expected)) failures.push(`plugin.json version ${expected} is not SemVer`)
const changelog = fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8')
if (!changelog.includes(`## [${expected}]`)) failures.push(`CHANGELOG.md has no "## [${expected}]" section`)

if (failures.length > 0) {
  console.error('✘ version check failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`✔ version ${expected} is consistent across ${Object.keys(versions).length} files and CHANGELOG.md`)
