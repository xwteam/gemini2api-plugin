// api.js —— 与中转站（gemini2api）admin API 的对接封装
import { t } from "./i18n.js";

async function getConfig() {
  const defaults = {
    baseUrl: "",
    apiKey: "",
    accountId: "",
    intervalSeconds: 60,
    cooldownSeconds: 120,
  };
  const local = await chrome.storage.local.get(defaults);
  if (local.baseUrl) return local;
  const sync = await chrome.storage.sync.get(defaults);
  if (sync.baseUrl) {
    await chrome.storage.local.set(sync);
    return sync;
  }
  return local;
}

function normalizeBase(baseUrl) {
  return (baseUrl || "").replace(/\/+$/, "");
}

function authHeaders(apiKey) {
  const h = { "Content-Type": "application/json" };
  if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
  return h;
}

// 插件身份请求头：gemini2api ≥ 1.6.44 看到它就把该账号标成「浏览器保活」、不再由服务端轮换
// （避免两边各自换 PSIDTS 互相顶掉）；旧服务端会忽略这个头。
const KEEPALIVE_HEADER = "X-Gemini2API-Keepalive";

function keepaliveHeaderValue(version = chrome.runtime.getManifest().version) {
  return `gemini2api-plugin/${version}`;
}

/** 提交 cookie 用的请求头（PUT accounts/{id}/cookies 与 POST reload-cookies 共用） */
function submitHeaders(apiKey) {
  return { ...authHeaders(apiKey), [KEEPALIVE_HEADER]: keepaliveHeaderValue() };
}

async function httpError(resp) {
  const body = (await resp.text()).slice(0, 120);
  return t("errHttpStatus", String(resp.status), body);
}

async function fetchStatus(cfg) {
  const base = normalizeBase(cfg.baseUrl);
  if (!base) return { ok: false, error: t("errNoBaseUrl") };
  try {
    const resp = await fetch(`${base}/admin/status`, {
      method: "GET",
      headers: authHeaders(cfg.apiKey),
    });
    if (!resp.ok) return { ok: false, error: await httpError(resp) };
    const data = await resp.json();
    return { ok: true, accounts: data.accounts || [], raw: data };
  } catch (e) {
    return { ok: false, error: t("errRequestFail", e.message) };
  }
}

/**
 * 提交 cookie：有账号 ID 走 PUT /admin/accounts/{id}/cookies，没有走 POST /admin/reload-cookies。
 * cookies 是 readGeminiSession() 读到的完整 cookie 列表（字段名照 chrome.cookies.Cookie）：
 * 非空就在 { psid, psidts } 之外带上 cookies（gemini2api ≥ 1.6.53 用它整套换上，含 gemini.google.com
 * 的 OSID；旧中转站按 pydantic 默认忽略未知字段，无需版本协商）；为空 / null 时照 1.3.0 只发 psid/psidts。
 */
async function submitCookies(cfg, accountId, psid, psidts, cookies = null) {
  const base = normalizeBase(cfg.baseUrl);
  if (!base) return { ok: false, error: t("errNoBaseUrl") };
  const payload = { psid, psidts: psidts || "" };
  if (Array.isArray(cookies) && cookies.length) payload.cookies = cookies;
  const body = JSON.stringify(payload);

  if (accountId) {
    try {
      const resp = await fetch(`${base}/admin/accounts/${encodeURIComponent(accountId)}/cookies`, {
        method: "PUT",
        headers: submitHeaders(cfg.apiKey),
        body,
      });
      if (resp.ok) return { ok: true, via: `PUT accounts/${accountId}` };
      const errText = (await resp.text()).slice(0, 120);
      if (resp.status === 404) {
        return { ok: false, error: t("errAccountNotFound", accountId) };
      }
      return { ok: false, error: t("errPutFail", String(resp.status), errText) };
    } catch (e) {
      return { ok: false, error: t("errPutRequestFail", e.message) };
    }
  }

  try {
    const resp = await fetch(`${base}/admin/reload-cookies`, {
      method: "POST",
      headers: submitHeaders(cfg.apiKey),
      body,
    });
    if (resp.ok) return { ok: true, via: "POST reload-cookies" };
    return { ok: false, error: t("errReloadFail", String(resp.status), (await resp.text()).slice(0, 120)) };
  } catch (e) {
    return { ok: false, error: t("errReloadRequestFail", e.message) };
  }
}

async function checkAccount(cfg, accountId) {
  const base = normalizeBase(cfg.baseUrl);
  if (!base || !accountId) return { ok: false, error: t("errMissingConfig") };
  try {
    const resp = await fetch(`${base}/admin/accounts/${encodeURIComponent(accountId)}/check`, {
      method: "GET",
      headers: authHeaders(cfg.apiKey),
    });
    if (!resp.ok) return { ok: false, error: await httpError(resp) };
    const data = await resp.json();
    const status = data.status || (data.valid === true ? "active" : data.valid === false ? "expired" : "");
    return { ok: true, status, valid: data.valid, raw: data };
  } catch (e) {
    return { ok: false, error: t("errRequestFail", e.message) };
  }
}

export { getConfig, fetchStatus, submitCookies, checkAccount, normalizeBase, KEEPALIVE_HEADER, keepaliveHeaderValue };
