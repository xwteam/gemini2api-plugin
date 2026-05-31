// popup.js —— 状态面板：展示账号状态、本地 Cookie、动作日志，手动触发检查/刷新
import { getConfig, fetchStatus } from "./api.js";
import { readGeminiCookies, isSameAccount, maskCookie, COOKIE_PSID, COOKIE_PSIDTS } from "./cookies.js";

const $ = (id) => document.getElementById(id);
let showFullCookie = false; // 是否显示完整 cookie 值

async function renderAccounts(silent = false) {
  const box = $("accounts");
  const cfg = await getConfig();
  if (!cfg.baseUrl) {
    box.innerHTML = `<div class="empty">未配置中转站，请点右上角“设置”</div>`;
    return;
  }
  if (!silent) box.innerHTML = `<div class="empty">查询中…</div>`;
  const st = await fetchStatus(cfg);
  if (!st.ok) {
    box.innerHTML = `<div class="empty" style="color:#d93025">查询失败：${st.error}</div>`;
    return;
  }
  let list = st.accounts;
  if (cfg.accountId) list = list.filter((a) => a.id === cfg.accountId);
  if (!list.length) {
    box.innerHTML = `<div class="empty">中转站无账号</div>`;
    return;
  }
  box.innerHTML = list.map((a) => {
    const cls = a.status === "active" ? "active" : "expired";
    const label = a.status === "active" ? "活动" : "已过期";
    const ck = a.psid ? `<div class="cookie">PSID ${maskCookie(a.psid)}</div>` : "";
    return `<div class="acct"><div><b>${a.id}</b>${ck}</div><span class="badge ${cls}">${label}</span></div>`;
  }).join("");
}

async function renderLog() {
  const { actionLog = [] } = await chrome.storage.local.get("actionLog");
  const el = $("log");
  if (!actionLog.length) { el.innerHTML = `<div class="empty">暂无动作记录</div>`; return; }
  el.innerHTML = actionLog.map((e) =>
    `<div class="line ${e.level}">${e.ts} · ${e.msg}</div>`
  ).join("");
}

// 显示本地浏览器读到的 Gemini Cookie，方便排查“到底有没有读到”
async function renderCookie() {
  const box = $("cookieBody");
  const { psid, psidts } = await readGeminiCookies();

  const fmt = (v) => v ? (showFullCookie ? v : maskCookie(v)) : null;
  const row = (name, v) => {
    if (!v) return `<div class="ck-row"><span class="ck-name">${name}</span><span class="ck-val ck-miss">✗ 未读到</span></div>`;
    return `<div class="ck-row"><span class="ck-name">${name} <span class="ck-ok">✓ ${v.length}字</span></span><span class="ck-val">${fmt(v)}</span></div>`;
  };

  let html = row("__Secure-1PSID", psid) + row("__Secure-1PSIDTS", psidts);

  if (!psid) {
    html += `<div class="ck-match ck-miss">本浏览器未登录 Gemini，请先打开并登录 gemini.google.com</div>`;
  } else {
    // 和当前选中/匹配账号比对
    const cfg = await getConfig();
    if (cfg.baseUrl) {
      const st = await fetchStatus(cfg);
      if (st.ok) {
        let list = st.accounts;
        if (cfg.accountId) list = list.filter((a) => a.id === cfg.accountId);
        const matched = list.find((a) => isSameAccount(psid, a.psid));
        if (matched) {
          html += `<div class="ck-match ck-ok">✓ 与中转站账号 ${matched.id} 匹配（本浏览器负责它）</div>`;
        } else {
          html += `<div class="ck-match ck-miss">⚠ 与中转站任何账号都不匹配，提交会被拒绝（多账号请用独立浏览器）</div>`;
        }
      }
    }
  }
  box.innerHTML = html;
}

async function refreshAll() {
  await Promise.all([renderAccounts(), renderLog(), renderCookie()]);
}

$("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("readCookie").addEventListener("click", () => renderCookie());
$("toggleCookie").addEventListener("click", () => {
  showFullCookie = !showFullCookie;
  $("toggleCookie").textContent = showFullCookie ? "🙈 隐藏" : "👁 显示完整";
  renderCookie();
});
$("clearLog").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clear-log" });
  await renderLog();
});
$("pollNow").addEventListener("click", async () => {
  $("pollNow").textContent = "检查中…";
  await chrome.runtime.sendMessage({ type: "poll-now" });
  await refreshAll();
  $("pollNow").textContent = "立即检查";
});
$("refreshNow").addEventListener("click", async () => {
  if (!confirm("将刷新本地 Gemini 标签页并把新 Cookie 提交到中转站，确定？")) return;
  $("refreshNow").textContent = "处理中…";
  await chrome.runtime.sendMessage({ type: "refresh-now" });
  await refreshAll();
  $("refreshNow").textContent = "强制刷新提交";
});

document.addEventListener("DOMContentLoaded", refreshAll);

// 侧边栏常驻，需要持续更新（弹窗时代只在打开时刷一次就够，侧边栏不行）：
// 1) 监听日志/状态变化，实时刷新日志区
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.actionLog) renderLog();
});
// 2) 定时刷新账号状态（远程数据，需主动拉）；面板隐藏时跳过省资源
const PANEL_REFRESH_MS = 15000;
setInterval(() => {
  if (document.visibilityState === "visible") renderAccounts(true);
}, PANEL_REFRESH_MS);
// 3) 面板重新可见时立即刷新一次
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshAll();
});
// 4) 监听 Gemini Cookie 变化：不管是插件刷新、还是 Google 后台轮换、或你手动重登，
//    只要那两个 cookie 一变，Cookie 显示区立刻更新，绝不显示旧值
chrome.cookies.onChanged.addListener((info) => {
  const n = info.cookie?.name;
  const d = info.cookie?.domain || "";
  if ((n === COOKIE_PSID || n === COOKIE_PSIDTS) && d.includes("google.com")) {
    renderCookie();
  }
});
