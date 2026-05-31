<div align="center">

<h1>Gemini2API Plugin</h1>
<h3>Gemini Cookie 保活浏览器插件</h3>
<p>定时检测中转站账号状态，过期时用本地浏览器（住宅 IP）自动刷新并提交新 Cookie，助力突破 2 小时限制、保持长期在线。</p>

<p>
  <img src="https://img.shields.io/badge/Manifest-V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="MV3">
  <img src="https://img.shields.io/badge/Chrome%20%7C%20Edge-Latest-1a73e8?style=flat-square&logo=googlechrome&logoColor=white" alt="Browser">
  <img src="https://img.shields.io/badge/JavaScript-ES%20Module-f7df1e?style=flat-square&logo=javascript&logoColor=black" alt="JS">
  <img src="https://img.shields.io/badge/%E4%BE%9D%E8%B5%96-%E9%9B%B6-success?style=flat-square" alt="No deps">
  <img src="https://img.shields.io/badge/License-Non--Commercial-red?style=flat-square" alt="License">
</p>

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

</div>

---

> [!NOTE]
> 本插件是 [Gemini2API](https://github.com/xwteam/gemini2api) 的配套工具，仅供研究和学习用途，请合理使用，不要用于任何商业目的。

> [!WARNING]
> 本插件与 Google 无关。通过浏览器扩展读取 Gemini 登录 Cookie 实现功能，可能不符合 Google 服务条款。使用风险自负，作者不对任何账号处罚或数据丢失承担责任。

> [!IMPORTANT]
> 本插件**不保证 100% 突破 2 小时限制**。它把对 Google 会话的干扰降到最低（被动响应、过期才刷新一次），但本地浏览器与中转站共用同一账号会话，实际效果需安装后观察。欢迎通过 [Issue](https://github.com/xwteam/gemini2api-plugin/issues) 分享你的实测结果。

---

<!-- PLACEHOLDER_BODY -->

## 💡 工作原理

中转站部署在数据中心 IP 上，Google 对这类 IP 的登录会话约 2 小时强制失效。但**你本地浏览器跑在住宅 IP 上，同一账号的会话能存活更久**。本插件正是利用这一点：

```
每隔 N 秒 → GET /admin/status 查中转站账号状态
  ├─ active（活动）   → 什么都不做
  └─ expired（过期）  → 刷新本地已打开的 gemini.google.com 标签页
                       → chrome.cookies 读取新的 __Secure-1PSID / __Secure-1PSIDTS
                       → PUT /admin/accounts/{id}/cookies 提交给中转站
                       → 下一轮轮询验证是否恢复 active
```

平时插件只静默轮询、不操作浏览器；**只有检测到过期才刷新一次**，并设冷却期防止重复刷新，把对 Google 会话的干扰降到最低。

## 🌟 核心特性

- **被动响应**：平时零打扰，仅在账号过期时才动作，不主动抢占 Cookie 轮换
- **读取 HttpOnly Cookie**：借助扩展的 `chrome.cookies` 权限读取网页 JS 读不到的 `__Secure-` 认证 Cookie
- **静默刷新**：自动刷新已打开的 Gemini 标签页，无需手动操作
- **按账号提交 + 防串号**：填了账号 ID 就按账号直接提交新 Cookie（这是保活关键——Cookie 变了也能提交覆盖）；没填账号 ID 时靠本地 PSID 自动匹配账号，避免多账号串号
- **冷却防抖**：同一账号刷新后进入冷却期，避免连续多轮重复打架
- **侧边栏常驻**：以浏览器右侧固定侧边栏展示，操作时不消失，方便长时间盯着保活状态和动作日志
- **零依赖**：纯原生 JavaScript + Manifest V3，无需构建、无第三方库
- **隐私安全**：API Key 与 Cookie 只存本地、只发往你配置的中转站

## 📦 安装

> [!TIP]
> 适用于 Chrome、Edge 等 Chromium 内核浏览器。

1. 下载/克隆本仓库到本地
2. 打开扩展管理页：Chrome 为 `chrome://extensions`，Edge 为 `edge://extensions`
3. 打开右上角的 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择本项目根目录
5. 安装后点击插件图标 → 在右侧打开侧边栏 → 右上角 **设置**，完成配置（见下文）

## ⚙ 配置说明

在插件设置页填写：

| 配置项 | 说明 |
|--------|------|
| **中转站地址** | 你的 Gemini2API 地址，如 `http://1.2.3.4:5918` |
| **API Key** | 中转站的 `sk-` 开头密钥 |
| **账号 ID** | **建议填写**（如 `account-0`）：填了就按该账号直接提交，Cookie 更新后也能正常保活。留空则靠本地 PSID 自动匹配账号，但 Cookie 变化大时可能匹配不上 |
| **轮询间隔** | 多久查一次状态，默认 60 秒，最小 30 秒 |
| **刷新冷却** | 同一账号刷新后多久内不重复处理，默认 120 秒 |

填好后点 **测试连接** 确认能连上中转站，再点 **保存**（保存时浏览器会请求访问该中转站域的权限，请点允许）。

> [!IMPORTANT]
> **一个浏览器实例只能保活一个账号。** 浏览器对 `gemini.google.com` 只有一份 Cookie，插件读到的永远是当前登录的那个账号。所以：
> - 浏览器里要**常开一个已登录的 `gemini.google.com` 标签页**，且登录的就是你要保活的那个账号。
> - **强烈建议用独立的浏览器环境专门跑保活**（独立用户配置文件 / 无痕窗口 / 指纹浏览器），不要和你日常登录其它 Google 账号的浏览器混用，否则刷新时会读到错误账号、造成串号或互相干扰。
> - 建议**在设置页填写本浏览器负责的账号 ID**：填了就按账号直接提交（Cookie 更新后也能保活），并天然避免串号；留空时靠 PSID 自动匹配，多账号场景可能认错或匹配不上。
> - 标签页或浏览器关闭后，该账号过期将无法自动修复。

## 👥 多账号使用

中转站有多个账号时，**每个账号用一个独立浏览器环境分别登录、各装一个本插件**：

| 账号 | 浏览器环境 | 登录的 Google 账号 |
|------|-----------|-------------------|
| account-0 | Chrome 配置文件 A / 指纹浏览器窗口 1 | 账号 0 的 Google |
| account-1 | Chrome 配置文件 B / 指纹浏览器窗口 2 | 账号 1 的 Google |
| …… | …… | …… |

每个环境里的插件都填同一个中转站地址和 API Key，账号 ID 可留空（插件靠 PSID 自动认出本浏览器负责哪个账号）或精确填写。这样多个浏览器各管各的账号，互不串扰。

> [!TIP]
> 推荐用 Chrome 的「人物 / 配置文件」功能或指纹浏览器，为每个账号开一个完全隔离的环境，Cookie 互不影响。无痕窗口也可，但关闭即失效、需重新登录。

## 🖥 界面说明

点击工具栏图标会在浏览器**右侧打开固定侧边栏**（常驻不消失，方便长时间盯着保活状态和日志）。

- **侧边栏面板**：显示各账号活动/过期状态、PSID 打码预览、最近动作日志；`立即检查` 手动跑一轮轮询，`强制刷新提交` 立即刷新并提交；右上角 `设置` 进入配置页。
- **本地 Cookie 区**：显示本地浏览器当前读到的 `__Secure-1PSID` / `__Secure-1PSIDTS`（默认打码，可点 `👁 显示完整` 看全值），并提示是否与中转站账号匹配——方便排查“到底有没有读到 Cookie、是不是对的账号”。
- **图标角标**：
  - 蓝色数字 = 活动账号数
  - 红色数字 = 过期账号数
  - `!` = 连接中转站失败

## 🔐 权限说明

| 权限 | 用途 |
|------|------|
| `cookies` + `*://*.google.com/*` | 读取 Gemini 的 HttpOnly 认证 Cookie |
| `tabs` | 查找并刷新 gemini.google.com 标签页 |
| `storage` | 保存配置与动作日志 |
| `alarms` | 定时轮询 |
| 中转站域权限 | 保存设置时按你填写的地址动态申请 |

> [!NOTE]
> **隐私承诺**：API Key 和读取到的 Cookie 仅保存在本地浏览器，且只发送给你配置的中转站地址，绝不发往任何第三方。

## ❓ 常见问题

**Q：插件提示"未找到 gemini.google.com 标签页"？**
A：请在浏览器里打开并登录 https://gemini.google.com ，保持该标签页常开。

**Q：刷新后仍读不到 Cookie？**
A：说明本地浏览器当前也未登录 Gemini，或登录的不是中转站使用的账号。请重新登录。

**Q：状态一直显示过期、提交后不恢复？**
A：可能是 Google 已吊销该账号的主会话（PSID 被吊销无法靠刷新恢复）。此时需要重新登录 Gemini 获取全新 Cookie。

**Q：会不会让账号被封？**
A：插件采用被动模式、操作频率极低，但任何非官方方式都有风险，请自行评估。

**Q：多账号会不会把 A 账号的 Cookie 提交给 B 账号（串号）？**
A：不会。插件提交前会用本地 PSID 与目标账号比对，对不上直接拒绝。但前提仍是**一个浏览器只登录一个账号**，多账号请用独立浏览器环境分别跑（见「多账号使用」）。

## ⚠ 已知限制

- **一个浏览器只能保活一个账号**：浏览器对 Gemini 只有一份 Cookie。多账号必须用多个独立浏览器环境（配置文件 / 无痕 / 指纹浏览器）分别登录、各装一个插件。
- **不保证突破 2 小时**：本地浏览器与中转站共用同一 Google 会话，PSIDTS 轮换理论上仍可能互相影响。本插件用"被动响应"把风险降到最低，实际效果需观察。
- **依赖浏览器常驻**：浏览器或 Gemini 标签页关闭后即停止保活，这是"不主动频繁刷新"设计的固有取舍。

## 📄 许可协议

本项目采用 [PolyForm Noncommercial License 1.0.0](LICENSE)，仅供非商业用途。

## ⚠ 免责声明

本项目与 Google 无关，仅供学习研究。使用本插件产生的任何后果（包括但不限于账号封禁、数据丢失）由使用者自行承担。
