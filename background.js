// background.js —— service worker：定时轮询中转站，过期时刷新本地浏览器并提交新 cookie
import { getConfig, fetchStatus, submitCookies } from "./api.js";
import { readGeminiCookies, GEMINI_URL } from "./cookies.js";

const ALARM_NAME = "gemini-cookie-poll";
const LOG_KEY = "actionLog";
const COOLDOWN_KEY = "cooldownMap"; // { accountId: timestamp_ms }
const MAX_LOG = 50;

// ---------- 日志（存 storage.local，popup 读取展示）----------
async function log(msg, level = "info") {
  const ts = new Date().toLocaleString("zh-CN", { hour12: false });
  const entry = { ts, level, msg };
  const { [LOG_KEY]: logs = [] } = await chrome.storage.local.get(LOG_KEY);
  logs.unshift(entry);
  if (logs.length > MAX_LOG) logs.length = MAX_LOG;
  await chrome.storage.local.set({ [LOG_KEY]: logs });
  console.log(`[${level}] ${msg}`);
}

// ---------- 冷却：同一账号刷新后 N 秒内不重复处理 ----------
async function inCooldown(accountId, cooldownSeconds) {
  const { [COOLDOWN_KEY]: map = {} } = await chrome.storage.local.get(COOLDOWN_KEY);
  const last = map[accountId] || 0;
  return Date.now() - last < cooldownSeconds * 1000;
}
async function setCooldown(accountId) {
  const { [COOLDOWN_KEY]: map = {} } = await chrome.storage.local.get(COOLDOWN_KEY);
  map[accountId] = Date.now();
  await chrome.storage.local.set({ [COOLDOWN_KEY]: map });
}

// ---------- 找到并静默刷新一个 gemini 标签页 ----------
async function refreshGeminiTab() {
  const tabs = await chrome.tabs.query({ url: "*://gemini.google.com/*" });
  if (!tabs.length) {
    return { ok: false, error: "未找到已打开的 gemini.google.com 标签页，请先打开一个并登录" };
  }
  const tab = tabs[0];
  await chrome.tabs.reload(tab.id, { bypassCache: false });
  // 等页面加载 + Google 前端 JS 轮换 PSIDTS
  await new Promise((r) => setTimeout(r, 12000));
  return { ok: true, tabId: tab.id };
}

// ---------- 处理单个过期账号 ----------
async function handleExpiredAccount(cfg, accountId) {
  if (await inCooldown(accountId, cfg.cooldownSeconds)) {
    await log(`账号 ${accountId} 处于冷却期，跳过本轮`, "info");
    return;
  }
  await log(`账号 ${accountId} 已过期，刷新本地 Gemini 标签页…`, "warn");

  const r = await refreshGeminiTab();
  if (!r.ok) {
    await log(r.error, "error");
    return;
  }

  const { psid, psidts } = await readGeminiCookies();
  if (!psid) {
    await log(`刷新后仍读不到 __Secure-1PSID，可能本地也未登录 Gemini`, "error");
    return;
  }

  const sub = await submitCookies(cfg, accountId, psid, psidts);
  if (sub.ok) {
    await setCooldown(accountId);
    await log(`账号 ${accountId} 新 Cookie 已提交（${sub.via}），等待下轮验证`, "success");
  } else {
    await log(`账号 ${accountId} 提交失败：${sub.error}`, "error");
  }
}

// ---------- 一轮轮询 ----------
async function pollOnce() {
  const cfg = await getConfig();
  if (!cfg.baseUrl) {
    await log("未配置中转站地址，请先到设置页填写", "warn");
    return;
  }

  const st = await fetchStatus(cfg);
  if (!st.ok) {
    await log(`查询状态失败：${st.error}`, "error");
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
    return;
  }

  // 若指定了账号 ID，只看那个；否则处理所有 expired
  let accounts = st.accounts;
  if (cfg.accountId) accounts = accounts.filter((a) => a.id === cfg.accountId);

  const expired = accounts.filter((a) => a.status === "expired");
  const activeCount = accounts.filter((a) => a.status === "active").length;

  // 角标显示活动账号数 / 有过期时红点
  if (expired.length) {
    await chrome.action.setBadgeText({ text: String(expired.length) });
    await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  } else {
    await chrome.action.setBadgeText({ text: activeCount ? String(activeCount) : "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#1a73e8" });
  }

  if (!expired.length) return; // 都正常，什么都不做

  for (const acc of expired) {
    await handleExpiredAccount(cfg, acc.id);
  }
}

// ---------- 定时器 ----------
async function rearmAlarm() {
  const cfg = await getConfig();
  const mins = Math.max(0.5, (cfg.intervalSeconds || 60) / 60); // chrome.alarms 最小 0.5 分钟
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: mins });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) pollOnce();
});

chrome.runtime.onInstalled.addListener(() => {
  rearmAlarm();
  log("插件已安装/更新，定时轮询已启动", "info");
});
chrome.runtime.onStartup.addListener(() => rearmAlarm());

// 配置变更（间隔等）时重设定时器
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.intervalSeconds) rearmAlarm();
});

// 接收 popup 的手动触发
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "poll-now") {
    pollOnce().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // async
  }
  if (msg && msg.type === "refresh-now") {
    (async () => {
      const cfg = await getConfig();
      const st = await fetchStatus(cfg);
      const ids = st.ok ? st.accounts.map((a) => a.id) : [];
      const target = cfg.accountId || ids[0];
      if (target) await handleExpiredAccount({ ...cfg, cooldownSeconds: 0 }, target);
      sendResponse({ ok: true });
    })();
    return true;
  }
});

export { log, inCooldown, setCooldown, refreshGeminiTab, pollOnce, rearmAlarm, ALARM_NAME, LOG_KEY };
