// popup.js —— 状态面板：展示账号状态、本地 Cookie、动作日志，手动触发检查/刷新
import { getConfig, fetchStatus } from "./api.js";
import { readGeminiCookies, isSameAccount, maskCookie, COOKIE_PSID, COOKIE_PSIDTS } from "./cookies.js";
import { t, localizePage, accountStatusText } from "./i18n.js";

const $ = (id) => document.getElementById(id);
let showFullCookie = false;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function statusLabel(status, coolingDown) {
  const text = accountStatusText(status, coolingDown);
  let cls = "expired";
  if (coolingDown || status === "expired" || status === "disabled") cls = "expired";
  else if (status === "active" || status === "refreshing") cls = "active";
  return { cls, text };
}

async function renderAccounts(silent = false) {
  const box = $("accounts");
  const cfg = await getConfig();
  if (!cfg.baseUrl) {
    box.innerHTML = `<div class="empty">${escapeHtml(t("noRelayConfigured"))}</div>`;
    return;
  }
  if (!silent) box.innerHTML = `<div class="empty">${escapeHtml(t("querying"))}</div>`;
  const st = await fetchStatus(cfg);
  if (!st.ok) {
    box.innerHTML = `<div class="empty" style="color:#d93025">${escapeHtml(t("queryFailed", st.error))}</div>`;
    return;
  }
  let list = st.accounts;
  if (cfg.accountId) list = list.filter((a) => a.id === cfg.accountId);
  if (!list.length) {
    box.innerHTML = `<div class="empty">${escapeHtml(t("noAccounts"))}</div>`;
    return;
  }
  box.innerHTML = list.map((a) => {
    const { cls, text: label } = statusLabel(a.status, a.cooling_down);
    const id = escapeHtml(a.id);
    const ck = a.psid ? `<div class="cookie">PSID ${escapeHtml(maskCookie(a.psid, t("cookieEmpty")))}</div>` : "";
    return `<div class="acct"><div><b>${id}</b>${ck}</div><span class="badge ${cls}">${escapeHtml(label)}</span></div>`;
  }).join("");
}

async function renderLog() {
  const { actionLog = [] } = await chrome.storage.local.get("actionLog");
  const el = $("log");
  if (!actionLog.length) { el.innerHTML = `<div class="empty">${escapeHtml(t("noLogEntries"))}</div>`; return; }
  el.innerHTML = actionLog.map((e) =>
    `<div class="line ${escapeHtml(e.level)}">${escapeHtml(e.ts)} · ${escapeHtml(e.msg)}</div>`
  ).join("");
}

async function renderCookie() {
  const box = $("cookieBody");
  const { psid, psidts } = await readGeminiCookies();
  const empty = t("cookieEmpty");

  const fmt = (v) => v ? escapeHtml(showFullCookie ? v : maskCookie(v, empty)) : null;
  const row = (name, v) => {
    if (!v) return `<div class="ck-row"><span class="ck-name">${escapeHtml(name)}</span><span class="ck-val ck-miss">${escapeHtml(t("cookieNotRead"))}</span></div>`;
    return `<div class="ck-row"><span class="ck-name">${escapeHtml(name)} <span class="ck-ok">${escapeHtml(t("cookieChars", String(v.length)))}</span></span><span class="ck-val">${fmt(v)}</span></div>`;
  };

  let html = row("__Secure-1PSID", psid) + row("__Secure-1PSIDTS", psidts);

  if (!psid) {
    html += `<div class="ck-match ck-miss">${escapeHtml(t("notLoggedInGemini"))}</div>`;
  } else {
    const cfg = await getConfig();
    if (cfg.baseUrl) {
      const st = await fetchStatus(cfg);
      if (st.ok) {
        if (cfg.accountId) {
          const acct = st.accounts.find((a) => a.id === cfg.accountId);
          if (!acct) {
            html += `<div class="ck-match ck-miss">${escapeHtml(t("relayNoAccount", cfg.accountId))}</div>`;
          } else if (isSameAccount(psid, acct.psid)) {
            html += `<div class="ck-match ck-ok">${escapeHtml(t("cookieMatchOk", cfg.accountId))}</div>`;
          } else {
            html += `<div class="ck-match" style="color:#b06000">${escapeHtml(t("cookieMismatchWarn", cfg.accountId))}</div>`;
          }
        } else {
          const matched = st.accounts.find((a) => isSameAccount(psid, a.psid));
          if (matched) {
            html += `<div class="ck-match ck-ok">${escapeHtml(t("autoMatchOk", matched.id))}</div>`;
          } else {
            html += `<div class="ck-match ck-miss">${escapeHtml(t("noAccountIdMismatch"))}</div>`;
          }
        }
      }
    }
  }
  box.innerHTML = html;
}

async function loadAccountId() {
  const cfg = await getConfig();
  $("accountId").value = cfg.accountId || "";
}

function bindMsg(text, ok) {
  const el = $("bindMsg");
  el.textContent = text;
  el.className = "bind-msg " + (ok ? "ok" : "err");
}

async function saveAccountId() {
  const accountId = $("accountId").value.trim();
  await chrome.storage.local.set({ accountId });
  bindMsg(accountId ? t("boundAccount", accountId) : t("clearedBinding"), true);
  await refreshAll();
}

async function refreshAll() {
  await loadAccountId();
  await Promise.all([renderAccounts(), renderLog(), renderCookie()]);
}

function updateToggleCookieLabel() {
  $("toggleCookie").textContent = t(showFullCookie ? "toggleCookieHide" : "toggleCookieShow");
}

$("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("saveAccountId").addEventListener("click", saveAccountId);
$("accountId").addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveAccountId();
});
$("readCookie").addEventListener("click", () => renderCookie());
$("toggleCookie").addEventListener("click", () => {
  showFullCookie = !showFullCookie;
  updateToggleCookieLabel();
  renderCookie();
});
$("clearLog").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clear-log" });
  await renderLog();
});
$("pollNow").addEventListener("click", async () => {
  $("pollNow").textContent = t("checking");
  await chrome.runtime.sendMessage({ type: "poll-now" });
  await refreshAll();
  $("pollNow").textContent = t("pollNow");
});
$("refreshNow").addEventListener("click", async () => {
  if (!confirm(t("confirmRefresh"))) return;
  $("refreshNow").textContent = t("processing");
  await chrome.runtime.sendMessage({ type: "refresh-now" });
  await refreshAll();
  $("refreshNow").textContent = t("refreshNow");
});

document.addEventListener("DOMContentLoaded", () => {
  localizePage();
  updateToggleCookieLabel();
  refreshAll();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.actionLog) renderLog();
  if (area === "local" && changes.accountId) {
    loadAccountId();
    renderAccounts(true);
    renderCookie();
  }
});

const PANEL_REFRESH_MS = 15000;
setInterval(() => {
  if (document.visibilityState === "visible") renderAccounts(true);
}, PANEL_REFRESH_MS);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshAll();
});

chrome.cookies.onChanged.addListener((info) => {
  const n = info.cookie?.name;
  const d = info.cookie?.domain || "";
  if ((n === COOKIE_PSID || n === COOKIE_PSIDTS) && d.includes("google.com")) {
    renderCookie();
  }
});
