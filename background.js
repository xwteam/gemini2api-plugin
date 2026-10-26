// background.js —— service worker：
//   1) 救火：定时轮询中转站，账号过期 / 会话失效时刷新本地浏览器并提交新 cookie；
//   2) 主动同步：浏览器自己轮换了 PSIDTS 时，把新值及时推给中转站（只读 cookie，不刷新标签页）。
import { getConfig, fetchStatus, submitCookies, checkAccount } from "./api.js";
import { readGeminiCookies, isSameAccount } from "./cookies.js";
import { t, formatLogTime, accountStatusText } from "./i18n.js";
import {
  needsRefresh,
  displayStatus,
  isAuthCookieChange,
  pickTarget,
  shouldPush,
  debounceDelay,
  cookieFingerprint,
  SYNC_DEBOUNCE_MS,
  SYNC_MAX_WAIT_MS,
  SYNC_MIN_INTERVAL_MS,
} from "./sync.js";

const ALARM_NAME = "gemini-cookie-poll";
const LOG_KEY = "actionLog";
const COOLDOWN_KEY = "cooldownMap";
const LAST_STATUS_KEY = "lastPollStatus";
// 主动同步状态 { [accountId]: { hash, pushedAt, triedAt } }：hash/pushedAt = 上次推送成功，
// triedAt = 上次尝试（含失败）。只存 cookie 指纹（SHA-256 截断），不另存 cookie 原值。
const SYNC_STATE_KEY = "syncState";
// 上一条「同步跳过 / 失败」提示：同一原因不重复写日志，推送成功后清掉
const SYNC_NOTICE_KEY = "syncLastNotice";
const MAX_LOG = 200;
let _pollRunning = false;

let _logChain = Promise.resolve();
async function log(msg, level = "info") {
  const ts = formatLogTime();
  const entry = { ts, level, msg };
  console.log(`[${level}] ${msg}`);
  _logChain = _logChain.then(async () => {
    const { [LOG_KEY]: logs = [] } = await chrome.storage.local.get(LOG_KEY);
    logs.unshift(entry);
    if (logs.length > MAX_LOG) logs.length = MAX_LOG;
    await chrome.storage.local.set({ [LOG_KEY]: logs });
  }).catch((e) => console.warn("[log] write failed:", e));
  return _logChain;
}

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

// 轮询救火、主动同步、强制刷新共用这一把锁，串行执行：同一份 cookie 不会被两条路径同时推两遍，
// 同步状态的读改写也不会互相覆盖。不可重入——持锁的代码里不要再调 exclusive()。
let _exclusiveTail = Promise.resolve();
function exclusive(fn) {
  const run = _exclusiveTail.then(() => fn());
  _exclusiveTail = run.catch(() => {});
  return run;
}
/** 等目前已排队的轮询 / 同步全部跑完（测试与排查用） */
function whenIdle() {
  return _exclusiveTail;
}

async function getSyncState() {
  const { [SYNC_STATE_KEY]: map = {} } = await chrome.storage.local.get(SYNC_STATE_KEY);
  return map;
}
/** 记一次推送尝试；成功时（hash 非空）同时记指纹与成功时间 */
async function recordPush(accountId, at, hash) {
  const map = await getSyncState();
  const prev = map[accountId] || {};
  map[accountId] = hash ? { ...prev, hash, pushedAt: at, triedAt: at } : { ...prev, triedAt: at };
  await chrome.storage.local.set({ [SYNC_STATE_KEY]: map });
}

/** 「跳过 / 失败」类日志：与上一条相同就不再写（同一原因不刷屏） */
async function logNotice(msg, level) {
  const { [SYNC_NOTICE_KEY]: lastNotice } = await chrome.storage.local.get(SYNC_NOTICE_KEY);
  if (lastNotice === msg) return;
  await chrome.storage.local.set({ [SYNC_NOTICE_KEY]: msg });
  await log(msg, level);
}
async function clearNotice() {
  const { [SYNC_NOTICE_KEY]: lastNotice } = await chrome.storage.local.get(SYNC_NOTICE_KEY);
  if (lastNotice !== undefined) await chrome.storage.local.remove(SYNC_NOTICE_KEY);
}

function waitTabComplete(tabId, timeoutMs = 60000) {
  return new Promise(async (resolve, reject) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") {
        resolve();
        return;
      }
    } catch (e) {
      reject(e);
      return;
    }
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error(t("errTabTimeout")));
    }, timeoutMs);
    function onUpdated(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function refreshGeminiTab() {
  const tabs = await chrome.tabs.query({ url: "*://gemini.google.com/*" });
  if (!tabs.length) {
    return { ok: false, error: t("errNoGeminiTab") };
  }
  const tab = tabs[0];
  await chrome.tabs.reload(tab.id, { bypassCache: false });
  try {
    await waitTabComplete(tab.id);
  } catch {
    await log(t("logTabSlow"), "warn");
  }
  await new Promise((r) => setTimeout(r, 5000));
  return { ok: true, tabId: tab.id };
}

async function handleExpiredAccount(cfg, account, localPsid, localPsidts) {
  const accountId = account.id;
  if (await inCooldown(accountId, cfg.cooldownSeconds)) {
    await log(t("logAccountCooldown", accountId), "info");
    return;
  }
  // 中转站仍报 active 但 is_healthy=false 的账号，日志写「会话失效」而不是「已过期」
  const sessionInvalid = displayStatus(account) === "session_invalid";
  await log(t(sessionInvalid ? "logAccountSessionInvalidSubmit" : "logAccountExpiredSubmit", accountId), "warn");

  const now = Date.now();
  const sub = await submitCookies(cfg, accountId, localPsid, localPsidts);
  // 救火提交也记进同步状态：随后的兜底补推 / cookie 同步看到同一指纹就不会再推一遍
  await recordPush(accountId, now, sub.ok ? await cookieFingerprint(localPsid, localPsidts) : null);
  if (sub.ok) {
    await setCooldown(accountId);
    await log(t("logCookieSubmitted", accountId, sub.via), "success");
    const chk = await checkAccount(cfg, accountId);
    if (chk.ok) {
      if (chk.status === "active") {
        await log(t("logCheckAfterSubmitActive", accountId), "success");
      } else {
        const st = t("statusLabel", accountStatusText(chk.status));
        await log(t("logCheckAfterSubmitStatus", accountId, st), "warn");
      }
    } else {
      await log(t("logCheckAfterSubmitFail", accountId, chk.error), "warn");
    }
  } else {
    await log(t("logSubmitFail", accountId, sub.error), "error");
  }
}

function syncSkipMessage(pick, psid) {
  switch (pick.reason) {
    case "bound-missing":
      return t("logSyncBoundMissing", pick.accountId);
    case "disabled":
      return t("logSyncDisabled", pick.accountId);
    case "ambiguous":
      return t("logSyncAmbiguous", psid.slice(0, 10), pick.candidates.join(", "));
    default:
      return t("logSyncNoMatch", psid.slice(0, 10));
  }
}

/**
 * 主动同步：读浏览器当前 cookie（不刷新标签页）→ 选目标账号 → 指纹与上次成功推送不同、
 * 且距该账号上次推送已满 60 秒 → 推。cookie 变化（防抖后）和每次定时轮询（兜底补推）都走这里；
 * 调用方须持有 exclusive 锁。失败只记日志、不抛，下一轮照常。
 */
async function syncFromStatus(cfg, accounts, trigger) {
  const { psid, psidts } = await readGeminiCookies();
  if (!psid || !psidts) {
    await logNotice(t("logSyncNoLocalCookie"), "info");
    return;
  }
  const pick = pickTarget(accounts, cfg, psid);
  if (!pick.account) {
    await logNotice(syncSkipMessage(pick, psid), pick.reason === "disabled" ? "info" : "warn");
    return;
  }
  const accountId = pick.account.id;
  const hash = await cookieFingerprint(psid, psidts);
  const prev = (await getSyncState())[accountId] || {};
  const now = Date.now();
  if (!shouldPush({ lastHash: prev.hash, newHash: hash, lastAt: prev.triedAt, now, minIntervalMs: SYNC_MIN_INTERVAL_MS })) {
    return;
  }

  const sub = await submitCookies(cfg, accountId, psid, psidts);
  await recordPush(accountId, now, sub.ok ? hash : null);
  if (sub.ok) {
    await clearNotice();
    if (!pick.psidMatch) await log(t("logPsidMismatchStillSubmit", accountId), "info");
    const fromCookie = trigger === "cookie";
    await log(t("logSyncPushed", accountId, sub.via, t(fromCookie ? "syncTriggerCookie" : "syncTriggerPoll")), "success");
  } else {
    await logNotice(t("logSyncPushFail", accountId, sub.error), "error");
  }
}

async function _syncOnceInner(trigger) {
  const cfg = await getConfig();
  if (!cfg.baseUrl) return; // 未配置中转站：定时轮询那边会提示
  const st = await fetchStatus(cfg);
  if (!st.ok) {
    await logNotice(t("logSyncStatusFail", st.error), "warn");
    return;
  }
  await syncFromStatus(cfg, st.accounts, trigger);
}

/** 一次主动同步（cookie 变化防抖到点后调用） */
function syncOnce(trigger = "cookie") {
  return exclusive(() => _syncOnceInner(trigger));
}

let _syncTimer = null;
let _syncFirstAt = 0;
/**
 * 防抖：每次变化都重新等 SYNC_DEBOUNCE_MS，但从第一次变化起最多等 SYNC_MAX_WAIT_MS。
 * worker 若在等待期间被回收，计时器随之丢失——由每次定时轮询的兜底补推接上。
 */
function scheduleSync() {
  const now = Date.now();
  if (_syncTimer) clearTimeout(_syncTimer);
  else _syncFirstAt = now;
  const delay = debounceDelay({ firstAt: _syncFirstAt, now, waitMs: SYNC_DEBOUNCE_MS, maxWaitMs: SYNC_MAX_WAIT_MS });
  _syncTimer = setTimeout(() => {
    _syncTimer = null;
    syncOnce("cookie").catch((e) => console.warn("[sync]", e));
  }, delay);
}

async function pollOnce() {
  if (_pollRunning) return;
  _pollRunning = true;
  try {
    await exclusive(_pollOnceInner);
  } finally {
    _pollRunning = false;
  }
}

/** 救火：刷新本地 Gemini 标签页，读新 cookie，提交给要救的账号 */
async function rescueAccounts(cfg, rescue) {
  const r = await refreshGeminiTab();
  if (!r.ok) { await log(r.error, "error"); return; }

  const { psid: localPsid, psidts: localPsidts } = await readGeminiCookies();
  if (!localPsid) {
    await log(t("logNoPsidAfterRefresh"), "error");
    return;
  }

  let targets;
  if (cfg.accountId) {
    targets = rescue;
    const unmatched = rescue.filter((a) => !isSameAccount(localPsid, a.psid));
    if (unmatched.length) {
      await log(t("logPsidMismatchStillSubmit", cfg.accountId), "info");
    }
  } else {
    targets = rescue.filter((a) => isSameAccount(localPsid, a.psid));
    const mismatched = rescue.filter((a) => !isSameAccount(localPsid, a.psid));
    if (!targets.length) {
      await log(t("logNoAccountIdNoMatch", localPsid.slice(0, 10)), "warn");
      return;
    }
    if (mismatched.length) {
      await log(t("logSkipMismatch", String(mismatched.length), mismatched.map((a) => a.id).join(", ")), "info");
    }
  }

  for (const acc of targets) {
    await handleExpiredAccount(cfg, acc, localPsid, localPsidts);
  }
}

async function _pollOnceInner() {
  const cfg = await getConfig();
  if (!cfg.baseUrl) {
    await log(t("logNoRelayUrl"), "warn");
    return;
  }

  const st = await fetchStatus(cfg);
  if (!st.ok) {
    await log(t("logStatusQueryFail", st.error), "error");
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
    return;
  }

  let accounts = st.accounts;
  if (cfg.accountId) accounts = accounts.filter((a) => a.id === cfg.accountId);

  // 要救的账号：expired，或仍报 active 但 is_healthy === false（兼容 gemini2api 1.6.41～1.6.43）
  const rescue = accounts.filter(needsRefresh);
  const activeCount = accounts.filter((a) => a.status === "active").length;

  if (rescue.length) {
    await chrome.action.setBadgeText({ text: String(rescue.length) });
    await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  } else {
    await chrome.action.setBadgeText({ text: activeCount ? String(activeCount) : "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#1a73e8" });
  }

  if (rescue.length) {
    await rescueAccounts(cfg, rescue);
  } else {
    const statusKey = accounts.map((a) => `${a.id}:${a.status}`).join("|");
    const { [LAST_STATUS_KEY]: lastKey } = await chrome.storage.local.get(LAST_STATUS_KEY);
    if (statusKey !== lastKey) {
      const ids = accounts.map((a) => a.id).join(", ");
      const idsPart = ids ? t("logCheckOkIds", ids) : "";
      await log(t("logCheckOk", String(activeCount), idsPart), "info");
      await chrome.storage.local.set({ [LAST_STATUS_KEY]: statusKey });
    }
  }

  // 兜底补推：MV3 service worker 可能在 cookie 变化的防抖期间被回收，所以每轮轮询都对一次指纹；
  // 救火刚推过的话指纹相同，这里自然跳过。
  await syncFromStatus(cfg, st.accounts, "poll");
}

async function rearmAlarm() {
  const cfg = await getConfig();
  const mins = Math.max(0.5, (cfg.intervalSeconds || 60) / 60);
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: mins });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) pollOnce();
});

// 主动同步：必须在顶层同步注册，MV3 service worker 被回收后才能被 cookie 变化事件唤醒
chrome.cookies.onChanged.addListener((changeInfo) => {
  if (isAuthCookieChange(changeInfo)) scheduleSync();
});

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id }).catch((e) => console.warn("[sidePanel] open failed:", e));
});

chrome.runtime.onInstalled.addListener(() => {
  rearmAlarm();
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  }
  log(t("logInstalled"), "info");
  pollOnce().catch((e) => console.warn("[pollOnce]", e));
});
chrome.runtime.onStartup.addListener(() => {
  rearmAlarm();
  pollOnce().catch((e) => console.warn("[pollOnce]", e));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.intervalSeconds) rearmAlarm();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "poll-now") {
    pollOnce().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg && msg.type === "clear-log") {
    chrome.storage.local.set({ [LOG_KEY]: [] }).then(() => {
      log(t("logCleared"), "info");
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg && msg.type === "refresh-now") {
    // 与轮询 / 主动同步共用一把锁（都会写同步状态、都可能推 cookie）
    exclusive(async () => {
      const cfg = await getConfig();
      const st = await fetchStatus(cfg);
      if (!st.ok) { await log(t("logForceRefreshFail", st.error), "error"); sendResponse({ ok: false }); return; }

      const r = await refreshGeminiTab();
      if (!r.ok) { await log(r.error, "error"); sendResponse({ ok: false }); return; }

      const { psid, psidts } = await readGeminiCookies();
      if (!psid) { await log(t("logNoLocalPsid"), "error"); sendResponse({ ok: false }); return; }

      let target;
      if (cfg.accountId) {
        target = st.accounts.find((a) => a.id === cfg.accountId);
        if (!target) {
          await log(t("logRelayNoAccount", cfg.accountId), "error");
          sendResponse({ ok: false }); return;
        }
        if (!isSameAccount(psid, target.psid)) {
          await log(t("logPsidMismatchStillSubmit", cfg.accountId), "info");
        }
      } else {
        target = st.accounts.find((a) => isSameAccount(psid, a.psid));
        if (!target) {
          await log(t("logNoAccountIdMatch", psid.slice(0, 10)), "warn");
          sendResponse({ ok: false }); return;
        }
      }
      await handleExpiredAccount({ ...cfg, cooldownSeconds: 0 }, target, psid, psidts);
      sendResponse({ ok: true });
    });
    return true;
  }
});

export {
  log,
  inCooldown,
  setCooldown,
  refreshGeminiTab,
  pollOnce,
  rearmAlarm,
  syncOnce,
  scheduleSync,
  whenIdle,
  ALARM_NAME,
  LOG_KEY,
  SYNC_STATE_KEY,
};
