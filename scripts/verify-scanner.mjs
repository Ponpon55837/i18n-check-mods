// Runs the scanner half of plugins/i18n-pixel/hooks/register.tsx under Node against the
// fixtures in test/fixtures, with `$` stubbed by node:fs, and checks what it reports.
// Usage: node scripts/verify-scanner.mjs            (needs Node 22.18+ for TypeScript stripping)
//        node scripts/verify-scanner.mjs <folder>   (prints the report for any folder, no checks)
//        node scripts/verify-scanner.mjs <folder> --bench   (times a cold scan and an unchanged rescan; read-only)
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(repo, 'plugins/i18n-pixel/hooks/register.tsx'), 'utf8')

const cut = (from, to) => {
  const a = source.indexOf(from)
  const b = source.indexOf(to)
  assert.ok(a >= 0 && b > a, `markers not found: ${from} .. ${to}`)
  return source.slice(a, b)
}

const harness = `
import fsp from 'node:fs/promises'
import path from 'node:path'
type EngineInterface = any; type Issue = any; type IssueKind = any
type RootReport = any; type ProjectReport = any; type I18nReport = any
const ROOT = process.argv[2]
const settings = { includeTests: process.argv[3] === 'tests' }
const $ = {
  fs: {
    // Like the engine's listing: a regular file's size and mtime, 0 for everything else.
    list: async (p: string) => Promise.all((await fsp.readdir(path.resolve(ROOT, p), { withFileTypes: true })).map(async d => {
      const isFile = d.isFile() && !d.isSymbolicLink()
      const stat = isFile ? await fsp.stat(path.resolve(ROOT, p, d.name)) : undefined
      return {
        name: d.name, kind: d.isSymbolicLink() ? 'other' : d.isDirectory() ? 'dir' : isFile ? 'file' : 'other',
        size: stat?.size ?? 0, mtimeMs: stat?.mtimeMs ?? 0, isLink: d.isSymbolicLink(),
      }
    })),
    read: (p: string) => fsp.readFile(path.resolve(ROOT, p), 'utf8'),
  },
  clock: { now: async () => Date.now() },
  session: { cwd: async () => ROOT },
}
async function setPhase(_: unknown, _text: string) {}
${cut('// ─── Scanner', '// ─── Scan lifecycle')}
${cut('function total(', '// ─── Hooks')}
if (process.argv[4] === 'incremental') {
  // Scans one folder (a scratch copy) again and again, changing it in between, in one process,
  // so the caches carry over as they do in a session.
  const steps: any[] = []
  const view = path.join(ROOT, 'src/views/Main.tsx')
  steps.push(await scan($)) // 0: cold
  steps.push(await scan($)) // 1: nothing changed
  await fsp.appendFile(view, "\\nexport const Z = () => t('a.zzz')\\n")
  steps.push(await scan($)) // 2: a source file changed
  for (const name of ['en.json', 'zh-TW.json']) {
    const file = path.join(ROOT, 'src/locales', name)
    const data = JSON.parse(await fsp.readFile(file, 'utf8'))
    data.a.zzz = 'Z'
    await fsp.writeFile(file, JSON.stringify(data))
  }
  steps.push(await scan($)) // 3: catalogs changed, sources did not
  forget(path.join(ROOT, 'src', 'locales', 'en.json'))
  steps.push(await scan($)) // 4: a tool wrote a file without changing its stamp
  await fsp.rm(view)
  steps.push(await scan($)) // 5: a source file was deleted
  console.log(JSON.stringify(steps))
} else if (process.argv[4] === 'bench') {
  // Read-only: a cold scan, then a rescan with nothing changed.
  const cold = await scan($)
  const warm = await scan($)
  for (const [name, one] of [['第一次掃描', cold], ['沒變動再掃', warm]] as const) {
    console.log(\`\${name}：\${Math.round(one.durationMs)}ms，讀取 \${one.readFiles} 個檔，沿用快取 \${one.cachedFiles} 個\`)
  }
} else {
  const result = await scan($)
  console.log(process.argv[4] === 'json' ? JSON.stringify(result) : summarize(result))
}
`

const file = path.join(os.tmpdir(), `i18n-pixel-harness-${process.pid}.mts`)
fs.writeFileSync(file, harness)
const run = (dir, ...flags) => execFileSync(process.execPath, [file, dir, ...flags], { encoding: 'utf8' })

try {
  if (process.argv[2]) {
    console.log(run(path.resolve(process.argv[2]), 'no-tests', process.argv[3] === '--bench' ? 'bench' : 'text'))
    process.exit(0)
  }

  const fixtures = path.join(repo, 'test/fixtures')
  const byName = report => Object.fromEntries(report.projects.map(p => [p.name, p]))
  const has = (project, kind, text) => project.issues.some(i => i.kind === kind && (i.detail.includes(text) || i.where.includes(text)))

  // Monorepo: workspaces in the root package.json, three packages.
  const mono = JSON.parse(run(path.join(fixtures, 'monorepo'), 'no-tests', 'json'))
  assert.equal(mono.mode, 'monorepo')
  const { web, admin, docs } = byName(mono)
  assert.equal(docs, undefined, 'a package without i18n is not reported')

  assert.equal(web.roots.length, 1)
  assert.equal(web.roots[0].layout, 'dir')
  assert.ok(has(web, 'file-set', 'home.json'), 'zh-TW lacks home.json')
  assert.ok(has(web, 'missing', 'common.only'))
  assert.ok(has(web, 'missing', 'home.title'))
  assert.ok(has(web, 'missing', 'common.raw'))
  assert.ok(has(web, 'placeholder', 'common.greet'))
  assert.ok(has(web, 'empty', 'common.blank'))
  assert.ok(has(web, 'same-as-key', 'common.raw'))
  assert.ok(has(web, 'unknown-key', 'common.nope'))
  assert.ok(!has(web, 'unknown-key', 'common.save'))
  assert.equal(web.counts['dynamic-key'], 2, 'template literal and concatenation')
  assert.equal(web.counts.hardcoded, 1, 'only the <h1>: comments and the spec file are skipped')
  assert.ok(has(web, 'hardcoded', '硬編碼標題'))

  assert.equal(admin.roots[0].layout, 'file')
  assert.deepEqual(admin.roots[0].locales.map(l => l.locale), ['en', 'ja', 'zh-TW'])
  assert.ok(has(admin, 'json', 'ja.ts'), 'a spread cannot be read statically')
  assert.ok(has(admin, 'missing', 'menu.roles'))
  assert.ok(has(admin, 'unknown-key', 'menu.ghost'))
  assert.ok(!has(admin, 'unknown-key', 'menu.users'))
  assert.ok(!has(admin, 'placeholder', 'count'))

  // With test files included, the spec's text shows up too.
  const withTests = byName(JSON.parse(run(path.join(fixtures, 'monorepo'), 'tests', 'json')))
  assert.equal(withTests.web.counts.hardcoded, 2)

  // Single project: one package.json, i18next-style plurals and {{placeholders}}.
  const single = JSON.parse(run(path.join(fixtures, 'single'), 'no-tests', 'json'))
  assert.equal(single.mode, 'single')
  const [only] = single.projects
  assert.equal(only.counts.missing ?? 0, 0, 'n_one is a plural form, not a missing key')
  assert.equal(only.counts.placeholder ?? 0, 0)
  assert.ok(has(only, 'unknown-key', 'a.c'))
  assert.ok(!has(only, 'unknown-key', 'a.b'))
  // Crlf.vue is checked out with CRLF: comments must still be skipped, the text still found.
  assert.ok(fs.readFileSync(path.join(fixtures, 'single/src/views/Crlf.vue'), 'utf8').includes('\r\n'), 'Crlf.vue lost its CRLF')
  assert.equal(only.issues.filter(i => i.kind === 'hardcoded').map(i => i.where).join(), 'src/views/Crlf.vue:4')

  // Incremental rescans, on a scratch copy of the single-project fixture.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-pixel-incremental-'))
  try {
    fs.cpSync(path.join(fixtures, 'single'), scratch, { recursive: true })
    const steps = JSON.parse(run(scratch, 'no-tests', 'incremental'))
    const unknown = step => steps[step].projects[0].issues.filter(i => i.kind === 'unknown-key').map(i => i.detail).sort()
    // package.json, en.json, zh-TW.json, Main.tsx, Crlf.vue
    assert.deepEqual([steps[0].readFiles, steps[0].cachedFiles], [5, 0], 'cold scan reads everything')
    assert.deepEqual([steps[1].readFiles, steps[1].cachedFiles], [0, 5], 'unchanged rescan reads nothing')
    assert.deepEqual(steps[1].projects, steps[0].projects, 'cached rescan reports the same as a cold one')
    assert.equal(steps[2].readFiles, 1, 'only the edited source is read')
    assert.deepEqual(unknown(2), ['a.c', 'a.zzz'])
    assert.equal(steps[3].readFiles, 2, 'only the two edited catalogs are read, no source')
    assert.deepEqual(unknown(3), ['a.c'], 'cached sources are re-checked against the new keys')
    assert.equal(steps[4].readFiles, 1, 'forget() makes a file be read again')
    assert.equal(steps[5].readFiles, 0, 'a deletion needs no read')
    assert.deepEqual(unknown(5), [], 'issues of a deleted file are gone')
    assert.equal(steps[5].projects[0].sourceFiles, 1)
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }

  console.log('✔ scanner checks passed (monorepo, single project, TS catalogs, test-file option, incremental rescans)')
} finally {
  fs.rmSync(file, { force: true })
}
