# Changelog

本專案依循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/) 格式，版本號採用 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

## [Unreleased]

## [0.1.0] - 2026-10-05

### Added

- `i18n-pixel` mod：像素風（PICO-8 色盤）i18n 檢查面板，分成「① 選擇專案 → ② 語系檔狀態 → ③ 問題清單」三塊，全中文標示，每類問題附說明。
- `/i18n-pixel` 開啟面板並掃描；`/i18n-pixel scan` 只掃描，結果以文字回到對話。
- Claude 可呼叫的唯讀工具 `mcp__i18n-pixel__i18n_report`。
- 專案型態自動判斷：單一專案、monorepo（`workspaces`、`pnpm-workspace.yaml`、`lerna.json`、`nx.json`、`turbo.json`、`rush.json`）、多專案資料夾（多個 `package.json`、沒有 workspace 設定）。
- 語系檔格式：`<locale>/*.json`（目錄式）、`<locale>.json`（單檔式），以及 `export default {...}` / `module.exports = {...}` 的 `.ts` / `.js` 語系檔（靜態解析，不執行）。
- 檢查項目：catalog 檔案不齊、缺 key、placeholder 不一致、同語系跨 catalog 重複 key、空字串、值等於 key、`t()` key 不存在、動態 key、硬編碼 CJK 文字、無法讀取的 catalog。
- 設定項 `includeTests`：硬編碼檢查是否包含測試檔（預設不含）。
- Claude 用 Edit / Write 修改語系檔或原始碼後，2 秒後自動重新掃描。
- 增量重掃：依檔案修改時間與大小快取，只重讀有變動的檔案；原始碼快取萃取結果，語系檔變動時不需重讀原始碼即可重新比對。
- 方塊字 LOGO 只在終端機顯示（每列一整段字串、不換行空白，避免跑版）；桌面版等介面改用單行標題。
- 一行安裝：`pnpm plugin:install` / `pnpm plugin:uninstall`，把外掛路徑寫入使用者設定的 `CLAUDE_CODE_PLUGIN_DIRS`（先備份、保留原設定）。
- 開發腳本：`pnpm test`（掃描器 fixture 與安裝腳本測試）、`pnpm security`（安全檢查）、`pnpm versions`（版本一致性）。
- GitHub Actions CI：Windows、macOS、Ubuntu 三平台，含行尾符號檢查。

[Unreleased]: https://github.com/ponpon55837/i18n-check-mods/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ponpon55837/i18n-check-mods/releases/tag/v0.1.0
