export type IssueKind =
  | 'json'
  | 'file-set'
  | 'missing'
  | 'placeholder'
  | 'empty'
  | 'same-as-key'
  | 'duplicate'
  | 'unknown-key'
  | 'dynamic-key'
  | 'hardcoded'

export type Issue = { kind: IssueKind; where: string; detail: string }

export type LocaleStat = { locale: string; keys: number; missing: number }

export type RootReport = {
  path: string
  layout: 'dir' | 'file'
  locales: LocaleStat[]
  totalKeys: number
}

export type ProjectReport = {
  name: string
  path: string
  roots: RootReport[]
  sourceFiles: number
  counts: Partial<Record<IssueKind, number>>
  issues: Issue[]
}

export type I18nReport = {
  cwd: string
  mode: 'monorepo' | 'multi' | 'single'
  projects: ProjectReport[]
  durationMs: number
  /** Files read this scan; the rest were unchanged since the last one and came from the cache. */
  readFiles: number
  cachedFiles: number
  isTruncated: boolean
}

export type Phase = { kind: 'idle' | 'scanning' | 'done' | 'error'; text: string }

declare module 'claude-code' {
  interface PluginState {
    'i18n-pixel': {
      report: I18nReport | null
      phase: Phase
      project: number
      filter: IssueKind | 'all'
      offset: number
    }
  }
}
