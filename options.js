// options.js —— 设置页逻辑：加载/保存配置，动态申请中转站域权限，测试连接
import { fetchStatus, normalizeBase } from "./api.js";

const $ = (id) => document.getElementById(id);
const fields = ["baseUrl", "apiKey", "accountId", "intervalSeconds", "cooldownSeconds"];

function msg(text, ok) {
  const el = $("msg");
  el.textContent = text;
  el.className = ok ? "ok" : "err";
}

// 加载已保存配置
async function load() {
  const d = await chrome.storage.sync.get({
    baseUrl: "", apiKey: "", accountId: "",
    intervalSeconds: 60, cooldownSeconds: 120,
  });
  for (const f of fields) $(f).value = d[f];
}

// 为用户填写的中转站域动态申请 host 权限（MV3 处理自定义 URL 的标准做法）
async function ensureHostPermission(baseUrl) {
  const base = normalizeBase(baseUrl);
  if (!base) return false;
  let origin;
  try {
    const u = new URL(base);
    origin = `${u.protocol}//${u.host}/*`;
  } catch {
    return false;
  }
  const has = await chrome.permissions.contains({ origins: [origin] });
  if (has) return true;
  return await chrome.permissions.request({ origins: [origin] });
}

async function save() {
  const cfg = {
    baseUrl: normalizeBase($("baseUrl").value.trim()),
    apiKey: $("apiKey").value.trim(),
    accountId: $("accountId").value.trim(),
    intervalSeconds: Math.max(30, parseInt($("intervalSeconds").value, 10) || 60),
    cooldownSeconds: Math.max(30, parseInt($("cooldownSeconds").value, 10) || 120),
  };
  if (!cfg.baseUrl) { msg("请填写中转站地址", false); return; }

  const granted = await ensureHostPermission(cfg.baseUrl);
  if (!granted) { msg("未授予该中转站的访问权限，无法请求", false); return; }

  await chrome.storage.sync.set(cfg);
  msg("已保存", true);
}

async function test() {
  const baseUrl = normalizeBase($("baseUrl").value.trim());
  if (!baseUrl) { msg("请先填写中转站地址", false); return; }
  const granted = await ensureHostPermission(baseUrl);
  if (!granted) { msg("未授予访问权限", false); return; }

  msg("测试中…", true);
  const st = await fetchStatus({ baseUrl, apiKey: $("apiKey").value.trim() });
  if (st.ok) {
    const ids = st.accounts.map((a) => `${a.id}:${a.status}`).join(", ");
    msg(`连接成功，账号：${ids || "（无）"}`, true);
  } else {
    msg(`连接失败：${st.error}`, false);
  }
}

$("save").addEventListener("click", save);
$("test").addEventListener("click", test);
document.addEventListener("DOMContentLoaded", load);
