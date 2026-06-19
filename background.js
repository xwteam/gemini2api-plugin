// background.js —— service worker：定时轮询中转站，过期时刷新本地浏览器并提交新 cookie

import { getConfig, fetchStatus, submitCookies, checkAccount } from "./api.js";

import { readGeminiCookies, isSameAccount } from "./cookies.js";

import { t, formatLogTime } from "./i18n.js";



const ALARM_NAME = "gemini-cookie-poll";

const LOG_KEY = "actionLog";

const COOLDOWN_KEY = "cooldownMap";

const LAST_STATUS_KEY = "lastPollStatus";

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

  await log(t("logAccountExpiredSubmit", accountId), "warn");



  const sub = await submitCookies(cfg, accountId, localPsid, localPsidts);

  if (sub.ok) {

    await setCooldown(accountId);

    await log(t("logCookieSubmitted", accountId, sub.via), "success");

    const chk = await checkAccount(cfg, accountId);

    if (chk.ok) {

      if (chk.status === "active") {

        await log(t("logCheckAfterSubmitActive", accountId), "success");

      } else {

        const st = t("statusLabel", chk.status || t("statusUnknown"));

        await log(t("logCheckAfterSubmitStatus", accountId, st), "warn");

      }

    } else {

      await log(t("logCheckAfterSubmitFail", accountId, chk.error), "warn");

    }

  } else {

    await log(t("logSubmitFail", accountId, sub.error), "error");

  }

}



async function pollOnce() {

  if (_pollRunning) return;

  _pollRunning = true;

  try {

    await _pollOnceInner();

  } finally {

    _pollRunning = false;

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



  const expired = accounts.filter((a) => a.status === "expired");

  const activeCount = accounts.filter((a) => a.status === "active").length;



  if (expired.length) {

    await chrome.action.setBadgeText({ text: String(expired.length) });

    await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });

  } else {

    await chrome.action.setBadgeText({ text: activeCount ? String(activeCount) : "" });

    await chrome.action.setBadgeBackgroundColor({ color: "#1a73e8" });

  }



  if (!expired.length) {

    const statusKey = accounts.map((a) => `${a.id}:${a.status}`).join("|");

    const { [LAST_STATUS_KEY]: lastKey } = await chrome.storage.local.get(LAST_STATUS_KEY);

    if (statusKey !== lastKey) {

      const ids = accounts.map((a) => a.id).join(", ");

      const idsPart = ids ? t("logCheckOkIds", ids) : "";

      await log(t("logCheckOk", String(activeCount), idsPart), "info");

      await chrome.storage.local.set({ [LAST_STATUS_KEY]: statusKey });

    }

    return;

  }



  const r = await refreshGeminiTab();

  if (!r.ok) { await log(r.error, "error"); return; }



  const { psid: localPsid, psidts: localPsidts } = await readGeminiCookies();

  if (!localPsid) {

    await log(t("logNoPsidAfterRefresh"), "error");

    return;

  }



  let targets;

  if (cfg.accountId) {

    targets = expired;

    const unmatched = expired.filter((a) => !isSameAccount(localPsid, a.psid));

    if (unmatched.length) {

      await log(t("logPsidMismatchStillSubmit", cfg.accountId), "info");

    }

  } else {

    targets = expired.filter((a) => isSameAccount(localPsid, a.psid));

    const mismatched = expired.filter((a) => !isSameAccount(localPsid, a.psid));

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



async function rearmAlarm() {

  const cfg = await getConfig();

  const mins = Math.max(0.5, (cfg.intervalSeconds || 60) / 60);

  await chrome.alarms.clear(ALARM_NAME);

  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: mins });

}



chrome.alarms.onAlarm.addListener((alarm) => {

  if (alarm.name === ALARM_NAME) pollOnce();

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

    (async () => {

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

    })();

    return true;

  }

});



export { log, inCooldown, setCooldown, refreshGeminiTab, pollOnce, rearmAlarm, ALARM_NAME, LOG_KEY };

