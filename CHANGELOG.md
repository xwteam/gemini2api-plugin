# Changelog

## v1.4.0

- **推完整 Cookie（适配谷歌 2026-11-20 改版）**：改版后只带 `__Secure-1PSID` / `__Secure-1PSIDTS` 打开 Gemini 会被 302 到谷歌登录页——中转站以为初始化成功，实际是未登录访客（只剩「Auto」一个模型，别的模型报 400）。插件改用 `chrome.cookies.getAll({ url: "https://gemini.google.com/app" })` 读浏览器访问 Gemini 时会发的全部 Cookie（`.google.com` 域的 SID / HSID / SSID / APISID / SAPISID / `__Secure-1PAPISID` / `__Secure-3PSID` / `*PSIDCC` 等，加上 gemini.google.com 自己的 host-only `OSID` / `__Secure-OSID`），保留 domain / path / hostOnly / secure / httpOnly / expirationDate；主动同步、救火、强制刷新三条路径都在 `{ psid, psidts }` 之外带上 `cookies: [...]`（字段名照 `chrome.cookies.Cookie`），`PUT /admin/accounts/{id}/cookies` 与 `POST /admin/reload-cookies` 都带。**需要 gemini2api ≥ v1.6.53** 才会用上；旧中转站忽略这个字段，行为与 v1.3.0 相同
- psid / psidts 与 `cookies` 出自同一份快照，保证与列表里的 `__Secure-1PSID` / `__Secure-1PSIDTS` 一致（中转站对不上会回 400）；读不到完整 Cookie（`getAll` 出错）、或本地有 PSID 却没有 `__Secure-1PSIDTS` 时退回 v1.3.0 的老格式只推这两个（不推缺 1PSIDTS 的列表，免得中转站判不一致回 400、救火每轮重刷标签页），日志注明；本地只有访客 Cookie（没有 PSID）时不推
- **主动同步触发**：除 `__Secure-1PSID` / `__Secure-1PSIDTS` 外，gemini.google.com 的 `OSID` / `__Secure-OSID` 变化也触发（别的谷歌服务自己的 OSID 不算）；`*PSIDCC` / `SIDCC` 等每次请求都变的不触发；防抖与同账号 60 秒最小间隔不变。指纹带上「完整 Cookie」标记与 OSID：从 v1.3.0 升级后第一次轮询会给本浏览器负责的账号补推一次完整 Cookie（只有当时中转站已是 ≥ v1.6.53 才收得下；若先升级插件、后升级中转站，升级中转站后请点一次「强制刷新提交」），之后 OSID 变了也会推
- **侧边栏 / 日志**：本地 Cookie 区新增「完整 Cookie」一行（读到 N 个、含不含 OSID），没读到 OSID 时提示去打开并登录 gemini.google.com；推送成功的日志写「已同步 N 个 Cookie，含 OSID」。只显示个数和名字，任何 Cookie 值都不明文显示（PSID / PSIDTS 两行照旧默认打码）
- 没有新增权限（`cookies` + `*://*.google.com/*` 已够）；storage 里仍只存指纹，不存 Cookie 原值

## v1.3.0

- **主动同步**：后台顶层注册 `chrome.cookies.onChanged`，浏览器轮换 `__Secure-1PSIDTS` / `__Secure-1PSID` 后防抖约 10 秒读取 Cookie（**不刷新标签页**），推给绑定账号（未绑定按 PSID 匹配，匹配不到 / 匹配到多个就跳过，同一原因只记一条日志；绑定账号状态正常而本地 PSID 与中转站记录对不上时也跳过，不覆盖中转站上正常的会话，账号需要救火或手动强制刷新时仍照绑定提交）；只在 Cookie 指纹与上次成功推送不同时推（SHA-256 截断，不另存 Cookie 原值），同一账号至少间隔 60 秒；每次定时轮询兜底补推，防止 service worker 在防抖期间被回收而漏推
- **is_healthy 兼容**：`status == "expired"` 按要救处理；仍报 `active` 但 `is_healthy === false` 只对旧中转站（gemini2api v1.6.41～v1.6.43，`/admin/status` 没有 `keepalive_mode` 字段）按「会话失效」去救——v1.6.44 起被打回登录页的账号直接报 `expired`，仍报 `active` 但不健康是中转站自身的问题（网络抖动、5xx、刚启动），侧边栏显示「不健康」，不刷新也不提交；徽章计数、日志、侧边栏同口径；已禁用的账号不救也不推
- **请求头**：`PUT /admin/accounts/{id}/cookies` 与 `POST /admin/reload-cookies` 带 `X-Gemini2API-Keepalive: gemini2api-plugin/<版本>`；**需要 gemini2api ≥ v1.6.44** 才会据此把账号标为浏览器保活、停掉服务端轮换（旧版中转站忽略此头、主动同步照常；但 v1.6.41～v1.6.43 的服务端仍会自己轮换）
- 救火刷新标签页前先查冷却与 PSID：要救的账号都在冷却期、或（未绑定账号 ID 时）本地 PSID 与它们都对不上，就不刷新标签页（以前先刷新再跳过，会打断正在用的页面）
- 救火提交同样记录指纹，兜底补推不会重复推同一份 Cookie；轮询 / 主动同步 / 强制刷新串行执行；后台事件回调补齐 Promise 异常兜底（强制刷新、清空日志出错也会回复侧边栏）；同步提示的去重在中转站与浏览器重新一致或清空日志后重置，仍在持续的原因会再出现在日志里
- 纯逻辑抽到 `sync.js`，新增 `tests/`（Node 自带测试：`node --test tests/`，需 Node ≥ 22）

## v1.2.3

- **文档工具移出插件仓库**：删除 `gen_docs.py`、`doc-templates/`（维护者本地使用 `gemini2api-plugin-docs/` 目录，不推送 GitHub）
- 仓库内仅保留扩展运行文件 + 静态 `docs/` + `README.md` / `CHANGELOG.md`

## v1.2.2

- **修复无法加载扩展**：开发用目录 `_doc_templates` / `_gen_docs.py` 重命名为 `doc-templates` / `gen_docs.py`（Chrome 禁止 `_` 前缀除 `_locales` 外）
- **P3 安全**：`t()` substitution 预 `escapeHtml`；统一从 `i18n.js` 导出 `escapeHtml`

## v1.2.1

- **i18n 打磨**：日志账号状态翻译、HTTP 错误本地化、`maskCookie` 空值 i18n
- **布局**：侧边栏 Header/Cookie 栏窄屏防溢出；设置页 hint 块级排版
- **繁中润色**：「助手→幫手」「插件→擴充功能」
- **无障碍**：Cookie 操作按钮补 `aria-label`

## v1.2.0

- **全量 i18n**：插件 UI、manifest 名称/描述、动作日志支持 5 语（简中 / 繁中 / 英 / 日 / 韩），自动跟随 Chrome 浏览器语言
- 新增 `_locales/` 与 `i18n.js` 封装

## v1.1.0

- **账号 ID 绑定移至侧边栏**：每个浏览器实例在侧边栏顶部独立绑定账号 ID；设置页仅保留中转站共用配置（地址、API Key、轮询参数）
- 设置页入口改名为「中转站设置」

## v1.0.2

- 修复 `waitTabComplete` 缓存页竞态；`pollOnce` 并发互斥锁
- PUT 404 不再 fallback 到全局 reload（多账号安全）
- 提交 Cookie 后立即调用 `/admin/accounts/{id}/check` 验证
- 轮询日志去重；UI 显示 cooling_down / disabled / refreshing 状态
- popup HTML 全面转义

## v1.0.1

- 兼容 gemini2api v1.6.16+ PSID 脱敏匹配（首尾片段比对）
- 文档补充 ADMIN_API_KEY 说明
- 标签页加载完成后再读 Cookie；启动即 poll
- 移除未使用的 notifications 权限
