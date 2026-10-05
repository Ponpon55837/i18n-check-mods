# 安全性說明

## 這個 mod 能做什麼、不能做什麼

`i18n-pixel` 是 **唯讀、離線** 的檢查工具。它在 Claude Code 的 function hooks 沙箱裡執行（沒有 Node、沒有 DOM），所有對外的動作都必須透過引擎提供的 `$` 介面，而它只用到下列呼叫：

| 呼叫 | 用途 |
| --- | --- |
| `$.fs.list`、`$.fs.read` | 列出資料夾、讀取語系檔與原始碼 |
| `$.session.cwd` | 取得目前工作目錄 |
| `$.clock.now`、`$.clock.after` | 計時、在背景排程掃描 |
| `$.state.get`、`$.state.set` | 存放這個 session 的掃描結果給面板讀取 |
| `$.command.register`、`$.tool.register` | 註冊 `/i18n-pixel` 指令與唯讀工具 `i18n_report` |
| `$.ui.open`、`$.ui.resolve`、`$.ui.status` | 開面板、畫面板、更新狀態列 |

它 **不會**：

- 寫入、修改或刪除任何檔案（沒有 `$.fs.write`）
- 執行任何指令或子程序（沒有 `$.process`）
- 連線到網路（沒有 `fetch`、沒有遠端 URL）
- 執行語系檔裡的程式碼：`.ts` / `.js` 語系檔是用內建的字面值解析器讀成資料，遇到 spread、函式呼叫或 import 只會回報「無法讀取」，不會 `eval`
- 跨 session 保存資料（沒有 `$.store`），也不改設定、不送 prompt、不改對話內容

它掛了一個 **觀察用** 的 `tool.call` hook：在 Edit / Write / MultiEdit 執行**之後**看檔名決定要不要重新掃描，永遠原封不動地把結果交回，不會改寫、阻擋任何工具呼叫。

## 讀取範圍

- 只從工作目錄往下走，最多 9 層；不跟隨 symbolic link。
- 略過 `node_modules`、`dist`、`build`、`out`、`coverage`、`bin`、`obj`、`vendor`、`playwright-report`、`test-results`、`storybook-static` 與所有 `.` 開頭的資料夾（如 `.git`、`.github`）；`.env` 這類設定檔不在讀取的副檔名內，不會被讀。
- 只讀 `.json` 語系檔與 `.vue` `.svelte` `.js` `.jsx` `.ts` `.tsx` `.mjs` `.cjs` `.mts` `.cts` 原始碼，最多 8,000 個；單檔超過 4 MiB 會被引擎拒絕讀取。
- 掃描結果只存在記憶體（`$.state`），關掉 session 就消失。回報給 Claude 的文字報告會進入對話內容，跟你自己貼程式碼給 Claude 的範圍相同。

## 自動化安全檢查

```bash
pnpm security
```

[`scripts/security-check.mjs`](scripts/security-check.mjs) 會：

1. 執行 `claude plugin validate`，由引擎讀出模組實際呼叫的每一個 `$` API，任何不在上表白名單的呼叫都會讓檢查失敗。
2. 掃描外掛原始碼，禁止 `eval`、`new Function`、`fetch`、`XMLHttpRequest` / `WebSocket`、動態 `import()`、`$.fs.write`、`$.process` 與寫死的遠端 URL。
3. 確認 `plugin.json` 沒有宣告 MCP server、LSP server、依賴、指令或 agent，`hooks.json` 只有 function-hook 模組（沒有會執行 shell 的 command hooks）。

CI（[`.github/workflows/ci.yml`](.github/workflows/ci.yml)）在每次 push 與 PR 都會跑這項檢查。

## 安裝前自己檢查

外掛就是幾個純文字檔，安裝前可以直接讀過：

- [`plugins/i18n-pixel/hooks/register.tsx`](plugins/i18n-pixel/hooks/register.tsx)：全部邏輯
- [`plugins/i18n-pixel/.claude-plugin/plugin.json`](plugins/i18n-pixel/.claude-plugin/plugin.json)：manifest
- [`plugins/i18n-pixel/hooks/hooks.json`](plugins/i18n-pixel/hooks/hooks.json)：只指向上面那個模組

也可以自己跑 `claude plugin validate plugins/i18n-pixel`，它會列出模組掛了哪些事件、呼叫了哪些 API。

## 回報漏洞

請 **不要** 開公開 issue。請透過 GitHub 的 [Private vulnerability reporting](https://github.com/ponpon55837/i18n-check-mods/security/advisories/new) 回報，附上重現步驟與影響範圍。

| 版本 | 是否支援安全修正 |
| --- | --- |
| 0.1.x | ✅ |
