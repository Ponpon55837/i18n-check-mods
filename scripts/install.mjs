// Installs (or removes) the i18n-pixel mod for every Claude Code session, the desktop app included,
// by adding its folder to CLAUDE_CODE_PLUGIN_DIRS in the user's ~/.claude/settings.json.
//
// Usage: pnpm plugin:install      add the mod
//        pnpm plugin:uninstall    remove it
//
// The existing settings are kept as they are; the file is backed up to settings.json.bak first.
// CLAUDE_CONFIG_DIR is honoured, as Claude Code itself does.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const KEY = 'CLAUDE_CODE_PLUGIN_DIRS'
const isUninstall = process.argv.includes('--uninstall')
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const plugin = path.join(repo, 'plugins', 'i18n-pixel')
const configDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')
const file = path.join(configDir, 'settings.json')

if (!fs.existsSync(path.join(plugin, '.claude-plugin', 'plugin.json'))) {
  console.error(`✘ 找不到外掛：${plugin}`)
  process.exit(1)
}

let settings = {}
if (fs.existsSync(file)) {
  const text = fs.readFileSync(file, 'utf8')
  try {
    settings = JSON.parse(text.replace(/^﻿/, ''))
  } catch (error) {
    console.error(`✘ ${file} 不是合法的 JSON，沒有做任何修改：${error.message}`)
    process.exit(1)
  }
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    console.error(`✘ ${file} 的最外層不是物件，沒有做任何修改`)
    process.exit(1)
  }
}

const env = settings.env !== null && typeof settings.env === 'object' ? { ...settings.env } : {}
const same = (a, b) => process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b)
const dirs = String(env[KEY] ?? '').split(path.delimiter).map(dir => dir.trim()).filter(Boolean)
const isPresent = dirs.some(dir => same(dir, plugin))

if (isUninstall ? !isPresent : isPresent) {
  console.log(isUninstall ? 'ℹ 沒有安裝，不需要移除。' : `✔ 已經安裝過了：${plugin}`)
  process.exit(0)
}

const next = isUninstall ? dirs.filter(dir => !same(dir, plugin)) : [...dirs, plugin]
if (next.length > 0) env[KEY] = next.join(path.delimiter)
else delete env[KEY]

const updated = { ...settings }
if (Object.keys(env).length > 0) updated.env = env
else delete updated.env

fs.mkdirSync(configDir, { recursive: true })
if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`)
fs.writeFileSync(file, `${JSON.stringify(updated, null, 2)}\n`)

if (isUninstall) {
  console.log(`✔ 已移除 i18n-pixel（${file}）`)
} else {
  console.log(`✔ 已安裝 i18n-pixel`)
  console.log(`  外掛位置：${plugin}`)
  console.log(`  設定檔：  ${file}（原檔備份為 settings.json.bak）`)
  console.log('  開一個新的 Claude Code session（終端機或桌面版都可以），輸入 /i18n-pixel 即可使用。')
}
