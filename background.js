// background.js —— service worker：定时轮询中转站，过期时刷新本地浏览器并提交新 cookie
import { getConfig, fetchStatus, submitCookies } from "./api.js";
import { readGeminiCookies, isSameAccount, GEMINI_URL } from "./cookies.js";

const ALARM_NAME = "gemini-cookie-poll";
const LOG_KEY = "actionLog";
const COOLDOWN_KEY = "cooldownMap"; // { accountId: timestamp_ms }
const MAX_LOG = 200;

// ---------- 日志（存 storage.local，滚动保存最新 MAX_LOG 条，popup 读取展示）----------
// 用串行队列避免并发 log() 的「读-改-写」竞态导致丢日志。
let _logChain = Promise.resolve();
async function log(msg, level = "info") {
  const ts = new Date().toLocaleString("zh-CN", { hour12: false });
  const entry = { ts, level, msg };
  console.log(`[${level}] ${msg}`);
  _logChain = _logChain.then(async () => {
    const { [LOG_KEY]: logs = [] } = await chrome.storage.local.get(LOG_KEY);
    logs.unshift(entry);                       // 新日志插到最前
    if (logs.length > MAX_LOG) logs.length = MAX_LOG; // 超出则截掉末尾最旧的（滚动保存）
    await chrome.storage.local.set({ [LOG_KEY]: logs });
  }).catch((e) => console.warn("[log] 写入失败:", e));
  return _logChain;
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

// ---------- 处理某个过期账号（已确认本地账号与之匹配后才调用）----------
async function handleExpiredAccount(cfg, account, localPsid, localPsidts) {
  const accountId = account.id;
  if (await inCooldown(accountId, cfg.cooldownSeconds)) {
    await log(`账号 ${accountId} 处于冷却期，跳过本轮`, "info");
    return;
  }
  await log(`账号 ${accountId} 已过期且与本地账号匹配，提交新 Cookie…`, "warn");

  const sub = await submitCookies(cfg, accountId, localPsid, localPsidts);
  if (sub.ok) {
    await setCooldown(accountId);
    await log(`账号 ${accountId} 新 Cookie 已提交（${sub.via}），等待下轮验证`, "success");
  } else {
    await log(`账号 ${accountId} 提交失败：${sub.error}`, "error");
  }
}

// ---------- 一轮轮询 ----------
// 防串号核心：一个浏览器只登录一个 Google 账号，本地 PSID 唯一确定“本浏览器负责哪个账号”。
// 只把本地 Cookie 提交给 PSID 匹配的那个账号，绝不张冠李戴。
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

  let accounts = st.accounts;
  if (cfg.accountId) accounts = accounts.filter((a) => a.id === cfg.accountId);

  const expired = accounts.filter((a) => a.status === "expired");
  const activeCount = accounts.filter((a) => a.status === "active").length;

  // 角标
  if (expired.length) {
    await chrome.action.setBadgeText({ text: String(expired.length) });
    await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  } else {
    await chrome.action.setBadgeText({ text: activeCount ? String(activeCount) : "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#1a73e8" });
  }

  if (!expired.length) {
    const ids = accounts.map((a) => a.id).join(", ");
    await log(`检查完成：账号正常（${activeCount} 个活动${ids ? "：" + ids : ""}），无需刷新`, "info");
    return;
  }

  // 有账号过期：刷新本地标签页拿新 cookie，并确定本浏览器登录的是哪个账号
  const r = await refreshGeminiTab();
  if (!r.ok) { await log(r.error, "error"); return; }

  const { psid: localPsid, psidts: localPsidts } = await readGeminiCookies();
  if (!localPsid) {
    await log("刷新后读不到本地 __Secure-1PSID，本浏览器未登录 Gemini，无法保活", "error");
    return;
  }

  // 在过期账号里找出与本地 PSID 匹配的那个（防串号）
  const matched = expired.filter((a) => isSameAccount(localPsid, a.psid));
  const mismatched = expired.filter((a) => !isSameAccount(localPsid, a.psid));

  if (!matched.length) {
    await log(
      `本地登录账号(PSID ${localPsid.slice(0, 10)}…)与 ${expired.length} 个过期账号均不匹配，` +
      `本浏览器不负责它们，跳过（多账号请用独立浏览器分别登录）`,
      "warn"
    );
    return;
  }
  if (mismatched.length) {
    await log(`跳过 ${mismatched.length} 个非本浏览器账号：${mismatched.map((a) => a.id).join(", ")}`, "info");
  }

  for (const acc of matched) {
    await handleExpiredAccount(cfg, acc, localPsid, localPsidts);
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

// 点击工具栏图标 → 打开右侧固定侧边栏（manifest 已去掉 default_popup，故 onClicked 可触发）
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id }).catch((e) => console.warn("[sidePanel] 打开失败:", e));
});

chrome.runtime.onInstalled.addListener(() => {
  rearmAlarm();
  // 允许点击图标打开侧边栏（兜底，部分版本需显式设置）
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
  log("插件已安装/更新，定时轮询已启动", "info");
});
chrome.runtime.onStartup.addListener(() => rearmAlarm());

// 配置变更（间隔等）时重设定时器
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.intervalSeconds) rearmAlarm();
});

// 接收 popup 的手动触发
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "poll-now") {
    pollOnce().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // async
  }
  if (msg && msg.type === "clear-log") {
    chrome.storage.local.set({ [LOG_KEY]: [] }).then(() => {
      log("日志已清空", "info");
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg && msg.type === "refresh-now") {
    (async () => {
      const cfg = await getConfig();
      const st = await fetchStatus(cfg);
      if (!st.ok) { await log(`强制刷新失败：${st.error}`, "error"); sendResponse({ ok: false }); return; }

      const r = await refreshGeminiTab();
      if (!r.ok) { await log(r.error, "error"); sendResponse({ ok: false }); return; }

      const { psid, psidts } = await readGeminiCookies();
      if (!psid) { await log("读不到本地 PSID，本浏览器未登录 Gemini", "error"); sendResponse({ ok: false }); return; }

      // 找出与本地账号匹配的目标（优先配置的 accountId，但仍需 PSID 匹配防串号）
      let candidates = st.accounts;
      if (cfg.accountId) candidates = candidates.filter((a) => a.id === cfg.accountId);
      const target = candidates.find((a) => isSameAccount(psid, a.psid));

      if (!target) {
        await log(`本地账号(PSID ${psid.slice(0, 10)}…)与中转站账号均不匹配，拒绝提交以防串号`, "error");
        sendResponse({ ok: false });
        return;
      }
      await handleExpiredAccount({ ...cfg, cooldownSeconds: 0 }, target, psid, psidts);
      sendResponse({ ok: true });
    })();
    return true;
  }
});

export { log, inCooldown, setCooldown, refreshGeminiTab, pollOnce, rearmAlarm, ALARM_NAME, LOG_KEY };
