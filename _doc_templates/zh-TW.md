<div align="center">

<h1>Gemini2API Plugin</h1>
<h3>Gemini Cookie 保活瀏覽器擴充功能</h3>
<p>定時檢測中轉站帳號狀態，過期時以本地瀏覽器（住宅 IP）自動重新整理並提交新 Cookie，協助突破 2 小時限制、保持長期在線。</p>

<p>
  <img src="https://img.shields.io/badge/Manifest-V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="MV3">
  <img src="https://img.shields.io/badge/Chrome%20%7C%20Edge-Latest-1a73e8?style=flat-square&logo=googlechrome&logoColor=white" alt="Browser">
  <img src="https://img.shields.io/badge/JavaScript-ES%20Module-f7df1e?style=flat-square&logo=javascript&logoColor=black" alt="JS">
  <img src="https://img.shields.io/badge/%E4%BE%9D%E8%B5%96-%E9%9B%B6-success?style=flat-square" alt="No deps">
  <img src="https://img.shields.io/badge/License-Non--Commercial-red?style=flat-square" alt="License">
</p>

<p>📦 主專案：<a href="https://github.com/xwteam/gemini2api"><b>gemini2api</b></a>（Gemini Web 反向代理）· 本擴充功能是其 Cookie 保活配套工具</p>

<p>
  <a href="#-工作原理">工作原理</a> &bull;
  <a href="#-核心特性">核心特性</a> &bull;
  <a href="#-安裝">安裝</a> &bull;
  <a href="#-配置說明">配置說明</a> &bull;
  <a href="#-多帳號使用">多帳號使用</a> &bull;
  <a href="#-介面說明">介面說明</a> &bull;
  <a href="#-權限說明">權限說明</a> &bull;
  <a href="#-常見問題">常見問題</a> &bull;
  <a href="#-已知限制">已知限制</a>
</p>

<p>
  📖 文檔語言：<a href="../zh-CN/README.md">简体中文</a> | 繁體中文 | <a href="../en/README.md">English</a> | <a href="../ja/README.md">日本語</a> | <a href="../ko/README.md">한국어</a>
</p>

</div>

---

> [!NOTE]
> 本擴充功能是 [Gemini2API](https://github.com/xwteam/gemini2api) 的配套工具，僅供研究和學習用途，請合理使用，不要用於任何商業目的。

> [!WARNING]
> 本擴充功能與 Google 無關。透過瀏覽器擴充功能讀取 Gemini 登入 Cookie 實現功能，可能不符合 Google 服務條款。使用風險自負，作者不對任何帳號處罰或資料遺失承擔責任。

> [!IMPORTANT]
> 本擴充功能**不保證 100% 突破 2 小時限制**。它將對 Google 工作階段的干擾降到最低（被動回應、過期才重新整理一次），但本地瀏覽器與中轉站共用同一帳號工作階段，實際效果需安裝後觀察。歡迎透過 [Issue](https://github.com/xwteam/gemini2api-plugin/issues) 分享你的實測結果。

---

## 💡 工作原理

中轉站部署在資料中心 IP 上，Google 對這類 IP 的登入工作階段約 2 小時強制失效。但**你本地瀏覽器跑在住宅 IP 上，同一帳號的工作階段能存活更久**。本擴充功能正是利用這一點：

```
每隔 N 秒 → GET /admin/status 查中轉站帳號狀態
  ├─ active（活動）   → 什麼都不做
  └─ expired（過期）  → 重新整理本地已開啟的 gemini.google.com 分頁
                       → chrome.cookies 讀取新的 __Secure-1PSID / __Secure-1PSIDTS
                       → PUT /admin/accounts/{id}/cookies 提交給中轉站
                       → 下一輪輪詢驗證是否恢復 active
```

平時擴充功能只靜默輪詢、不操作瀏覽器；**只有檢測到過期才重新整理一次**，並設冷卻期防止重複重新整理，把對 Google 工作階段的干擾降到最低。

## 🌟 核心特性

- **被動回應**：平時零打擾，僅在帳號過期時才動作，不主動搶占 Cookie 輪換
- **讀取 HttpOnly Cookie**：借助擴充功能的 `chrome.cookies` 權限讀取網頁 JS 讀不到的 `__Secure-` 認證 Cookie
- **靜默重新整理**：自動重新整理已開啟的 Gemini 分頁，無需手動操作
- **按帳號提交 + 防串號**：填了帳號 ID 就按帳號直接提交新 Cookie（這是保活關鍵——Cookie 變了也能提交覆蓋）；沒填帳號 ID 時靠本地 PSID 自動匹配帳號，避免多帳號串號
- **冷卻防抖**：同一帳號重新整理後進入冷卻期，避免連續多輪重複打架
- **側邊欄常駐**：以瀏覽器右側固定側邊欄展示，操作時不消失，方便長時間盯著保活狀態和動作日誌
- **多語言介面**：擴充功能 UI 與日誌自動跟隨 Chrome 瀏覽器語言（簡中 / 繁中 / 英 / 日 / 韓），與文檔語言一致
- **零依賴**：純原生 JavaScript + Manifest V3，無需建置、無第三方函式庫
- **隱私安全**：API Key 與 Cookie 只存本地、只發往你配置的中轉站

## 📦 安裝

> [!TIP]
> 適用於 Chrome、Edge 等 Chromium 核心瀏覽器。

1. 下載/複製本倉庫到本地
2. 開啟擴充功能管理頁：Chrome 為 `chrome://extensions`，Edge 為 `edge://extensions`
3. 開啟右上角的 **開發人員模式**
4. 點擊 **載入未封裝項目**，選擇本專案根目錄
5. 安裝後點擊擴充功能圖示 → 在右側開啟側邊欄：
   - 頂部 **綁定本瀏覽器負責的帳號 ID**（如 `account-0`）
   - 右上角 **中轉站設定** 填寫地址和 API Key（見下文）

## ⚙ 配置說明

### 側邊欄（本瀏覽器實例）

| 配置項 | 說明 |
|--------|------|
| **帳號 ID** | **強烈建議填寫**（如 `account-0`）。一個瀏覽器實例只保活一個帳號，在此綁定；多帳號時每個瀏覽器設定檔各填各的 |

填寫後點 **綁定**。留空則靠 PSID 自動匹配（精度較低，不推薦多帳號場景）。

### 中轉站設定頁

| 配置項 | 說明 |
|--------|------|
| **中轉站地址** | 你的 Gemini2API 地址，如 `http://1.2.3.4:5918` |
| **API Key** | 中轉站的 `sk-` 開頭金鑰；若 gemini2api ≥ v1.6.16 配置了獨立 `ADMIN_API_KEY`，此處應填**管理金鑰** |
| **輪詢間隔** | 多久查一次狀態，預設 60 秒，最小 30 秒 |
| **重新整理冷卻** | 同一帳號重新整理後多久內不重複處理，預設 120 秒 |

填好後點 **測試連線** 確認能連上中轉站，再點 **儲存**（儲存時瀏覽器會請求存取該中轉站網域的權限，請點允許）。

> [!NOTE]
> **gemini2api 版本相容**：v1.6.16 起 `/admin/status` 對 PSID 脫敏返回。未填帳號 ID 時擴充功能用 PSID 首尾片段自動匹配。**強烈建議始終填寫帳號 ID**，最可靠且避免串號。

> [!IMPORTANT]
> **一個瀏覽器實例只能保活一個帳號。** 瀏覽器對 `gemini.google.com` 只有一份 Cookie，擴充功能讀到的永遠是當前登入的那個帳號。所以：
> - 瀏覽器裡要**常開一個已登入的 `gemini.google.com` 分頁**，且登入的就是你要保活的那個帳號。
> - **強烈建議用獨立的瀏覽器環境專門跑保活**（獨立使用者設定檔 / 無痕視窗 / 指紋瀏覽器），不要和你日常登入其它 Google 帳號的瀏覽器混用，否則重新整理時會讀到錯誤帳號、造成串號或互相干擾。
> - 在側邊欄頂部**綁定本瀏覽器負責的帳號 ID**（多帳號時每個設定檔各綁一個，不要共用）
> - 分頁或瀏覽器關閉後，該帳號過期將無法自動修復。

## 👥 多帳號使用

中轉站有多個帳號時，**每個帳號用一個獨立瀏覽器環境分別登入、各裝一個本擴充功能**：

| 帳號 | 瀏覽器環境 | 登入的 Google 帳號 |
|------|-----------|-------------------|
| account-0 | Chrome 設定檔 A / 指紋瀏覽器視窗 1 | 帳號 0 的 Google |
| account-1 | Chrome 設定檔 B / 指紋瀏覽器視窗 2 | 帳號 1 的 Google |
| …… | …… | …… |

每個環境裡的擴充功能：**中轉站設定**填同一個地址和 API Key；**側邊欄頂部**各綁不同的帳號 ID（如 A 綁 `account-0`、B 綁 `account-1`）。這樣多個瀏覽器各管各的帳號，互不干擾。

> [!TIP]
> 推薦用 Chrome 的「使用者 / 設定檔」功能或指紋瀏覽器，為每個帳號開一個完全隔離的環境，Cookie 互不影響。無痕視窗也可，但關閉即失效、需重新登入。

## 🖥 介面說明

點擊工具列圖示會在瀏覽器**右側開啟固定側邊欄**（常駐不消失，方便長時間盯著保活狀態和日誌）。

- **側邊欄面板**：頂部綁定本瀏覽器負責的**帳號 ID**；下方顯示帳號活動/過期狀態、PSID 打碼預覽、最近動作日誌；`立即檢查` / `強制重新整理提交`；右上角 **中轉站設定** 進入連線配置頁。
- **本地 Cookie 區**：顯示本地瀏覽器當前讀到的 `__Secure-1PSID` / `__Secure-1PSIDTS`（預設打碼，可點 `👁 顯示完整` 看全值），並提示是否與中轉站帳號匹配——方便排查「到底有沒有讀到 Cookie、是不是對的帳號」。
- **圖示角標**：
  - 藍色數字 = 活動帳號數
  - 紅色數字 = 過期帳號數
  - `!` = 連線中轉站失敗

## 🔐 權限說明

| 權限 | 用途 |
|------|------|
| `cookies` + `*://*.google.com/*` | 讀取 Gemini 的 HttpOnly 認證 Cookie |
| `tabs` | 查找並重新整理 gemini.google.com 分頁 |
| `storage` | 儲存配置與動作日誌 |
| `alarms` | 定時輪詢 |
| 中轉站網域權限 | 儲存設定時按你填寫的地址動態申請 |

> [!NOTE]
> **隱私承諾**：API Key 和讀取到的 Cookie 僅儲存在本地瀏覽器，且只發送給你配置的中轉站地址，絕不發往任何第三方。

## ❓ 常見問題

**Q：擴充功能提示「未找到 gemini.google.com 分頁」？**
A：請在瀏覽器裡開啟並登入 https://gemini.google.com ，保持該分頁常開。

**Q：重新整理後仍讀不到 Cookie？**
A：說明本地瀏覽器當前也未登入 Gemini，或登入的不是中轉站使用的帳號。請重新登入。

**Q：狀態一直顯示過期、提交後不恢復？**
A：可能是 Google 已吊銷該帳號的主工作階段（PSID 被吊銷無法靠重新整理恢復）。此時需要重新登入 Gemini 獲取全新 Cookie。

**Q：會不會讓帳號被封？**
A：擴充功能採用被動模式、操作頻率極低，但任何非官方方式都有風險，請自行評估。

**Q：多帳號會不會把 A 帳號的 Cookie 提交給 B 帳號（串號）？**
A：不會。擴充功能提交前會用本地 PSID 與目標帳號比對，對不上直接拒絕。但前提仍是**一個瀏覽器只登入一個帳號**，多帳號請用獨立瀏覽器環境分別跑（見「多帳號使用」）。

## ⚠ 已知限制

- **一個瀏覽器只能保活一個帳號**：瀏覽器對 Gemini 只有一份 Cookie。多帳號必須用多個獨立瀏覽器環境（設定檔 / 無痕 / 指紋瀏覽器）分別登入、各裝一個擴充功能。
- **不保證突破 2 小時**：本地瀏覽器與中轉站共用同一 Google 工作階段，PSIDTS 輪換理論上仍可能互相影響。本擴充功能用「被動回應」把風險降到最低，實際效果需觀察。
- **依賴瀏覽器常駐**：瀏覽器或 Gemini 分頁關閉後即停止保活，這是「不主動頻繁重新整理」設計的固有取捨。

## 📄 許可協議

本專案採用 [PolyForm Noncommercial License 1.0.0](../../LICENSE)，僅供非商業用途。

## ⚠ 免責聲明

本專案與 Google 無關，僅供學習研究。使用本擴充功能產生的任何後果（包括但不限於帳號封禁、資料遺失）由使用者自行承擔。
