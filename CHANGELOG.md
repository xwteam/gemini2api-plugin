# Changelog

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
