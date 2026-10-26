<div align="center">

<h1>Gemini2API Plugin</h1>
<h3>Gemini Cookie 保活浏览器插件</h3>
<p>浏览器一轮换 Cookie 就主动同步给中转站；账号过期或会话失效时，用本地浏览器（住宅 IP）自动刷新并提交新 Cookie，助力突破 2 小时限制、保持长期在线。</p>

<p>
  <img src="https://img.shields.io/badge/Manifest-V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="MV3">
  <img src="https://img.shields.io/badge/Chrome%20%7C%20Edge-Latest-1a73e8?style=flat-square&logo=googlechrome&logoColor=white" alt="Browser">
  <img src="https://img.shields.io/badge/JavaScript-ES%20Module-f7df1e?style=flat-square&logo=javascript&logoColor=black" alt="JS">
  <img src="https://img.shields.io/badge/%E4%BE%9D%E8%B5%96-%E9%9B%B6-success?style=flat-square" alt="No deps">
  <img src="https://img.shields.io/badge/License-Non--Commercial-red?style=flat-square" alt="License">
</p>

<p>📦 主项目：<a href="https://github.com/xwteam/gemini2api"><b>gemini2api</b></a>（Gemini Web 反向代理）· 本插件是它的 Cookie 保活配套工具</p>

<p>
  <a href="#-工作原理">工作原理</a> &bull;
  <a href="#-核心特性">核心特性</a> &bull;
  <a href="#-安装">安装</a> &bull;
  <a href="#-配置说明">配置说明</a> &bull;
  <a href="#-多账号使用">多账号使用</a> &bull;
  <a href="#-界面说明">界面说明</a> &bull;
  <a href="#-权限说明">权限说明</a> &bull;
  <a href="#-常见问题">常见问题</a> &bull;
  <a href="#-已知限制">已知限制</a>
</p>

<p>
  📖 文档语言：简体中文 | <a href="../zh-TW/README.md">繁體中文</a> | <a href="../en/README.md">English</a> | <a href="../ja/README.md">日本語</a> | <a href="../ko/README.md">한국어</a>
</p>

</div>

---

> [!NOTE]
> 本插件是 [Gemini2API](https://github.com/xwteam/gemini2api) 的配套工具，仅供研究和学习用途，请合理使用，不要用于任何商业目的。

> [!WARNING]
> 本插件与 Google 无关。通过浏览器扩展读取 Gemini 登录 Cookie 实现功能，可能不符合 Google 服务条款。使用风险自负，作者不对任何账号处罚或数据丢失承担责任。

> [!IMPORTANT]
> 本插件**不保证 100% 突破 2 小时限制**。本地浏览器与中转站共用同一账号会话：v1.3.0 起插件会把浏览器轮换出的新 Cookie 及时同步给中转站，配合 **gemini2api ≥ v1.6.44** 时中转站不再自己轮换这些账号，避免两边互相顶掉（v1.6.41～v1.6.43 的中转站仍会自己轮换）。实际效果需安装后观察。欢迎通过 [Issue](https://github.com/xwteam/gemini2api-plugin/issues) 分享你的实测结果。

---

## 💡 工作原理

中转站部署在数据中心 IP 上，Google 对这类 IP 的登录会话约 2 小时强制失效。但**你本地浏览器跑在住宅 IP 上，同一账号的会话能存活更久**。本插件正是利用这一点，分两条线工作：

```
① 主动同步（v1.3.0）：浏览器自己轮换了 Cookie → 及时转交中转站
chrome.cookies.onChanged 发现 __Secure-1PSIDTS / __Secure-1PSID 变化
  → 等约 10 秒合并连续变化 → 读取当前 Cookie（不刷新标签页）
  → 目标账号：侧边栏绑定的账号 ID；没绑定就按 PSID 匹配
  → 与上次成功推送的不同、且距上次推送 ≥ 60 秒 → PUT /admin/accounts/{id}/cookies
  （每次定时轮询也补查一次，防止 service worker 被回收而漏推）

② 救火：每隔 N 秒 → GET /admin/status 查中转站账号状态
  ├─ active 且健康 → 什么都不做
  └─ expired（过期）或 is_healthy=false（会话失效）
        → 刷新本地已打开的 gemini.google.com 标签页
        → chrome.cookies 读取新的 __Secure-1PSID / __Secure-1PSIDTS
        → PUT /admin/accounts/{id}/cookies 提交给中转站
        → 下一轮轮询验证是否恢复 active
```

插件自己从不轮换 Cookie：主动同步只是把浏览器已经换好的值转交给中转站；平时不操作浏览器，**只有检测到过期 / 会话失效才刷新一次标签页**，并设冷却期防止重复刷新。两条线提交时都带请求头 `X-Gemini2API-Keepalive: gemini2api-plugin/<版本>`：**gemini2api ≥ v1.6.44** 据此把该账号标为「浏览器保活」、不再由服务端轮换，避免浏览器与中转站互相顶掉对方的 PSIDTS；旧版中转站会忽略这个头。

## 🌟 核心特性

- **主动同步（v1.3.0）**：浏览器轮换 Cookie 后约 10 秒内推给中转站；只在值变化时推，同一账号至少间隔 60 秒，定时轮询兜底补推；插件自身不轮换 Cookie、不刷新页面
- **救火**：账号过期，或中转站仍报 active 但 `is_healthy=false`（会话失效）时，刷新标签页并提交新 Cookie；其余时间不操作浏览器
- **读取 HttpOnly Cookie**：借助扩展的 `chrome.cookies` 权限读取网页 JS 读不到的 `__Secure-` 认证 Cookie
- **静默刷新**：自动刷新已打开的 Gemini 标签页，无需手动操作
- **按账号提交 + 防串号**：填了账号 ID 就按账号直接提交新 Cookie（这是保活关键——Cookie 变了也能提交覆盖）；没填账号 ID 时靠本地 PSID 自动匹配账号，避免多账号串号
- **冷却防抖**：同一账号刷新后进入冷却期，避免连续多轮重复打架
- **侧边栏常驻**：以浏览器右侧固定侧边栏展示，操作时不消失，方便长时间盯着保活状态和动作日志
- **多语言界面**：插件 UI 与日志自动跟随 Chrome 浏览器语言（简中 / 繁中 / 英 / 日 / 韩），与文档语言一致
- **零依赖**：纯原生 JavaScript + Manifest V3，无需构建、无第三方库
- **隐私安全**：API Key 与 Cookie 只存本地、只发往你配置的中转站；同步记录只存 Cookie 的哈希指纹，不另存原值

## 📦 安装

> [!TIP]
> 适用于 Chrome、Edge 等 Chromium 内核浏览器。

1. 下载/克隆本仓库到本地
2. 打开扩展管理页：Chrome 为 `chrome://extensions`，Edge 为 `edge://extensions`
3. 打开右上角的 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择本项目根目录（含 `manifest.json` 的文件夹）

> [!IMPORTANT]
> 请加载含 `manifest.json` 的本仓库根目录。本仓库**仅含扩展运行文件、静态文档**（`docs/`）**与单元测试**（`tests/`，扩展运行时不会加载；开发者可用 Node ≥ 22 运行 `node --test tests/`），不含文档生成脚本等非扩展文件。

5. 安装后点击插件图标 → 在右侧打开侧边栏：
   - 顶部 **绑定本浏览器负责的账号 ID**（如 `account-0`）
   - 右上角 **中转站设置** 填写地址和 API Key（见下文）

## ⚙ 配置说明

### 侧边栏（本浏览器实例）

| 配置项 | 说明 |
|--------|------|
| **账号 ID** | **强烈建议填写**（如 `account-0`）。一个浏览器实例只保活一个账号，在此处绑定；多账号时每个浏览器配置文件各填各的 |

填写后点 **绑定**。留空则靠 PSID 自动匹配（精度较低，不推荐多账号场景）。

### 中转站设置页

| 配置项 | 说明 |
|--------|------|
| **中转站地址** | 你的 Gemini2API 地址，如 `http://1.2.3.4:5918` |
| **API Key** | 中转站的 `sk-` 开头密钥；若 gemini2api ≥ v1.6.16 配置了独立 `ADMIN_API_KEY`，此处应填**管理密钥** |
| **轮询间隔** | 多久查一次状态，默认 60 秒，最小 30 秒 |
| **刷新冷却** | 救火时同一账号刷新后多久内不重复处理，默认 120 秒（主动同步另有固定的 60 秒最小间隔） |

填好后点 **测试连接** 确认能连上中转站，再点 **保存**（保存时浏览器会请求访问该中转站域的权限，请点允许）。

> [!NOTE]
> **gemini2api 版本兼容**：
> - v1.6.16 起 `/admin/status` 对 PSID 脱敏返回。未填账号 ID 时插件用 PSID 首尾片段自动匹配（v1.6.16 前为 24 字符前缀比对）。**强烈建议始终填写账号 ID**，最可靠且避免串号。
> - v1.6.41～v1.6.43 对谷歌会话已失效的账号仍报 `active`，只把 `is_healthy` 置为 false；插件（v1.3.0 起）按「会话失效」去救。
> - **v1.6.44 起**，插件推送过 Cookie 的账号会被标为「浏览器保活」（`/admin/status` 里 `keepalive_mode` 为 `browser`），服务端不再轮换它。想让某个账号改回服务端轮换（例如改用无痕窗口取的 Cookie），先在对应浏览器里停用本插件，再到面板手动更新 Cookie——否则插件下次同步又会把它标回浏览器保活。

> [!IMPORTANT]
> **一个浏览器实例只能保活一个账号。** 浏览器对 `gemini.google.com` 只有一份 Cookie，插件读到的永远是当前登录的那个账号。所以：
> - 浏览器里要**常开一个已登录的 `gemini.google.com` 标签页**，且登录的就是你要保活的那个账号。
> - **强烈建议用独立的浏览器环境专门跑保活**（独立用户配置文件 / 无痕窗口 / 指纹浏览器），不要和你日常登录其它 Google 账号的浏览器混用，否则刷新时会读到错误账号、造成串号或互相干扰。
> - 在侧边栏顶部**绑定本浏览器负责的账号 ID**（多账号时每个配置文件各绑一个，不要共用）
> - 标签页或浏览器关闭后，该账号过期将无法自动修复。

## 👥 多账号使用

中转站有多个账号时，**每个账号用一个独立浏览器环境分别登录、各装一个本插件**：

| 账号 | 浏览器环境 | 登录的 Google 账号 |
|------|-----------|-------------------|
| account-0 | Chrome 配置文件 A / 指纹浏览器窗口 1 | 账号 0 的 Google |
| account-1 | Chrome 配置文件 B / 指纹浏览器窗口 2 | 账号 1 的 Google |
| …… | …… | …… |

每个环境里的插件：**中转站设置**填同一个地址和 API Key；**侧边栏顶部**各绑不同的账号 ID（如 A 绑 `account-0`、B 绑 `account-1`）。这样多个浏览器各管各的账号，互不串扰。

> [!TIP]
> 推荐用 Chrome 的「人物 / 配置文件」功能或指纹浏览器，为每个账号开一个完全隔离的环境，Cookie 互不影响。无痕窗口也可，但关闭即失效、需重新登录。

## 🖥 界面说明

点击工具栏图标会在浏览器**右侧打开固定侧边栏**（常驻不消失，方便长时间盯着保活状态和日志）。

- **侧边栏面板**：顶部绑定本浏览器负责的**账号 ID**；下方显示账号活动 / 过期 / 会话失效状态、PSID 打码预览、最近动作日志（含主动同步记录）；`立即检查` / `强制刷新提交`；右上角 **中转站设置** 进入连接配置页。
- **本地 Cookie 区**：显示本地浏览器当前读到的 `__Secure-1PSID` / `__Secure-1PSIDTS`（默认打码，可点 `👁 显示完整` 看全值），并提示是否与中转站账号匹配——方便排查“到底有没有读到 Cookie、是不是对的账号”。
- **图标角标**：
  - 蓝色数字 = 活动账号数
  - 红色数字 = 过期或会话失效（待救）的账号数
  - `!` = 连接中转站失败

## 🔐 权限说明

| 权限 | 用途 |
|------|------|
| `cookies` + `*://*.google.com/*` | 读取 Gemini 的 HttpOnly 认证 Cookie，并监听其变化以主动同步 |
| `tabs` | 查找并刷新 gemini.google.com 标签页 |
| `storage` | 保存配置、动作日志与同步记录（只存哈希指纹） |
| `alarms` | 定时轮询 |
| 中转站域权限 | 保存设置时按你填写的地址动态申请 |

> [!NOTE]
> **隐私承诺**：API Key 和读取到的 Cookie 仅保存在本地浏览器，且只发送给你配置的中转站地址，绝不发往任何第三方。v1.3.0 的主动同步没有新增任何权限，同步记录只保存 Cookie 的 SHA-256 截断指纹，不另存 Cookie 原值。

## ❓ 常见问题

**Q：插件提示"未找到 gemini.google.com 标签页"？**
A：请在浏览器里打开并登录 https://gemini.google.com ，保持该标签页常开。

**Q：刷新后仍读不到 Cookie？**
A：说明本地浏览器当前也未登录 Gemini，或登录的不是中转站使用的账号。请重新登录。

**Q：状态一直显示过期、提交后不恢复？**
A：可能是 Google 已吊销该账号的主会话（PSID 被吊销无法靠刷新恢复）。此时需要重新登录 Gemini 获取全新 Cookie。

**Q：账号没过期，插件为什么也在提交 Cookie？**
A：这是 v1.3.0 的主动同步。浏览器与中转站共用同一个 Google 会话，浏览器轮换出新的 PSIDTS 后，中转站手里的旧值很快会失效，所以插件把新值及时转交过去（只在值变化时推，同一账号至少间隔 60 秒，不刷新标签页）。配合 gemini2api ≥ v1.6.44，中转站会停止自己轮换这个账号，避免两边互相顶掉。

**Q：侧边栏显示「会话失效」是什么意思？**
A：中转站仍报 `active`，但 `is_healthy` 为 false——谷歌会话其实已经失效（gemini2api v1.6.41～v1.6.43 会这样报）。插件把它和「已过期」一样处理：刷新标签页并提交新 Cookie。

**Q：会不会让账号被封？**
A：插件不会额外请求 Google：主动同步只把浏览器已有的 Cookie 转交给中转站，只有救火时才刷新一次标签页，操作频率极低；但任何非官方方式都有风险，请自行评估。

**Q：多账号会不会把 A 账号的 Cookie 提交给 B 账号（串号）？**
A：不会。插件提交前会用本地 PSID 与目标账号比对，对不上直接拒绝。但前提仍是**一个浏览器只登录一个账号**，多账号请用独立浏览器环境分别跑（见「多账号使用」）。

**Q：提示 `Cannot load extension with file or directory name _doc_templates`？**
A：请更新到 **v1.2.3** 并 `git pull`。v1.2.3 已删除 `_doc_templates` / `gen_docs.py`。若本地文件夹里还有 `_doc_templates`，说明代码没更新到最新。

**Q：为什么还有 `_locales` 文件夹？会不会也装不上？**
A：**不会。** `_locales` 是 Chrome 官方规定的多语言目录名，**必须叫这个名字**，`manifest.json` 里的 `default_locale` 就是读它。Chrome **只允许** `_locales` 使用 `_` 前缀，其它 `_` 开头目录（如旧版 `_doc_templates`）才会报错。五语界面依赖此目录，**不能改名也不能删**。

## ⚠ 已知限制

- **一个浏览器只能保活一个账号**：浏览器对 Gemini 只有一份 Cookie。多账号必须用多个独立浏览器环境（配置文件 / 无痕 / 指纹浏览器）分别登录、各装一个插件。
- **不保证突破 2 小时**：本地浏览器与中转站共用同一 Google 会话。gemini2api v1.6.41～v1.6.43 的服务端也会定时轮换 PSIDTS，两边可能互相顶掉；升级到 v1.6.44 及以上，插件推送过的账号才会停掉服务端轮换。实际效果需观察。
- **依赖浏览器常驻**：浏览器或 Gemini 标签页关闭后即停止保活（主动同步也靠打开的 Gemini 标签页让浏览器持续轮换 Cookie），这是"不主动频繁刷新"设计的固有取舍。

## 📄 许可协议

本项目采用 [PolyForm Noncommercial License 1.0.0](../../LICENSE)，仅供非商业用途。

## ⚠ 免责声明

本项目与 Google 无关，仅供学习研究。使用本插件产生的任何后果（包括但不限于账号封禁、数据丢失）由使用者自行承担。
