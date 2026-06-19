// i18n.js —— chrome.i18n 封装，popup/options/background 共用
export function t(key, ...subs) {
  return chrome.i18n.getMessage(key, subs);
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
