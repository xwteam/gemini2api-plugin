// i18n.js —— chrome.i18n 封装，popup/options/background 共用

/** HTML 转义（popup innerHTML 路径使用） */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeSubs(subs) {
  return subs.map((s) => escapeHtml(s));
}

/** 获取本地化文案；substitution 预转义，防止 innerHTML 路径 XSS */
export function t(key, ...subs) {
  return chrome.i18n.getMessage(key, subs.length ? escapeSubs(subs) : subs);
}

/** 账号状态文案（popup 徽章 + background 日志共用） */
export function accountStatusText(status, coolingDown = false) {
  if (coolingDown) return t("statusCoolingDown");
  switch (status) {
    case "active": return t("statusActive");
    case "expired": return t("statusExpired");
    case "disabled": return t("statusDisabled");
    case "refreshing": return t("statusRefreshing");
    default: return status ? String(status) : t("statusUnknown");
  }
}

/** 将 data-i18n / data-i18n-placeholder / data-i18n-title / data-i18n-aria 注入文案 */
export function localizePage() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.getAttribute("data-i18n-placeholder"));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.getAttribute("data-i18n-title"));
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
  });
  const titleKey = document.documentElement.dataset.pageTitle;
  if (titleKey) document.title = t(titleKey);
  document.documentElement.lang = chrome.i18n.getUILanguage().replace("_", "-");
}

/** 日志时间戳，跟随 UI 语言 */
export function formatLogTime(date = new Date()) {
  return date.toLocaleString(chrome.i18n.getUILanguage(), { hour12: false });
}
