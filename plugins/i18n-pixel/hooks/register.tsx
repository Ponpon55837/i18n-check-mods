import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { I18nReport, Issue, IssueKind, Phase, ProjectReport, RootReport } from '../types'

// ─── State the pane draws from ──────────────────────────────────────────────

const PANE = 'i18n-pixel'
const report = atom({ plugin: 'i18n-pixel', key: 'report' } as const, null)
const phase = atom({ plugin: 'i18n-pixel', key: 'phase' } as const, { kind: 'idle', text: '' } as Phase)
const project = atom({ plugin: 'i18n-pixel', key: 'project' } as const, 0)
const filter = atom({ plugin: 'i18n-pixel', key: 'filter' } as const, 'all' as IssueKind | 'all')
const offset = atom({ plugin: 'i18n-pixel', key: 'offset' } as const, 0)

// ─── Scanner ────────────────────────────────────────────────────────────────

// Folders never worth walking into.
const IGNORED = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'bin', 'obj', 'vendor',
  'playwright-report', 'test-results', 'storybook-static',
])
// Folder names that may hold locale catalogs.
const LOCALE_DIRS = new Set([
  'locales', 'locale', 'i18n', 'lang', 'langs', 'languages', 'translations', 'messages',
])
// ISO 639 codes accepted as the language part of a locale name.
const LANGS = new Set(
  ('en zh ja ko fr de es it pt ru vi th id ms ar he tr nl pl sv da no nb nn fi cs sk hu ro uk el ' +
    'hi bn fa ur ta te mr gu kn ml pa si my km lo tl fil bg hr sr sl et lv lt ca eu gl is ga cy sq mk ' +
    'az kk uz mn ka hy sw af am zu')
    .split(' '),
)
const LOCALE_NAME = /^([a-z]{2,3})(?:[-_][A-Za-z]{4})?(?:[-_](?:[A-Za-z]{2}|\d{3}))?$/
const SOURCE_FILE = /\.(vue|svelte|[cm]?[jt]sx?)$/
const SKIPPED_SOURCE = /\.d\.ts$|\.min\.js$|\.config\.[cm]?[jt]s$/
const TEST_FILE = /(^|\/)(e2e|tests?|__tests__|__mocks__|mocks?|fixtures)\/|\.(spec|test|stories)\.[cm]?[jt]sx?$/
const CATALOG_FILE = /\.(json|[cm]?[jt]s)$/i
const CODE_CATALOG = /\.[cm]?[jt]s$/i
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/
const PLACEHOLDER = /\{\{?\s*([\w.]+)\s*\}?\}/g
const CJK = /[぀-ヿ㐀-䶿一-鿿가-힯]/
// t('a.b'), $t("a.b"), i18n.global.t(`a.b`), t(someVar)
const T_CALL =
  /(^|[^\w$.])(\$t|t|\$tc|tc|i18n\.global\.t|i18n\.t|i18next\.t)\(\s*(?:(['"])((?:(?!\3)[^\\\n])*)\3|`([^`]*)`|([A-Za-z_$][\w$.]*)\s*[,)])/g

const MAX_DEPTH = 9
const MAX_SOURCES = 8000
const MAX_ISSUES_PER_KIND = 400
const CONCURRENCY = 24

type Catalogs = Map<string, Map<string, string>> // locale -> relative file -> text
type FoundRoot = { path: string; layout: 'dir' | 'file'; catalogs: Catalogs }
// What a directory listing says about a file: enough to tell whether it changed since the last scan.
type Stamp = { mtimeMs: number; size: number }
type SourceFile = Stamp & { path: string }
type Walked = {
  packages: Map<string, string> // dir -> package name
  isWorkspace: boolean
  roots: FoundRoot[]
  sources: SourceFile[]
  isTruncated: boolean
}
// What a source file says, independent of the catalogs: its t() calls and its CJK lines. Keeping
// this (not the issues) lets a catalog edit re-resolve every key without re-reading any source.
type Extracted = {
  usesI18n: boolean
  keys: { where: string; key: string }[]
  dynamic: { where: string; detail: string }[]
  hardcoded: Issue[]
}

// Caches that make a rescan read only the files that changed. Module variables: a reload of the
// mod starts them empty, which is right, since a reload may come with a new includeTests.
const catalogCache = new Map<string, Stamp & { text: string }>()
const sourceCache = new Map<string, Stamp & { found: Extracted }>()
const seenPaths = new Set<string>()
const reads = { read: 0, cached: 0 }

function isFresh(cached: Stamp | undefined, stamp: Stamp) {
  return cached !== undefined && stamp.mtimeMs > 0 && cached.mtimeMs === stamp.mtimeMs && cached.size === stamp.size
}

/** Drops the cache entries of a file a tool just wrote, whatever its mtime says. */
function forget(absolutePath: string) {
  const path = absolutePath.replace(/\\/g, '/').toLowerCase()
  for (const cache of [catalogCache, sourceCache] as Map<string, unknown>[]) {
    for (const key of cache.keys()) {
      const rel = key.toLowerCase()
      if (path === rel || path.endsWith(`/${rel}`)) cache.delete(key)
    }
  }
}

function join(dir: string, name: string) {
  return dir === '' ? name : `${dir}/${name}`
}

function isLocaleName(name: string) {
  const match = LOCALE_NAME.exec(name)
  return match !== null && LANGS.has(match[1]!.toLowerCase())
}

function baseName(file: string) {
  return file.replace(CATALOG_FILE, '')
}

function isCatalogFile(name: string) {
  return CATALOG_FILE.test(name) && !/\.d\.[cm]?ts$/i.test(name)
}

function parseJson(text: string): any {
  return JSON.parse(text.replace(/^﻿/, ''))
}

/**
 * Reads the object a TS/JS catalog exports (`export default {...}`, `export default messages`,
 * `module.exports = {...}`) as data, without running it: plain literals only, so a spread, a call
 * or an import inside it throws and the catalog is reported as unreadable.
 */
function parseCodeCatalog(text: string): unknown {
  const src = text
  let at: number
  const named = /export\s+default\s+([A-Za-z_$][\w$]*)\s*(?:as\s+const\s*)?;?\s*$/m.exec(src)
  if (named !== null && !['async', 'function', 'class'].includes(named[1]!)) {
    const decl = new RegExp(`(?:const|let|var)\\s+${named[1]!.replace(/\$/g, '\\$')}\\b[^=]*=\\s*`).exec(src)
    if (decl === null) throw new Error(`找不到 ${named[1]} 的宣告`)
    at = decl.index + decl[0].length
  } else {
    const start = /export\s+default\s+(?:defineMessages\(|defineLocale\()?/.exec(src) ?? /module\.exports\s*=\s*/.exec(src)
    if (start === null) throw new Error('沒有 export default / module.exports')
    at = start.index + start[0].length
  }

  const fail = (what: string): never => {
    const line = src.slice(0, at).split('\n').length
    throw new Error(`第 ${line} 行：${what}`)
  }
  const skip = () => {
    for (;;) {
      const rest = src.slice(at, at + 2)
      if (/^\s/.test(rest)) at++
      else if (rest === '//') at = src.indexOf('\n', at) < 0 ? src.length : src.indexOf('\n', at)
      else if (rest === '/*') at = src.indexOf('*/', at) < 0 ? fail('註解沒有結束') : src.indexOf('*/', at) + 2
      else return
    }
  }
  const string = (): string => {
    const quote = src[at++]!
    let out = ''
    while (at < src.length && src[at] !== quote) {
      const ch = src[at++]!
      if (quote === '`' && ch === '$' && src[at] === '{') fail('樣板字串含 ${}')
      if (ch !== '\\') {
        out += ch
        continue
      }
      const esc = src[at++]!
      if (esc === 'u') {
        const hex = src[at] === '{' ? src.slice(at + 1, src.indexOf('}', at)) : src.slice(at, at + 4)
        at += src[at] === '{' ? hex.length + 2 : 4
        out += String.fromCodePoint(parseInt(hex, 16))
      } else if (esc === '\r' || esc === '\n') {
        if (esc === '\r' && src[at] === '\n') at++
      } else {
        out += ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' } as Record<string, string>)[esc] ?? esc
      }
    }
    if (src[at++] !== quote) fail('字串沒有結束')
    return out
  }
  const value = (): unknown => {
    skip()
    const ch = src[at]
    if (ch === '{') {
      at++
      const obj: Record<string, unknown> = {}
      for (;;) {
        skip()
        if (src[at] === '}') {
          at++
          return obj
        }
        let key: string
        if (src[at] === '"' || src[at] === "'") key = string()
        else {
          const id = /^[\w$]+/.exec(src.slice(at, at + 200))
          if (id === null) fail(src.startsWith('...', at) ? '不支援 spread' : '無法解析的 key')
          key = id![0]
          at += key.length
        }
        skip()
        if (src[at] !== ':') fail(`「${key}」不是 key: value 的寫法`)
        at++
        obj[key] = value()
        skip()
        if (src[at] === ',') at++
        else if (src[at] !== '}') fail('物件缺少逗號或 }')
      }
    }
    if (ch === '[') {
      at++
      const arr: unknown[] = []
      for (;;) {
        skip()
        if (src[at] === ']') {
          at++
          return arr
        }
        arr.push(value())
        skip()
        if (src[at] === ',') at++
        else if (src[at] !== ']') fail('陣列缺少逗號或 ]')
      }
    }
    if (ch === '"' || ch === "'" || ch === '`') return string()
    const word = /^(-?\d[\d_.eE+-]*|true|false|null)/.exec(src.slice(at, at + 40))
    if (word === null) return fail('值不是字面常數（函式呼叫、變數或 import 無法靜態讀取）')
    at += word[1]!.length
    return word[1] === 'true' ? true : word[1] === 'false' ? false : word[1] === 'null' ? null : Number(word[1]!.replace(/_/g, ''))
  }
  return value()
}

function parseCatalog(file: string, text: string): unknown {
  return CODE_CATALOG.test(file) ? parseCodeCatalog(text) : parseJson(text)
}

async function pool<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let index = 0
  const worker = async () => {
    while (index < items.length) {
      const mine = index++
      results[mine] = await fn(items[mine]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
  return results
}

function list($: EngineInterface, dir: string) {
  return $.fs.list(dir === '' ? '.' : dir).catch(() => [])
}

function readText($: EngineInterface, path: string) {
  return $.fs.read(path).catch(() => '')
}

/** A catalog's (or package.json's) text: from the cache while its listing stamp is unchanged. */
async function readCatalog($: EngineInterface, path: string, stamp: Stamp) {
  seenPaths.add(path)
  const cached = catalogCache.get(path)
  if (isFresh(cached, stamp)) {
    reads.cached++
    return cached!.text
  }
  const text = await readText($, path)
  reads.read++
  catalogCache.set(path, { ...stamp, text })
  return text
}

async function catalogFilesUnder(
  $: EngineInterface, dir: string, prefix: string, depth: number,
): Promise<(Stamp & { file: string })[]> {
  const files: (Stamp & { file: string })[] = []
  for (const entry of await list($, dir)) {
    if (entry.kind === 'file' && isCatalogFile(entry.name)) {
      files.push({ file: prefix + entry.name, mtimeMs: entry.mtimeMs, size: entry.size })
    } else if (entry.kind === 'dir' && depth < 2) {
      files.push(...(await catalogFilesUnder($, join(dir, entry.name), `${prefix}${entry.name}/`, depth + 1)))
    }
  }
  // JSON catalogs win: TS/JS beside them is usually just the loader (`index.ts`).
  const json = files.filter(one => /\.json$/i.test(one.file))
  return json.length > 0 ? json : files
}

/** Reads a folder as locale catalogs: `<locale>/*.{json,ts,js}` or `<locale>.{json,ts,js}`; null when it is neither. */
async function readLocaleRoot($: EngineInterface, path: string): Promise<FoundRoot | null> {
  const entries = await list($, path)
  const catalogs: Catalogs = new Map()

  for (const entry of entries.filter(one => one.kind === 'dir' && isLocaleName(one.name))) {
    const dir = join(path, entry.name)
    const files = await catalogFilesUnder($, dir, '', 0)
    if (files.length === 0) continue
    const texts = await pool(files, one => readCatalog($, join(dir, one.file), one))
    catalogs.set(entry.name, new Map(files.map((one, i) => [one.file, texts[i]!])))
  }
  if (catalogs.size > 0) return { path, layout: 'dir', catalogs }

  const files = entries.filter(entry => entry.kind === 'file' && isCatalogFile(entry.name) && isLocaleName(baseName(entry.name)))
  const hasJson = files.some(entry => /\.json$/i.test(entry.name))
  for (const entry of files) {
    if (hasJson && !/\.json$/i.test(entry.name)) continue
    catalogs.set(baseName(entry.name), new Map([[entry.name, await readCatalog($, join(path, entry.name), entry)]]))
  }
  return catalogs.size > 0 ? { path, layout: 'file', catalogs } : null
}

async function walk($: EngineInterface): Promise<Walked> {
  const walked: Walked = { packages: new Map(), isWorkspace: false, roots: [], sources: [], isTruncated: false }
  let frontier = ['']
  let seen = 0

  for (let depth = 0; depth <= MAX_DEPTH && frontier.length > 0; depth++) {
    const listed = await pool(frontier, async dir => ({ dir, entries: await list($, dir) }))
    const next: string[] = []
    seen += frontier.length
    await setPhase($, `尋找檔案中…已看過 ${seen} 個資料夾`)

    for (const { dir, entries } of listed) {
      const names = new Set(entries.map(entry => entry.name))
      const manifest = entries.find(entry => entry.kind === 'file' && entry.name === 'package.json')
      if (manifest !== undefined) {
        let pkg: any = null
        try {
          pkg = parseJson(await readCatalog($, join(dir, 'package.json'), manifest))
        } catch {}
        const name = typeof pkg?.name === 'string' ? pkg.name : dir === '' ? '(root)' : dir.split('/').pop()!
        walked.packages.set(dir, name)
        if (dir === '' && pkg?.workspaces !== undefined) walked.isWorkspace = true
      }
      if (dir === '' && ['pnpm-workspace.yaml', 'lerna.json', 'nx.json', 'turbo.json', 'rush.json'].some(n => names.has(n))) {
        walked.isWorkspace = true
      }

      for (const entry of entries) {
        const path = join(dir, entry.name)
        if (entry.kind === 'file') {
          if (!SOURCE_FILE.test(entry.name) || SKIPPED_SOURCE.test(entry.name)) continue
          if (walked.sources.length < MAX_SOURCES) walked.sources.push({ path, mtimeMs: entry.mtimeMs, size: entry.size })
          else walked.isTruncated = true
          continue
        }
        // Links are not followed: `kind` is `other` for them.
        if (entry.kind !== 'dir' || entry.name.startsWith('.') || IGNORED.has(entry.name)) continue
        if (LOCALE_DIRS.has(entry.name.toLowerCase())) {
          const root = await readLocaleRoot($, path)
          if (root !== null) {
            walked.roots.push(root)
            continue // catalogs and their loaders are not source to scan
          }
        }
        next.push(path)
      }
    }
    frontier = next
  }
  return walked
}

function flatten(value: unknown, prefix: string, into: Map<string, string>) {
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix === '' ? key : `${prefix}.${key}`, into)
  } else if (prefix !== '') {
    into.set(prefix, typeof value === 'string' ? value : String(value))
  }
}

function placeholders(text: string) {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map(match => match[1]!))].sort().join(',')
}

class Issues {
  readonly list: Issue[] = []
  readonly counts: Partial<Record<IssueKind, number>> = {}
  private readonly seen = new Set<string>()
  add(kind: IssueKind, where: string, detail: string) {
    const id = `${kind}\u0000${where}\u0000${detail}`
    if (this.seen.has(id)) return
    this.seen.add(id)
    const count = (this.counts[kind] ?? 0) + 1
    this.counts[kind] = count
    if (count <= MAX_ISSUES_PER_KIND) this.list.push({ kind, where, detail })
  }
}

function analyzeRoot(root: FoundRoot, issues: Issues): { report: RootReport; keys: Set<string> } {
  const locales = [...root.catalogs.keys()].sort()
  const keysByLocale = new Map<string, Map<string, { value: string; file: string }>>()
  const allFiles = new Set<string>()
  const where = (locale: string, file: string) =>
    root.layout === 'dir' ? `${root.path}/${locale}/${file}` : `${root.path}/${file}`

  for (const locale of locales) {
    const keys = new Map<string, { value: string; file: string }>()
    for (const [file, text] of root.catalogs.get(locale)!) {
      allFiles.add(file)
      let data: unknown
      try {
        data = parseCatalog(file, text)
      } catch (error) {
        issues.add('json', where(locale, file), `無法讀取 catalog：${String(error).slice(0, 100)}`)
        continue
      }
      const flat = new Map<string, string>()
      flatten(data, '', flat)
      for (const [key, value] of flat) {
        const earlier = keys.get(key)
        if (earlier !== undefined) issues.add('duplicate', where(locale, file), `${key}（也在 ${earlier.file}）`)
        keys.set(key, { value, file })
      }
    }
    keysByLocale.set(locale, keys)
  }

  if (root.layout === 'dir') {
    for (const locale of locales) {
      const own = root.catalogs.get(locale)!
      for (const file of allFiles) if (!own.has(file)) issues.add('file-set', `${root.path}/${locale}/`, `缺少 catalog ${file}`)
    }
  }

  const union = new Set<string>()
  for (const keys of keysByLocale.values()) for (const key of keys.keys()) union.add(key)

  const stats = locales.map(locale => {
    const keys = keysByLocale.get(locale)!
    let missing = 0
    for (const key of union) {
      // Plural forms legitimately differ between languages.
      if (keys.has(key) || PLURAL_SUFFIX.test(key)) continue
      missing++
      const file = [...keysByLocale.values()].find(other => other.has(key))?.get(key)?.file ?? ''
      issues.add('missing', where(locale, file), key)
    }
    for (const [key, { value, file }] of keys) {
      if (value.trim() === '') issues.add('empty', where(locale, file), key)
      else if (value === key) issues.add('same-as-key', where(locale, file), key)
    }
    return { locale, keys: union.size - missing, missing }
  })

  if (locales.length > 1) {
    for (const key of union) {
      const sets = locales
        .map(locale => ({ locale, entry: keysByLocale.get(locale)!.get(key) }))
        .filter(one => one.entry !== undefined)
        .map(one => ({ locale: one.locale, file: one.entry!.file, set: placeholders(one.entry!.value) }))
      if (new Set(sets.map(one => one.set)).size > 1) {
        const first = sets[0]!
        issues.add('placeholder', where(first.locale, first.file),
          `${key}：${sets.map(one => `${one.locale}{${one.set}}`).join(' ≠ ')}`)
      }
    }
  }

  return { report: { path: root.path, layout: root.layout, locales: stats, totalKeys: union.size }, keys: union }
}

function blank(text: string) {
  return text.replace(/[^\n]/g, ' ')
}

function hasKey(keys: Set<string>, key: string) {
  return keys.has(key) || ['one', 'other', 'zero', 'few', 'many', 'two'].some(suffix => keys.has(`${key}_${suffix}`))
}

/** Reads what a source file says, without the catalogs: the cacheable half of a source check. */
function extractSource(file: string, text: string): Extracted {
  // Comments are blanked, not removed, so line numbers stay right.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/<!--[\s\S]*?-->/g, blank)
  const found: Extracted = { usesI18n: false, keys: [], dynamic: [], hardcoded: [] }

  let line = 1
  let last = 0
  for (const match of code.matchAll(T_CALL)) {
    found.usesI18n = true
    for (let i = last; i < match.index!; i++) if (code.charCodeAt(i) === 10) line++
    last = match.index!
    const [whole, , call, , quoted, backtick, variable] = match
    const isConcatenated = /^\s*\+/.test(code.slice(match.index! + whole.length))
    if (variable !== undefined || (backtick !== undefined && backtick.includes('${')) || isConcatenated) {
      found.dynamic.push({ where: `${file}:${line}`, detail: `${call}(${variable ?? (backtick !== undefined ? `\`${backtick}\`` : `'${quoted}' + …`)})` })
      continue
    }
    const raw = quoted ?? backtick ?? ''
    const key = raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw // i18next `ns:key`
    if (key !== '' && !key.includes('${')) found.keys.push({ where: `${file}:${line}`, key })
  }

  code.split(/\r?\n/).forEach((text, i) => {
    const bare = text.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')
    if (!CJK.test(bare) || /console\.\w+\(/.test(bare)) return
    found.hardcoded.push({ kind: 'hardcoded', where: `${file}:${i + 1}`, detail: bare.trim().slice(0, 120) })
  })
  found.usesI18n ||= /\b(createI18n|useI18n|useTranslation|i18next|vue-i18n|react-intl|next-intl)\b/.test(code)
  return found
}

/** Checks what a source file says against the current catalog keys. Cheap: no file is read. */
function resolveSource(file: string, found: Extracted, keys: Set<string>, issues: Issues): Issue[] {
  for (const one of found.dynamic) issues.add('dynamic-key', one.where, one.detail)
  if (keys.size > 0) {
    for (const one of found.keys) if (!hasKey(keys, one.key)) issues.add('unknown-key', one.where, one.key)
  }
  // Hardcoded text is only an issue where i18n is in use (the caller decides), and test files are skipped unless asked for.
  return settings.includeTests || !TEST_FILE.test(file) ? found.hardcoded : []
}

/** A source file's extraction: from the cache while its listing stamp is unchanged. */
async function readSource($: EngineInterface, file: SourceFile): Promise<Extracted> {
  seenPaths.add(file.path)
  const cached = sourceCache.get(file.path)
  if (isFresh(cached, file)) {
    reads.cached++
    return cached!.found
  }
  const found = extractSource(file.path, await readText($, file.path))
  reads.read++
  sourceCache.set(file.path, { mtimeMs: file.mtimeMs, size: file.size, found })
  return found
}

/** The project a path belongs to: the deepest package folder above it. */
function ownerOf(path: string, projects: string[]) {
  let best = ''
  for (const dir of projects) {
    if ((dir === '' || path === dir || path.startsWith(`${dir}/`)) && dir.length >= best.length) best = dir
  }
  return best
}

async function scan($: EngineInterface): Promise<I18nReport> {
  const startedAt = await $.clock.now()
  const cwd = await $.session.cwd()
  seenPaths.clear()
  reads.read = 0
  reads.cached = 0
  const walked = await walk($)

  const projectDirs = walked.packages.size > 0 ? [...walked.packages.keys()] : ['']
  if (!projectDirs.includes('')) projectDirs.push('') // files outside every package
  const mode = walked.packages.size <= 1 ? 'single' : walked.isWorkspace ? 'monorepo' : 'multi'

  const perProject = new Map(projectDirs.map(dir => [
    dir,
    { roots: [] as RootReport[], keys: new Set<string>(), sources: [] as SourceFile[], issues: new Issues() },
  ]))
  const allKeys = new Set<string>()

  await setPhase($, '比對語系檔中…')
  for (const root of walked.roots) {
    const owner = perProject.get(ownerOf(root.path, projectDirs))!
    const { report: rootReport, keys } = analyzeRoot(root, owner.issues)
    owner.roots.push(rootReport)
    for (const key of keys) {
      owner.keys.add(key)
      allKeys.add(key)
    }
  }
  for (const file of walked.sources) perProject.get(ownerOf(file.path, projectDirs))!.sources.push(file)

  let done = 0
  for (const one of perProject.values()) {
    // A package with no catalogs of its own (a monorepo app using a shared i18n package) resolves against all of them.
    const keys = one.keys.size > 0 ? one.keys : allKeys
    let usesI18n = one.roots.length > 0
    const hardcoded: Issue[] = []
    await pool(one.sources, async file => {
      const found = await readSource($, file)
      usesI18n ||= found.usesI18n
      hardcoded.push(...resolveSource(file.path, found, keys, one.issues))
      done++
      if (done % 200 === 0) await setPhase($, `檢查原始碼中…${done}/${walked.sources.length}`)
    })
    if (usesI18n) {
      hardcoded.sort((a, b) => a.where.localeCompare(b.where, undefined, { numeric: true }))
      for (const issue of hardcoded) one.issues.add(issue.kind, issue.where, issue.detail)
    }
  }

  const projects: ProjectReport[] = projectDirs
    .map(dir => {
      const one = perProject.get(dir)!
      return {
        name: walked.packages.get(dir) ?? cwd.split(/[\\/]/).pop() ?? '(root)',
        path: dir === '' ? '.' : dir,
        roots: one.roots,
        sourceFiles: one.sources.length,
        counts: one.issues.counts,
        issues: one.issues.list,
      }
    })
    .filter(one => one.roots.length > 0 || one.issues.length > 0)
    .sort((a, b) => a.path.localeCompare(b.path))

  // Files gone since the last scan leave the caches.
  for (const cache of [catalogCache, sourceCache] as Map<string, unknown>[]) {
    for (const key of cache.keys()) if (!seenPaths.has(key)) cache.delete(key)
  }

  return {
    cwd,
    mode,
    projects,
    durationMs: (await $.clock.now()) - startedAt,
    readFiles: reads.read,
    cachedFiles: reads.cached,
    isTruncated: walked.isTruncated ||
      projects.some(one => Object.values(one.counts).some(n => (n ?? 0) > MAX_ISSUES_PER_KIND)),
  }
}

const KIND_ORDER: IssueKind[] = [
  'json', 'file-set', 'missing', 'placeholder', 'duplicate', 'empty', 'same-as-key', 'unknown-key', 'dynamic-key', 'hardcoded',
]
const MODE_TEXT = { single: '單一專案', monorepo: 'monorepo', multi: '多專案資料夾' } as const

function summarize(result: I18nReport): string {
  const lines = [
    `i18n 掃描：${MODE_TEXT[result.mode]}，${result.projects.length} 個專案有 i18n 相關內容，耗時 ${Math.round(result.durationMs)}ms` +
      `（讀取 ${result.readFiles} 個檔，${result.cachedFiles} 個沒變動沿用上次結果）`,
  ]
  for (const one of result.projects) {
    lines.push('', `## ${one.name} (${one.path})，原始檔 ${one.sourceFiles} 個`)
    for (const root of one.roots) {
      lines.push(`- 語系目錄 ${root.path} [${root.layout}]，${root.totalKeys} keys：` +
        root.locales.map(l => `${l.locale} 缺 ${l.missing}`).join('、'))
    }
    for (const kind of KIND_ORDER) {
      const count = one.counts[kind]
      if (!count) continue
      lines.push(`- ${kind}: ${count}`)
      for (const issue of one.issues.filter(i => i.kind === kind).slice(0, 15)) {
        lines.push(`  - ${issue.where} — ${issue.detail}`)
      }
    }
  }
  if (result.isTruncated) lines.push('', '（結果有截斷：每類最多保留 400 筆，原始檔最多掃 8000 個）')
  return lines.join('\n')
}

// ─── Scan lifecycle ─────────────────────────────────────────────────────────

let rescanTimer: { cancel: () => void } | undefined
let isRunning = false
const settings = { includeTests: false }

async function setPhase($: EngineInterface, text: string) {
  await update($, phase, () => ({ kind: 'scanning', text }))
}

async function runScan($: EngineInterface): Promise<I18nReport | null> {
  if (isRunning) return null
  isRunning = true
  await setPhase($, '準備掃描…')
  try {
    const result = await scan($)
    await update($, report, () => result)
    await update($, project, n => Math.min(n, Math.max(0, result.projects.length - 1)))
    await update($, offset, () => 0)
    await update($, phase, () => ({ kind: 'done', text: '' }))
    const bugs = result.projects.reduce((sum, one) => sum + total(one), 0)
    $.ui.status(`i18n 覆蓋率 ${Math.floor(coverage(result.projects) * 100)}% · 問題 ${bugs}`)
    return result
  } catch (error) {
    await update($, phase, () => ({ kind: 'error', text: String(error).slice(0, 200) }))
    return null
  } finally {
    isRunning = false
  }
}

function startScan($: EngineInterface) {
  $.clock.after(0, () => void runScan($))
}

function scheduleRescan($: EngineInterface) {
  rescanTimer?.cancel()
  rescanTimer = $.clock.after(2000, () => void runScan($))
}

// ─── Pixel look ─────────────────────────────────────────────────────────────

// PICO-8 palette.
const C = {
  red: '#FF004D', orange: '#FFA300', yellow: '#FFEC27', green: '#00E436', blue: '#29ADFF',
  lav: '#83769C', pink: '#FF77A8', peach: '#FFCCAA', white: '#FFF1E8', gray: '#5F574F',
}

// A 3-row block font spelling I18N. Each row is one string, so its inner spaces survive layout
// (separate per-letter Texts lost their padding), colored top to bottom. Block art only lines up
// in a monospace grid, so only the terminal draws it; other surfaces get the one-line badge.
// Spaces are no-break spaces: text layout may trim ordinary leading or trailing spaces.
const LOGO: { color: string; row: string }[] = [
  { color: C.red, row: '▀█▀ ▄█  █▀█ █▄ █' },
  { color: C.orange, row: ' █   █  █▀█ █ ▀█' },
  { color: C.yellow, row: '▀▀▀ ▀▀▀ ▀▀▀ ▀  ▀' },
].map(line => ({ ...line, row: line.row.replace(/ /g, ' ') }))
const BADGE = '▚▞ I18N ▞▚'

// Each kind: a two-character tag (all the same width), a color, the hotkey that filters to it,
// and one sentence saying what it means and what to do about it.
const KINDS: Record<IssueKind, { tag: string; color: string; hotkey: string; help: string }> = {
  json: { tag: '壞檔', color: C.red, hotkey: 'o',
    help: '語系檔讀不到：JSON 語法錯誤，或 TS/JS 語系檔用了 spread、import、函式呼叫。' },
  'file-set': { tag: '缺檔', color: C.red, hotkey: 'f',
    help: '語系檔案不齊：其他語系有這個檔案，這個語系資料夾裡沒有。' },
  missing: { tag: '缺漏', color: C.red, hotkey: 'm',
    help: '缺翻譯：其他語系有這個 key，這個語系沒有，要補上翻譯。' },
  placeholder: { tag: '參數', color: C.pink, hotkey: 'p',
    help: '參數不一致：同一個 key 在各語系的 {變數} 不同，有的語系會顯示不出值。' },
  duplicate: { tag: '重複', color: C.orange, hotkey: 'x',
    help: 'key 重複：同一語系裡同一個 key 寫在兩個檔案，後面的會蓋掉前面的。' },
  empty: { tag: '空值', color: C.yellow, hotkey: 'e',
    help: '翻譯是空的：key 存在但內容是空字串，畫面上會是空白。' },
  'same-as-key': { tag: '未翻', color: C.yellow, hotkey: 's',
    help: '翻譯等於 key：內容跟 key 一模一樣，通常是忘了翻。' },
  'unknown-key': { tag: '無鍵', color: C.blue, hotkey: 'u',
    help: 'key 不存在：程式碼 t(\'...\') 用的 key 在語系檔裡找不到，畫面會直接顯示 key。' },
  'dynamic-key': { tag: '動態', color: C.lav, hotkey: 'd',
    help: 'key 是組出來的：用變數或字串拼接，沒辦法自動確認存不存在，請人工確認。' },
  hardcoded: { tag: '寫死', color: C.peach, hotkey: 'c',
    help: '寫死的文字：程式碼裡直接寫中日韓文字，沒有走 i18n，切換語系時不會變。' },
}
const MODE_LABEL = { single: '單一專案', monorepo: 'monorepo', multi: '多專案資料夾' } as const

function bar(ratio: number, width: number) {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * width)
  return { on: '█'.repeat(filled), off: '░'.repeat(width - filled) }
}

function hpColor(ratio: number) {
  return ratio >= 0.95 ? C.green : ratio >= 0.8 ? C.yellow : C.red
}

function total(one: ProjectReport) {
  return Object.values(one.counts).reduce((sum: number, n) => sum + (n ?? 0), 0)
}

function coverage(projects: ProjectReport[]) {
  let have = 0
  let want = 0
  for (const one of projects) for (const root of one.roots) for (const locale of root.locales) {
    have += locale.keys
    want += root.totalKeys
  }
  return want === 0 ? 1 : have / want
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

export const register: Register = (on, options) => {
  settings.includeTests = options.includeTests === true

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'i18n-pixel',
      description: '像素風 i18n 檢查：開啟面板並掃描（/i18n-pixel scan 只掃描並回報文字）',
    })
    await $.tool.register({
      name: 'i18n_report',
      description:
        'Scan the working directory for i18n problems (locale key parity, placeholder mismatches, empty values, ' +
        't() keys missing from catalogs, dynamic keys, hardcoded CJK text). Handles single projects, monorepos ' +
        'and folders holding several projects. Read-only. Returns a text report grouped by project.',
      inputSchema: { type: 'object', properties: { rescan: { type: 'boolean', description: 'Scan again instead of reusing the last report' } } },
    })
    return next(e)
  })

  on('command.run', { command: 'i18n-pixel' }, async ($, e) => {
    if (e.args.trim() === 'scan') {
      const result = (await runScan($)) ?? (await read($, report))
      return { text: result === null ? '掃描進行中，稍後再試。' : summarize(result) }
    }
    await $.ui.open({ id: PANE, title: 'I18N QUEST' })
    startScan($)
    return { text: 'I18N QUEST 面板已開啟，掃描中…' }
  })

  on('tool.call', { tool: 'mcp__i18n-pixel__i18n_report' }, async ($, e) => {
    const isRescan = (e as { rescan?: unknown }).rescan === true
    const cached = await read($, report)
    const result = cached === null || isRescan ? ((await runScan($)) ?? cached) : cached
    return { result: result === null ? 'A scan is already running; call again shortly.' : summarize(result) }
  })

  // Rescan once the model's edits to catalogs or source settle, if a report is showing.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const path = (e as { file_path?: unknown }).file_path
    const isRelevant = typeof path === 'string' && /\.(json|vue|svelte|[cm]?[jt]sx?)$/.test(path)
    if (isRelevant && ['Edit', 'Write', 'MultiEdit'].includes(e.tool)) {
      forget(path)
      if ((await read($, report)) !== null) scheduleRescan($)
    }
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(30, (e.props as { bodyColumns?: number }).bodyColumns ?? e.viewport?.columns ?? 60)
    const height = e.viewport?.rows ?? 30
    const data = await read($, report)
    const state = await read($, phase)
    const isScanning = state.kind === 'scanning'
    const rule = () => <Text color={C.gray}>{'─'.repeat(Math.max(10, width - 6))}</Text>
    const heading = (num: string, title: string, note?: string) => (
      <Box flexDirection="row">
        <Text color={C.yellow} bold>{`${num} ${title}`}</Text>
        {note !== undefined && <Text color={C.gray} wrap="truncate-start">{`  ${note}`}</Text>}
      </Box>
    )
    const howTo = <Text color={C.gray}>操作方式：先點一下面板，再按冒號前面的鍵（例如 r）。Esc 回到輸入框。</Text>
    const rescan = (
      <Button key="rescan" plain hotkey="r" label={isScanning ? '掃描中…' : '重新掃描'} onPress={() => startScan($)} />
    )

    const projects = data?.projects ?? []
    const all = coverage(projects)
    const allBar = bar(all, Math.max(6, Math.min(16, width - 46)))
    const bugs = projects.reduce((sum, one) => sum + total(one), 0)

    const isTerminal = e.surface === 'terminal'
    const header = (
      <Box flexDirection="row" gap={2}>
        {isTerminal && (
          <Box flexDirection="column" flexShrink={0}>
            {LOGO.map(line => <Text color={line.color} wrap="truncate">{line.row}</Text>)}
          </Box>
        )}
        <Box flexDirection="column" flexGrow={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Box flexDirection="row" gap={1}>
              {!isTerminal && <Text color={C.orange} bold>{BADGE}</Text>}
              <Text color={C.white} bold>i18n 檢查</Text>
            </Box>
            {rescan}
          </Box>
          {data === null ? (
            <Text color={C.gray}>{isScanning ? state.text : '還沒掃描'}</Text>
          ) : (
            <Box flexDirection="column">
              <Text color={C.blue}>
                {isScanning ? state.text : `${MODE_LABEL[data.mode]} · ${projects.length} 個專案 · 共 ${bugs} 個問題`}
              </Text>
              <Box flexDirection="row">
                <Text color={C.white}>翻譯覆蓋率 </Text>
                <Text color={hpColor(all)}>{allBar.on}</Text>
                <Text color={C.gray}>{allBar.off}</Text>
                <Text color={hpColor(all)} bold>{` ${Math.floor(all * 100)}%`}</Text>
              </Box>
              {!isScanning && (
                <Text color={C.gray}>
                  {`掃描 ${(data.durationMs / 1000).toFixed(1)} 秒 · 讀取 ${data.readFiles} 個檔，${data.cachedFiles} 個沒變動沿用上次結果`}
                </Text>
              )}
            </Box>
          )}
        </Box>
      </Box>
    )
    const frame = (body: unknown) => (
      <Box flexDirection="column" borderStyle="double" borderColor={C.blue} paddingX={1}>
        {header}
        {rule()}
        {body as never}
        {rule()}
        {howTo}
      </Box>
    )

    if (data === null) {
      return frame(
        <Box flexDirection="column">
          <Text color={state.kind === 'error' ? C.red : C.yellow} bold>
            {isScanning ? '掃描中，請稍候…' : state.kind === 'error' ? '掃描失敗' : '按 r 開始掃描'}
          </Text>
          <Text color={state.kind === 'error' ? C.red : C.lav}>
            {state.kind === 'error' ? state.text : '會掃描目前資料夾裡的語系檔與原始碼，找出缺翻譯、key 不存在、寫死的文字等問題。'}
          </Text>
        </Box>,
      )
    }

    if (projects.length === 0) {
      return frame(
        <Box flexDirection="column">
          <Text color={C.green} bold>沒有找到 i18n 相關內容</Text>
          <Text color={C.lav}>沒有 locales / i18n / lang 等語系資料夾，也沒有用到 t() 或寫死的中日韓文字。</Text>
        </Box>,
      )
    }

    const index = Math.min(await read($, project), projects.length - 1)
    const current = projects[index]!
    const chosen = await read($, filter)
    const kind = chosen !== 'all' && (current.counts[chosen] ?? 0) > 0 ? chosen : 'all'
    const issues = kind === 'all' ? current.issues : current.issues.filter(issue => issue.kind === kind)
    const localeBarWidth = Math.max(6, Math.min(20, width - 36))
    const isMulti = projects.length > 1

    // Rows taken by everything but the issue list; each issue takes two rows.
    const usedRows = 22 + (isMulti ? 3 : 0) + current.roots.reduce((sum, r) => sum + 1 + r.locales.length, 0)
    const room = Math.max(2, Math.floor((height - usedRows) / 2))
    const start = Math.min(await read($, offset), Math.max(0, issues.length - room))
    const shown = issues.slice(start, start + room)
    const scroll = (delta: number) =>
      update($, offset, n => Math.max(0, Math.min(Math.max(0, issues.length - room), n + delta)))
    const step = (n: number) => (isMulti ? ['①', '②', '③'][n]! : ['', '①', '②'][n]!)

    return frame(
      <Box flexDirection="column">
        {isMulti && (
          <Box flexDirection="column">
            {heading(step(0), '選擇專案', '按數字鍵切換')}
            <Box flexDirection="row" flexWrap="wrap" columnGap={3} paddingLeft={2}>
              {projects.slice(0, 9).map((one, i) => (
                <Button
                  plain
                  hotkey={String(i + 1)}
                  dimColor={i !== index}
                  label={`${i === index ? '▶ ' : ''}${one.name}  ${total(one) === 0 ? '沒有問題' : `${total(one)} 個問題`}`}
                  onPress={async () => {
                    await update($, project, () => i)
                    await update($, offset, () => 0)
                  }}
                />
              ))}
            </Box>
            {rule()}
          </Box>
        )}

        {heading(step(1), '語系檔狀態', `${current.name}（${current.path}，${current.sourceFiles} 個原始檔）`)}
        {current.roots.length === 0 && (
          <Text color={C.gray}>  這個專案沒有自己的語系資料夾，程式裡的 key 會拿整個 repo 的語系檔來比對。</Text>
        )}
        {current.roots.map(root => (
          <Box flexDirection="column" paddingLeft={2}>
            <Box flexDirection="row">
              <Text color={C.white} wrap="truncate-start">{root.path}</Text>
              <Text color={C.gray}>{` · ${root.totalKeys} 個 key`}</Text>
            </Box>
            {root.locales.map(locale => {
              const ratio = root.totalKeys === 0 ? 1 : locale.keys / root.totalKeys
              const b = bar(ratio, localeBarWidth)
              return (
                <Box flexDirection="row">
                  <Text color={C.lav}>{`  ${locale.locale.padEnd(7)}`}</Text>
                  <Text color={hpColor(ratio)}>{b.on}</Text>
                  <Text color={C.gray}>{b.off}</Text>
                  <Text color={hpColor(ratio)}>{` ${String(Math.floor(ratio * 100)).padStart(3)}%  `}</Text>
                  {locale.missing === 0
                    ? <Text color={C.green}>✔ 完整</Text>
                    : <Text color={C.red}>{`缺 ${locale.missing} 個`}</Text>}
                </Box>
              )
            })}
          </Box>
        ))}
        {rule()}

        {total(current) === 0 ? (
          <Box flexDirection="column">
            {heading(step(2), '問題清單')}
            <Text color={C.green} bold>  ★ 沒有發現問題 ★</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            {heading(step(2), '問題清單', '按字母鍵只看某一類')}
            <Box flexDirection="row" flexWrap="wrap" columnGap={3} paddingLeft={2}>
              <Button plain hotkey="a" dimColor={kind !== 'all'} label={`全部 ${total(current)}`} onPress={() => update($, filter, () => 'all')} />
              {KIND_ORDER.filter(k => (current.counts[k] ?? 0) > 0).map(k => (
                <Button
                  plain
                  hotkey={KINDS[k].hotkey}
                  dimColor={kind !== k}
                  label={`${KINDS[k].tag} ${current.counts[k]}`}
                  onPress={async () => {
                    await update($, filter, () => k)
                    await update($, offset, () => 0)
                  }}
                />
              ))}
            </Box>
            <Box paddingLeft={2}>
              <Text color={C.lav}>
                {kind === 'all' ? 'ⓘ 每種標籤的意思：按它的字母鍵就會顯示說明。' : `ⓘ ${KINDS[kind].help}`}
              </Text>
            </Box>
            {shown.map(issue => (
              <Box flexDirection="column" paddingLeft={2}>
                <Box flexDirection="row">
                  <Text color="#000000" backgroundColor={KINDS[issue.kind].color}>{` ${KINDS[issue.kind].tag} `}</Text>
                  <Text wrap="truncate-end">{` ${issue.detail}`}</Text>
                </Box>
                <Text color={C.gray} wrap="truncate-start">{`       ${issue.where}`}</Text>
              </Box>
            ))}
            <Box flexDirection="row" columnGap={3} paddingLeft={2}>
              <Button plain hotkey="k" label="上一頁" onPress={() => scroll(-room)} />
              <Button plain hotkey="j" label="下一頁" onPress={() => scroll(room)} />
              <Text color={C.gray}>{`第 ${issues.length === 0 ? 0 : start + 1}–${start + shown.length} 筆，共 ${issues.length} 筆`}</Text>
            </Box>
            {data.isTruncated && <Text color={C.orange}>  ⚠ 問題太多，每一類只列出前 400 筆（上面的數字是完整總數）</Text>}
          </Box>
        )}
      </Box>,
    )
  })
}
