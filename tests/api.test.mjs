// api.js：提交 cookie 的两个接口必须带 X-Gemini2API-Keepalive（gemini2api ≥ 1.6.44 据此标「浏览器保活」）
import { test } from "node:test";
import assert from "node:assert/strict";
import { submitCookies, KEEPALIVE_HEADER, keepaliveHeaderValue } from "../api.js";

const BASE = "http://relay.test:5918/";

/** 装一个最小的 chrome stub（用例结束时还原，测试可能和别的文件同进程跑） */
function stubChrome(t, version = "1.3.0") {
  const had = "chrome" in globalThis;
  const prev = globalThis.chrome;
  globalThis.chrome = {
    runtime: { getManifest: () => ({ manifest_version: 3, version }) },
    i18n: {
      getMessage: (key, subs = []) => [key, ...[].concat(subs)].join("|"),
      getUILanguage: () => "en-US",
    },
  };
  t.after(() => {
    if (had) globalThis.chrome = prev;
    else delete globalThis.chrome;
  });
}

/** 记录 fetch 调用；respond(url, init) 返回 { status, body } */
function stubFetch(t, respond = () => ({ status: 200, body: { status: "ok" } })) {
  const calls = [];
  const prev = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || "GET", headers: { ...(init.headers || {}) }, body: init.body });
    const { status, body } = respond(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  t.after(() => {
    globalThis.fetch = prev;
  });
  return calls;
}

test("PUT /admin/accounts/{id}/cookies 带 X-Gemini2API-Keepalive: gemini2api-plugin/<manifest 版本>", async (t) => {
  stubChrome(t, "1.3.0");
  const calls = stubFetch(t);
  const r = await submitCookies({ baseUrl: BASE, apiKey: "sk-x" }, "acc 0", "PSID-VALUE", "PSIDTS-VALUE");
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  const [c] = calls;
  assert.equal(c.method, "PUT");
  assert.equal(c.url, "http://relay.test:5918/admin/accounts/acc%200/cookies");
  assert.equal(c.headers["X-Gemini2API-Keepalive"], "gemini2api-plugin/1.3.0");
  assert.equal(c.headers.Authorization, "Bearer sk-x");
  assert.equal(c.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(c.body), { psid: "PSID-VALUE", psidts: "PSIDTS-VALUE" });
});

test("POST /admin/reload-cookies（没有账号 ID 时）同样带这个头", async (t) => {
  stubChrome(t, "1.3.0");
  const calls = stubFetch(t);
  const r = await submitCookies({ baseUrl: BASE, apiKey: "" }, "", "PSID-VALUE", null);
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
  const [c] = calls;
  assert.equal(c.method, "POST");
  assert.equal(c.url, "http://relay.test:5918/admin/reload-cookies");
  assert.equal(c.headers["X-Gemini2API-Keepalive"], "gemini2api-plugin/1.3.0");
  assert.equal(c.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(c.body), { psid: "PSID-VALUE", psidts: "" });
});

test("头里的版本号取自 chrome.runtime.getManifest().version，不写死", async (t) => {
  stubChrome(t, "9.8.7");
  const calls = stubFetch(t);
  await submitCookies({ baseUrl: BASE, apiKey: "sk-x" }, "acc0", "P", "T");
  await submitCookies({ baseUrl: BASE, apiKey: "sk-x" }, "", "P", "T");
  assert.deepEqual(
    calls.map((c) => c.headers["X-Gemini2API-Keepalive"]),
    ["gemini2api-plugin/9.8.7", "gemini2api-plugin/9.8.7"],
  );
});

test("提交失败照常返回 { ok: false, error }，不抛异常", async (t) => {
  stubChrome(t);
  stubFetch(t, () => ({ status: 503, body: { error: { message: "Cookie reload failed" } } }));
  const r = await submitCookies({ baseUrl: BASE, apiKey: "sk-x" }, "acc0", "P", "T");
  assert.equal(r.ok, false);
  assert.match(r.error, /^errPutFail\|503\|/);
});

test("导出的常量 / 值格式", () => {
  assert.equal(KEEPALIVE_HEADER, "X-Gemini2API-Keepalive");
  assert.equal(keepaliveHeaderValue("1.2.3"), "gemini2api-plugin/1.2.3");
});
