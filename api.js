// api.js —— 与中转站（gemini2api）admin API 的对接封装
//
// 端点（已在服务端就绪）：
//   GET  /admin/status                      查账号状态 {accounts:[{id,status,psid,...}]}
//   PUT  /admin/accounts/{id}/cookies        按账号更新 {psid, psidts}
//   POST /admin/reload-cookies               全局兜底 {psid, psidts}
// 鉴权：Authorization: Bearer <API_KEY>

/**
 * 读取插件配置（中转站 URL / API Key / 账号 ID / 轮询间隔）。
 */
async function getConfig() {
  const d = await chrome.storage.sync.get({
    baseUrl: "",
    apiKey: "",
    accountId: "",       // 可选，留空则对所有 expired 账号处理
    intervalSeconds: 60,
    cooldownSeconds: 120,
  });
  return d;
}

function normalizeBase(baseUrl) {
  return (baseUrl || "").replace(/\/+$/, ""); // 去尾部斜杠
}

function authHeaders(apiKey) {
  const h = { "Content-Type": "application/json" };
  if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
  return h;
}

/**
 * 查询中转站账号状态。返回 {ok, accounts, error}。
 */
async function fetchStatus(cfg) {
  const base = normalizeBase(cfg.baseUrl);
  if (!base) return { ok: false, error: "未配置中转站地址" };
  try {
    const resp = await fetch(`${base}/admin/status`, {
      method: "GET",
      headers: authHeaders(cfg.apiKey),
    });
    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}: ${(await resp.text()).slice(0, 120)}` };
    }
    const data = await resp.json();
    return { ok: true, accounts: data.accounts || [], raw: data };
  } catch (e) {
    return { ok: false, error: `请求失败: ${e.message}` };
  }
}

/**
 * 提交新 cookie 给中转站。有 accountId 用 PUT 精确更新，否则用 POST 全局兜底。
 * 返回 {ok, via, error}。
 */
async function submitCookies(cfg, accountId, psid, psidts) {
  const base = normalizeBase(cfg.baseUrl);
  if (!base) return { ok: false, error: "未配置中转站地址" };
  const body = JSON.stringify({ psid, psidts: psidts || "" });

  if (accountId) {
    try {
      const resp = await fetch(`${base}/admin/accounts/${encodeURIComponent(accountId)}/cookies`, {
        method: "PUT",
        headers: authHeaders(cfg.apiKey),
        body,
      });
      if (resp.ok) return { ok: true, via: `PUT accounts/${accountId}` };
      if (resp.status !== 404) {
        return { ok: false, error: `PUT 失败 HTTP ${resp.status}: ${(await resp.text()).slice(0, 120)}` };
      }
      // 404 落到全局兜底
    } catch (e) {
      return { ok: false, error: `PUT 请求失败: ${e.message}` };
    }
  }

  // 全局兜底
  try {
    const resp = await fetch(`${base}/admin/reload-cookies`, {
      method: "POST",
      headers: authHeaders(cfg.apiKey),
      body,
    });
    if (resp.ok) return { ok: true, via: "POST reload-cookies" };
    return { ok: false, error: `reload 失败 HTTP ${resp.status}: ${(await resp.text()).slice(0, 120)}` };
  } catch (e) {
    return { ok: false, error: `reload 请求失败: ${e.message}` };
  }
}

export { getConfig, fetchStatus, submitCookies, normalizeBase };
