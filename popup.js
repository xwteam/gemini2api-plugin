// popup.js —— 状态面板：展示账号状态、动作日志，手动触发检查/刷新
import { getConfig, fetchStatus } from "./api.js";
import { maskCookie } from "./cookies.js";

const $ = (id) => document.getElementById(id);

async function renderAccounts() {
  const box = $("accounts");
  const cfg = await getConfig();
  if (!cfg.baseUrl) {
    box.innerHTML = `<div class="empty">未配置中转站，请点右上角“设置”</div>`;
    return;
  }
  box.innerHTML = `<div class="empty">查询中…</div>`;
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

async function refreshAll() {
  await Promise.all([renderAccounts(), renderLog()]);
}

$("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
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
