// options.js —— 设置页逻辑：加载/保存配置，动态申请中转站域权限，测试连接
import { fetchStatus, normalizeBase, getConfig } from "./api.js";
import { t, localizePage } from "./i18n.js";

const $ = (id) => document.getElementById(id);
const fields = ["baseUrl", "apiKey", "intervalSeconds", "cooldownSeconds"];

function msg(text, ok) {
  const el = $("msg");
  el.textContent = text;
  el.className = ok ? "ok" : "err";
}

async function load() {
  const d = await getConfig();
  for (const f of fields) $(f).value = d[f];
}

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
    intervalSeconds: Math.max(30, parseInt($("intervalSeconds").value, 10) || 60),
    cooldownSeconds: Math.max(30, parseInt($("cooldownSeconds").value, 10) || 120),
  };
  if (!cfg.baseUrl) { msg(t("msgFillBaseUrl"), false); return; }

  await chrome.storage.local.set(cfg);

  const granted = await ensureHostPermission(cfg.baseUrl);
  if (granted) {
    msg(t("msgSavedOk"), true);
  } else {
    msg(t("msgSavedNoPerm"), false);
  }
}

async function test() {
  const baseUrl = normalizeBase($("baseUrl").value.trim());
  if (!baseUrl) { msg(t("msgFillBaseUrlFirst"), false); return; }
  const granted = await ensureHostPermission(baseUrl);
  if (!granted) { msg(t("msgNoPerm"), false); return; }

  msg(t("msgTesting"), true);
  const st = await fetchStatus({ baseUrl, apiKey: $("apiKey").value.trim() });
  if (st.ok) {
    const ids = st.accounts.map((a) => `${a.id}:${a.status}`).join(", ");
    msg(t("msgConnectOk", ids || t("msgNoAccounts")), true);
  } else {
    msg(t("msgConnectFail", st.error), false);
  }
}

$("save").addEventListener("click", save);
$("test").addEventListener("click", test);
document.addEventListener("DOMContentLoaded", () => {
  localizePage();
  load();
});
