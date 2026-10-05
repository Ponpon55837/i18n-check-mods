# i18n-check-mods

![version](https://img.shields.io/badge/version-0.1.0-29ADFF) ![license](https://img.shields.io/badge/license-MIT-00E436) ![Claude Code](https://img.shields.io/badge/Claude%20Code-function%20hooks-FFA300)

Claude Code 的 i18n 檢查 mod。`i18n-pixel` 會在 Claude Code 裡開一個 **像素風** 面板，掃描目前專案的語系檔與原始碼，把缺翻譯、參數不一致、程式用的 key 不存在、寫死的中文等問題分類列出來。單一專案、monorepo、一個資料夾放好幾個專案都能處理。

```
╔════════════════════════════════════════════════════════════╗
║ ▀█▀ ▄█  █▀█ █▄ █   i18n 檢查                  r: 重新掃描  ║
║  █   █  █▀█ █ ▀█   monorepo · 2 個專案 · 共 41 個問題      ║
║ ▀▀▀ ▀▀▀ ▀▀▀ ▀  ▀   翻譯覆蓋率 ███████████████░ 97%         ║
║                    掃描 0.1 秒 · 讀取 3 個檔，412 個沒變動 ║
║ ────────────────────────────────────────────────────────── ║
║ ① 選擇專案  按數字鍵切換                                   ║
║   1: ▶ web  29 個問題   2: admin  12 個問題                ║
║ ────────────────────────────────────────────────────────── ║
║ ② 語系檔狀態  web（apps/web，210 個原始檔）                ║
║   apps/web/src/locales · 520 個 key                        ║
║     en-US  ████████████████████ 100%  ✔ 完整               ║
║     ja     ██████████████████░░  91%  缺 47 個             ║
║     zh-TW  ████████████████████ 100%  ✔ 完整               ║
║ ────────────────────────────────────────────────────────── ║
║ ③ 問題清單  按字母鍵只看某一類                             ║
║   a: 全部 29   m: 缺漏 18   u: 無鍵 3   c: 寫死 8          ║
║   ⓘ 寫死的文字：程式碼裡直接寫中日韓文字，沒有走 i18n，    ║
║     切換語系時不會變。                                     ║
║    寫死  <h1>找不到頁面</h1>                               ║
║          apps/web/src/pages/NotFound.vue:4                 ║
║    寫死  return `每週${day} 執行一次`                      ║
║          apps/web/src/utils/schedule.ts:42                 ║
║   k: 上一頁   j: 下一頁   第 1–8 筆，共 8 筆               ║
║ ────────────────────────────────────────────────────────── ║
║ 操作方式：先點一下面板，再按冒號前面的鍵（例如 r）。       ║
╚════════════════════════════════════════════════════════════╝
```

*(終端機畫面示意，專案名稱與數字為範例。實際畫面使用 PICO-8 色盤上色，每種問題有自己的顏色標籤。只有一個專案時不會顯示「① 選擇專案」；桌面版的字型不是等寬，方塊字 LOGO 會換成單行的 `▚▞ I18N ▞▚` 標題。)*

---

## 目錄

- [功能](#功能)
- [需求](#需求)
- [安裝](#安裝)
- [使用方式](#使用方式)
- [設定](#設定)
- [支援的專案結構](#支援的專案結構)
- [檢查項目](#檢查項目)
- [效能](#效能)
- [限制](#限制)
- [安全性](#安全性)
- [開發](#開發)
- [版本與發佈](#版本與發佈)
- [疑難排解](#疑難排解)
- [授權](#授權)

## 功能

- **像素風面板**：方塊字 LOGO 與 PICO-8 配色；內容分成「① 選擇專案 → ② 語系檔狀態 → ③ 問題清單」三塊，全中文標示，每類問題附說明。
- **自動判斷專案型態**：單一專案 / monorepo / 多專案資料夾，每個專案分開計算。
- **多種語系檔格式**：JSON（目錄式或單檔式），以及 `export default {...}` 的 TS / JS 語系檔。
- **十種檢查**：詳見[檢查項目](#檢查項目)。
- **Claude 也能用**：註冊唯讀工具 `i18n_report`，可以直接請 Claude「檢查 i18n 並修好缺的 key」。
- **自動重新掃描**：Claude 用 Edit / Write 改了語系檔或原始碼後，面板會自己更新，而且只重讀有變動的檔案。
- **唯讀、離線**：不寫檔、不執行指令、不連網，見 [SECURITY.md](SECURITY.md)。

## 需求

| 項目 | 版本 |
| --- | --- |
| 作業系統 | **Windows、macOS**（Linux 也可）。CI 在 `windows-latest`、`macos-latest`、`ubuntu-latest` 三個平台都會跑全部檢查 |
| Claude Code | 支援 function hooks 的版本（本 mod 以 **2.1.286** 開發與驗證）。function hooks 目前是 early access，API 可能隨版本變動。 |
| 介面 | 終端機（建議全螢幕版面，寬度 ≥ 144 欄時面板會停靠在側邊）或桌面版 Code 分頁 |
| Node.js | 只有跑開發腳本（`pnpm test` 等）才需要，**22.18 以上**（需要內建的 TypeScript 型別剝除） |
| pnpm | 開發腳本使用 **pnpm 9 以上**。`package.json` 的 `devEngines` 限定 pnpm，用 npm 執行會直接報錯。外掛本身沒有任何相依套件，**使用者安裝外掛不需要 pnpm** |

## 安裝

先把 repo 抓下來：

```bash
git clone https://github.com/ponpon55837/i18n-check-mods.git
```

外掛本體在 `plugins/i18n-pixel`。以下方式擇一，**最簡單的是一行指令安裝**。

### 一行指令安裝（推薦，終端機與桌面版都適用）

```bash
cd i18n-check-mods
```

```bash
pnpm plugin:install
```

腳本會把外掛路徑加進使用者設定檔 `~/.claude/settings.json` 的 `env.CLAUDE_CODE_PLUGIN_DIRS`（Windows：`%USERPROFILE%\.claude\settings.json`），也就是下面方式 B 的手動步驟：

- **作用範圍是全域的**：所有專案、所有 session（終端機與桌面版）都會載入。它不是 `pnpm add -g` 那種套件安裝，只是記下外掛資料夾的路徑，所以 repo 不能刪除或搬走。
- 原本的設定全部保留，修改前會備份成 `settings.json.bak`；重複執行不會重複加入。
- 開一個**新的** session 才會生效，輸入 `/i18n-pixel` 就能使用。
- 更新：在 repo 裡 `git pull`，再開新 session。
- 移除：

```bash
pnpm plugin:uninstall
```

只想在單一專案使用的話，不要跑這個腳本，改用方式 A。

### 方式 A：`--plugin-dir`（只在這次 session 載入，限終端機）

在要檢查的專案目錄裡啟動 Claude Code，並指向外掛資料夾：

```bash
claude --plugin-dir /path/to/i18n-check-mods/plugins/i18n-pixel
```

Windows：

```bash
claude --plugin-dir C:\Users\you\Desktop\github\i18n-check-mods\plugins\i18n-pixel
```

互動式 session 會監看這個資料夾，改了 `register.tsx` 存檔就會熱重載。

### 方式 B：`CLAUDE_CODE_PLUGIN_DIRS`（每個 session 都載入，含桌面版）

桌面 App 或 SDK 啟動的 session 沒辦法加參數，改在 `~/.claude/settings.json`（Windows：`%USERPROFILE%\.claude\settings.json`）的 `env` 裡設定，值是 **絕對路徑**，多個資料夾用平台的路徑分隔符號（macOS / Linux 用 `:`，Windows 用 `;`）：

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "C:\\Users\\you\\Desktop\\github\\i18n-check-mods\\plugins\\i18n-pixel"
  }
}
```

只能寫在使用者層級的 settings，專案層級的 `.claude/settings.json` 不會讀這個變數。改完重新開 session 生效。

### 方式 C：當成 plugin marketplace 加入

repo 根目錄有 `.claude-plugin/marketplace.json`，在 Claude Code 裡：

```
/plugin marketplace add ponpon55837/i18n-check-mods
/plugin install i18n-pixel@i18n-check-mods
```

也可以用本機路徑：`/plugin marketplace add /path/to/i18n-check-mods`。

> function hooks 還在 early access，若你的 Claude Code 版本透過 marketplace 安裝後沒有載入 hooks 模組，請改用方式 A 或 B。

### 確認安裝成功

1. 開一個**新的** session，在輸入框打完整的 `/i18n-pixel` 送出（不要只從 `/` 選單找）。
2. 看到「I18N QUEST 面板已開啟，掃描中…」並出現面板，就是裝好了。
3. 也可以在終端機跑 `claude plugin validate plugins/i18n-pixel`，看到 `✔ Validation passed`。

> `/i18n-pixel` 是外掛在 session 啟動後才註冊的指令。新 session 送出第一則訊息之前，`/` 選單可能還看不到它，直接打完整指令送出即可。另外別跟專案裡可能存在的其他 i18n skill（例如 `/devtools-i18n`）搞混。

### 非互動模式（`claude -p`）

如果 headless 模式沒有載入 function hooks，在該程序的環境變數加上：

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude -p --plugin-dir ./plugins/i18n-pixel "用 i18n_report 檢查這個專案"
```

### 解除安裝

- 一行指令安裝：`pnpm plugin:uninstall`。
- 方式 A：下次啟動不要帶 `--plugin-dir` 即可。
- 方式 B：從 `settings.json` 的 `env.CLAUDE_CODE_PLUGIN_DIRS` 移除路徑。
- 方式 C：`/plugin uninstall i18n-pixel@i18n-check-mods`。

## 使用方式

### 指令

| 指令 | 作用 |
| --- | --- |
| `/i18n-pixel` | 開啟 i18n 檢查面板並在背景掃描 |
| `/i18n-pixel scan` | 只掃描，把文字報告回到對話（Claude 讀得到，可以接著叫它修） |

### 怎麼看面板

面板由上到下分成三塊，照編號往下看：

1. **① 選擇專案**：只有一個以上的專案時才會出現，按數字鍵切換，每個專案旁邊寫著它有幾個問題。
2. **② 語系檔狀態**：這個專案的語系資料夾、總共幾個 key，以及每個語系的覆蓋率；寫「✔ 完整」就是沒缺，否則寫「缺 N 個」。
3. **③ 問題清單**：每筆問題第一行是標籤和內容，第二行是檔案位置。按標籤的字母鍵只看那一類，ⓘ 那行會說明這類問題是什麼、該怎麼處理。

### 面板按鍵

按鍵寫在每個按鈕的冒號前面（例如 `r: 重新掃描`）。面板要先取得焦點才會接收按鍵：點一下面板，或在終端機按 `ctrl+x` 再按 `tab`。`Esc` 回到輸入框。

| 鍵 | 動作 |
| --- | --- |
| `r` | 重新掃描 |
| `1`–`9` | 切換專案 |
| `a` | 顯示全部問題 |
| `m` `p` `e` `s` `x` `f` `o` | 只看：缺漏、參數、空值、未翻、重複、缺檔、壞檔 |
| `u` `d` `c` | 只看：無鍵、動態、寫死 |
| `j` / `k` | 下一頁 / 上一頁 |

### 給 Claude 用

mod 會註冊工具 `mcp__i18n-pixel__i18n_report`（唯讀，參數 `rescan: boolean`）。可以直接說：

> 用 i18n_report 檢查專案，把 zh-CN 缺的 key 補上，翻譯參考 zh-TW。

Claude 改完檔案 2 秒後面板會自動重掃，覆蓋率和問題數會跟著更新。重掃只會重讀有變動的檔案，見[效能](#效能)。

### 狀態列

掃描完成後狀態列會顯示 `i18n 覆蓋率 98% · 問題 12`：整體翻譯覆蓋率與問題總數。

## 設定

| 欄位 | 型別 | 預設 | 說明 |
| --- | --- | --- | --- |
| `includeTests` | boolean | `false` | 硬編碼 CJK 檢查是否包含測試檔（`*.spec.*`、`*.test.*`、`*.stories.*`，以及 `e2e/` `test/` `tests/` `__tests__/` `mocks/` `fixtures/` 底下的檔案）。`t()` key 檢查不受影響，測試檔一律會檢查。 |

用 `--plugin-dir` / `CLAUDE_CODE_PLUGIN_DIRS` 載入時，在 `~/.claude/settings.json` 的 `pluginConfigs` 設定：

```json
{
  "pluginConfigs": {
    "i18n-pixel": { "includeTests": true }
  }
}
```

也可以在 `/config` 選單裡直接切換，改了會自動重載。

## 支援的專案結構

### 專案型態判斷

| 面板顯示 | 判斷條件 |
| --- | --- |
| 單一專案 | 只有 0 或 1 個 `package.json` |
| monorepo | 多個 `package.json`，且根目錄有 `package.json#workspaces`、`pnpm-workspace.yaml`、`lerna.json`、`nx.json`、`turbo.json` 或 `rush.json` |
| 多專案資料夾 | 多個 `package.json`，但沒有 workspace 設定（例如一個 repo 裡放 `frontend/`、`admin-console/` 各自獨立） |

每個檔案歸屬到「離它最近的上層 `package.json`」那個專案。沒有任何語系目錄、也沒有用到 i18n 的專案不會出現在面板上。

**monorepo 共用語系套件**：某個 package 自己沒有語系目錄（例如 app 從 `packages/i18n` 引用），它的 `t()` key 會改用整個 repo 所有語系檔的 key 來比對，不會整片誤報。

### 語系目錄

名稱是 `locales`、`locale`、`i18n`、`lang`、`langs`、`languages`、`translations`、`messages` 的資料夾（不分大小寫），裡面符合下列任一種結構：

```
目錄式（dir）                    單檔式（file）
src/locales/                     src/i18n/locales/
├── en-US/                       ├── en.json      或 en.ts
│   ├── common.json              ├── zh-TW.json   或 zh-TW.ts
│   └── home.json                └── ja.json      或 ja.ts
└── zh-TW/
    ├── common.json
    └── home.json
```

- 語系名稱要像 `en`、`en-US`、`zh_TW`、`zh-Hant-TW`、`es-419`，且語言碼是常見的 ISO 639 代碼。
- 目錄式最多往下讀 2 層子資料夾；同一個語系資料夾裡有 JSON 時只讀 JSON（旁邊的 `index.ts` 通常只是 loader）。
- 如果 `i18n/` 裡面沒有語系檔（只有 `index.ts`），會繼續往下找，例如 `src/i18n/locales/`。

### TS / JS 語系檔

支援這幾種寫法，**以靜態方式解析，不會執行**：

```ts
export default { common: { save: '儲存' } } as const

const messages = { common: { save: '儲存' } }
export default messages

module.exports = { common: { save: '儲存' } }
```

值只能是字面常數（字串、數字、布林、null、物件、陣列；樣板字串不能有 `${}`）。用到 spread（`...base`）、函式呼叫、變數或 import 的檔案會被標成「壞檔」（語系檔讀不到）並指出第幾行。

### `t()` 呼叫

會辨識 `t()`、`$t()`、`tc()`、`$tc()`、`i18n.t()`、`i18n.global.t()`、`i18next.t()`。i18next 的 `ns:key` 會去掉 namespace 再比對；複數 key（`key_one`、`key_other`…）視為同一個 key。

## 檢查項目

| 標籤 | 鍵 | 意思 | 說明 |
| --- | --- | --- | --- |
| 壞檔 | `o` | 語系檔讀不到 | JSON 語法錯誤，或 TS/JS 語系檔不是純字面值 |
| 缺檔 | `f` | 語系檔案不齊 | 目錄式結構中，某語系少了別的語系有的檔案 |
| 缺漏 | `m` | 缺翻譯 | 某語系少了其他語系有的 key（複數後綴除外） |
| 參數 | `p` | 參數不一致 | 同一個 key 在各語系的 `{name}` / `{{name}}` 集合不同 |
| 重複 | `x` | key 重複 | 同一語系中，同一個 key 出現在兩個語系檔 |
| 空值 | `e` | 翻譯是空的 | 值是空白 |
| 未翻 | `s` | 翻譯等於 key | 翻譯值跟 key 一模一樣，通常是忘了翻 |
| 無鍵 | `u` | key 不存在 | `t('a.b')` 的 key 在語系檔裡找不到 |
| 動態 | `d` | key 是組出來的 | `t(變數)`、`` t(`a.${x}`) ``、`t('a.' + x)`，無法自動確認 |
| 寫死 | `c` | 寫死的文字 | 原始碼（不含註解、`console.*`）出現中日韓文字。只在有用 i18n 的專案檢查 |

## 效能

- **第一次掃描**會讀過所有語系檔與原始碼，時間跟檔案總大小成正比（O(n)），這是任何檢查都免不了的下限。
- **之後的重掃只讀有變動的檔案**：列資料夾時就會拿到每個檔案的修改時間與大小，沒變的檔案直接沿用上次的結果。Claude 用 Edit / Write 改過的檔案一定會重讀，不只看修改時間。
- 原始碼快取的是「它呼叫了哪些 key、哪幾行寫死文字」，不是比對結果。所以只改語系檔時，原始碼一個都不用重讀，也能拿新的 key 重新比對。
- key 查詢都用 `Set` / `Map`，每次平均 O(1)。
- 快取只存在這個 session 的記憶體裡；開新 session 或外掛重新載入時，會重新完整掃描一次。

在一個約 700 個檔、含兩個 Vue 專案的 repo 上實測（Windows）：第一次掃描 406ms，沒變動再掃 103ms、讀取 0 個檔。剩下的時間花在列資料夾，用來發現新增或刪除的檔案。自己的專案可以這樣量（只讀不寫）：

```bash
node scripts/verify-scanner.mjs <專案路徑> --bench
```

面板頂端也會顯示上次掃描讀了幾個檔、幾個沿用上次結果。

## 限制

- 每種問題每個專案最多保留 400 筆、原始碼最多掃 8,000 個檔、資料夾最多 9 層；超過時面板會提示「每一類只列出前 400 筆」，上面的數字仍是完整總數。
- 只讀 JSON 與 TS/JS 語系檔；YAML、`.po`、`.properties`、`.arb` 尚不支援。
- 只認得 `package.json` 當專案邊界；.NET、Go、Python 等其他語言的專案會被當成同一個專案。
- 硬編碼檢查以行為單位、用正規表示式剝除註解，字串裡剛好含 `//` 的行可能漏抓。
- 面板 UI 依 Claude Code function hooks 的元件繪製，終端機與桌面版外觀略有差異。

## 安全性

唯讀、離線、不執行語系檔內容。完整說明、讀取範圍與自動化安全檢查見 [SECURITY.md](SECURITY.md)。

## 開發

```
i18n-check-mods/
├── .claude-plugin/marketplace.json     marketplace 定義
├── plugins/i18n-pixel/                 外掛本體
│   ├── .claude-plugin/plugin.json      manifest（版本、userConfig）
│   ├── hooks/hooks.json                指向 hooks 模組
│   ├── hooks/register.tsx              掃描器 + 面板 + 指令 + 工具
│   └── types/index.d.ts                $.state 的型別契約
├── scripts/
│   ├── install.mjs                     一行指令安裝 / 移除
│   ├── verify-scanner.mjs              用 Node 跑掃描器並驗證 fixtures（含增量重掃）
│   ├── verify-install.mjs              在暫存設定資料夾測試安裝腳本
│   ├── security-check.mjs              API 白名單與原始碼安全檢查
│   └── check-versions.mjs              版本一致性檢查
├── test/fixtures/                      monorepo / 單一專案 / CRLF 測試資料
└── .github/workflows/ci.yml            CI
```

常用指令：

```bash
pnpm check
```

| 指令 | 內容 |
| --- | --- |
| `pnpm test` | 用 fixtures 驗證掃描器（monorepo、單一專案、TS 語系檔、`includeTests`、CRLF 換行、增量重掃：沒變不讀、只重讀改過的檔、語系檔變動後原始碼重新比對、刪檔），並在暫存設定資料夾測試安裝腳本（合併既有設定、重複執行、移除後還原、無設定檔、壞掉的 JSON 不動） |
| `pnpm security` | `claude plugin validate` + API 白名單 + 原始碼禁用模式 + manifest 檢查 |
| `pnpm versions` | 檢查 `plugin.json`、`marketplace.json`、`package.json`、`CHANGELOG.md` 版本一致 |
| `pnpm validate` | 只跑 `claude plugin validate` |
| `node scripts/verify-scanner.mjs <資料夾>` | 不開 Claude Code，直接印出任一資料夾的掃描報告 |
| `node scripts/verify-scanner.mjs <資料夾> --bench` | 量第一次掃描和沒變動再掃的時間與讀檔數（只讀不寫） |

開發時用方式 A 載入，存檔就會熱重載；`claude --debug` 可以看到被引擎拒絕的 hook 與原因。

### 行尾符號

repo 的 `.gitattributes` 設定 `* text=auto eol=lf`，所有文字檔在 Windows checkout 也維持 LF，不受 `core.autocrlf=true` 影響。唯一例外是 `test/fixtures/single/src/views/Crlf.vue`，它刻意保持 CRLF 用來測試掃描器處理 Windows 換行。

如果你在加入 `.gitattributes` 之前就 clone 過，執行一次重新正規化：

```bash
git add --renormalize .
```

## 版本與發佈

版本號遵循 [SemVer](https://semver.org/lang/zh-TW/)：

- **MAJOR**：指令、工具名稱或設定欄位有不相容的變更
- **MINOR**：新增檢查項目、支援新格式、新增設定
- **PATCH**：修正誤判、修 bug、文件

發佈步驟：

1. 更新 `plugins/i18n-pixel/.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json`（兩處）、`package.json` 的 `version`。
2. 在 `CHANGELOG.md` 把 `[Unreleased]` 的內容移到新的 `## [x.y.z] - YYYY-MM-DD`，並更新底部連結。
3. 執行 `pnpm check`，全部通過。
4. commit、打 tag 並推上去：

```bash
git tag v0.1.0
```

```bash
git push origin main --tags
```

用 marketplace 安裝的使用者執行 `/plugin marketplace update i18n-check-mods` 取得新版。

## 疑難排解

| 狀況 | 處理 |
| --- | --- |
| `/` 選單看不到 `/i18n-pixel` | 新 session 送出第一則訊息前選單可能還沒有它，直接打完整指令送出；已經開著的舊 session 不會載入新安裝的外掛，要開新的 |
| 打了 `/i18n-pixel` 說找不到指令 | 確認路徑指到 `plugins/i18n-pixel`（不是 repo 根目錄）；跑 `claude plugin validate` 看有沒有錯誤；用 `claude --debug` 看載入訊息 |
| 面板沒出現 | 終端機寬度小於 144 欄時面板會以內嵌方式開啟；用 `/i18n-pixel` 主動開啟一定會顯示 |
| 快捷鍵沒反應 | 面板要先取得焦點：點一下面板，或 `ctrl+x` 再 `tab` |
| LOGO 歪掉 | 方塊字 LOGO 需要等寬字型，只在終端機顯示；終端機上還是歪的話，請確認終端機字型是等寬字型 |
| 顯示「沒有找到 i18n 相關內容」 | 語系資料夾名稱不在支援清單，或語系檔名不是語系代碼；見[語系目錄](#語系目錄) |
| 「無鍵」大量誤報 | 該專案的語系檔沒被找到，用 `node scripts/verify-scanner.mjs <專案路徑>` 看偵測到哪些語系目錄 |
| TS 語系檔顯示「壞檔」 | 檔案用了 spread / import / 函式呼叫，改成純字面值或轉成 JSON |
| 「寫死」太多 | 測試檔預設已排除；沒用 i18n 的專案不會檢查；確認 `includeTests` 沒開 |
| Git 提示 LF 會被轉成 CRLF | 已由 `.gitattributes` 處理；舊 clone 執行 `git add --renormalize .` |

## 授權

[MIT](LICENSE)
