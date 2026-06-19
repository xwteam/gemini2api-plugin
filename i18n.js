// i18n.js —— chrome.i18n 封装，popup/options 共用
export function t(key, ...subs) {
  return chrome.i18n.getMessage(key, subs);
}

/** 将 data-i18n / data-i18n-placeholder / data-i18n-title 注入文案 */
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
  const titleKey = document.documentElement.dataset.pageTitle;
  if (titleKey) document.title = t(titleKey);
  document.documentElement.lang = chrome.i18n.getUILanguage().replace("_", "-");
}

/** 日志时间戳，跟随 UI 语言 */
export function formatLogTime(date = new Date()) {
  return date.toLocaleString(chrome.i18n.getUILanguage(), { hour12: false });
}
