// popup.js（侧边栏）渲染测试：用最小 DOM stub 跑真实的 renderAccounts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome, flush, waitFor } from "./helpers/fake-chrome.mjs";

function fakeDocument() {
  const els = new Map();
  const byId = (id) => {
    if (!els.has(id)) {
      els.set(id, {
        id,
        innerHTML: "",
        textContent: "",
        value: "",
        className: "",
        addEventListener() {},
        setAttribute() {},
      });
    }
    return els.get(id);
  };
  const listeners = {};
  const document = {
    getElementById: byId,
    querySelectorAll: () => [],
    documentElement: { dataset: {}, lang: "" },
    visibilityState: "visible",
    title: "",
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
  };
  return { document, byId, listeners };
}

let seq = 0;

/** 装好全局 chrome / fetch / document，加载一份全新的 popup.js 并触发 DOMContentLoaded */
async function loadPopup(t, fake) {
  const { document, byId, listeners } = fakeDocument();
  const saved = { chrome: globalThis.chrome, fetch: globalThis.fetch, document: globalThis.document };
  const had = { chrome: "chrome" in globalThis, document: "document" in globalThis };
  t.after(() => {
    globalThis.fetch = saved.fetch;
    for (const k of ["chrome", "document"]) {
      if (had[k]) globalThis[k] = saved[k];
      else delete globalThis[k];
    }
  });
  globalThis.chrome = fake.chrome;
  globalThis.fetch = fake.fetch;
  globalThis.document = document;
  await import(new URL(`../popup.js?instance=${++seq}`, import.meta.url).href);
  for (const fn of listeners.DOMContentLoaded || []) fn();
  return { byId };
}

test("侧边栏：旧中转站仍报 active 但 is_healthy=false 显示红色「会话失效」，≥ 1.6.44 显示「不健康」，其余状态文案不变", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] }); // popup 有 15 秒的刷新 setInterval
  const fake = createFakeChrome({
    local: { baseUrl: "http://relay.test:5918", apiKey: "sk-test" },
    relay: {
      accounts: [
        { id: "acc0", psid: "g.a0****1234", status: "active", is_healthy: false },
        { id: "acc1", psid: "g.a0****5678", status: "active", is_healthy: true },
        { id: "acc2", psid: "g.a0****9999", status: "expired", is_healthy: false },
        { id: "acc3", psid: "g.a0****0000", status: "active" },
        { id: "acc4", psid: "g.a0****4444", status: "active", is_healthy: false, keepalive_mode: "browser" },
        { id: "acc5", psid: "g.a0****5555", status: "expired", is_healthy: false, keepalive_mode: "browser" },
      ],
    },
  });
  const { byId } = await loadPopup(t, fake);
  await waitFor(() => byId("accounts").innerHTML.includes("acc5"));

  const html = byId("accounts").innerHTML;
  const badgeOf = (id) => {
    const m = html.match(new RegExp(`<b>${id}</b>.*?<span class="badge (\\w+)">([^<]*)</span>`, "s"));
    assert.ok(m, `${id} 没渲染出来：${html}`);
    return { cls: m[1], text: m[2] };
  };
  assert.deepEqual(badgeOf("acc0"), { cls: "expired", text: "Session invalid" });
  assert.deepEqual(badgeOf("acc1"), { cls: "active", text: "Active" });
  assert.deepEqual(badgeOf("acc2"), { cls: "expired", text: "Expired" });
  assert.deepEqual(badgeOf("acc3"), { cls: "active", text: "Active" }, "旧服务端没有 is_healthy 字段时照旧显示活动");
  assert.deepEqual(badgeOf("acc4"), { cls: "unhealthy", text: "Unhealthy" }, "≥ 1.6.44 的不健康是中转站自身问题，不是会话失效");
  assert.deepEqual(badgeOf("acc5"), { cls: "expired", text: "Expired" });
  assert.deepEqual(fake.calls.missingI18n, []);
});

// v1.4.0：本地 Cookie 区显示「读到 N 个（含 OSID）」，任何 cookie 值都不明文出现
const PSID = "g.a000AAAAbbbbCCCCddddEEEEffffGGGGhhhhIIIIjjjjKKKK1234";
const PSIDTS = "sidts-CjEB_first_value_xxxxxxxxxxxxxxxx";
const jarOf = ({ osid = "osid-gemini-host-only-value-1111" } = {}) => ({
  "__Secure-1PSID": PSID,
  "__Secure-1PSIDTS": PSIDTS,
  SID: "sid-value-aaaaaaaaaaaa",
  ...(osid ? { OSID: { value: osid, domain: "gemini.google.com", hostOnly: true } } : {}),
  "__Host-GAPS": { value: "gaps-value-cccccccccccc", domain: "accounts.google.com", hostOnly: true },
});
const relayOf = () => ({ accounts: [{ id: "acc0", psid: "g.a0****1234", status: "active", is_healthy: true }] });

test("侧边栏 Cookie 区：完整 Cookie 只显示个数和含不含 OSID，不显示值", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const jar = jarOf();
  const fake = createFakeChrome({ local: { baseUrl: "http://relay.test:5918", apiKey: "sk-test", accountId: "acc0" }, jar, relay: relayOf() });
  const { byId } = await loadPopup(t, fake);
  await waitFor(() => byId("cookieBody").innerHTML.includes("Full cookie set") && byId("cookieBody").innerHTML.includes("acc0"));
  const html = byId("cookieBody").innerHTML;
  assert.match(html, /Full cookie set.*4 read \(incl\. OSID\)/s, html);
  assert.ok(!html.includes("No gemini.google.com OSID found"), html);
  for (const c of [PSID, PSIDTS, "sid-value-aaaaaaaaaaaa", "osid-gemini-host-only-value-1111", "gaps-value-cccccccccccc"]) {
    assert.ok(!html.includes(c), `侧边栏出现了完整 cookie 值 ${c.slice(0, 6)}…`);
  }
  assert.ok(html.includes("g.a000…1234"), "PSID 照旧打码显示");
  assert.deepEqual(fake.calls.missingI18n, []);
});

test("侧边栏 Cookie 区：没读到 gemini.google.com 的 OSID → 标「缺 OSID」并提示去打开 Gemini", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const fake = createFakeChrome({ local: { baseUrl: "http://relay.test:5918", apiKey: "sk-test", accountId: "acc0" }, jar: jarOf({ osid: null }), relay: relayOf() });
  const { byId } = await loadPopup(t, fake);
  await waitFor(() => byId("cookieBody").innerHTML.includes("Full cookie set") && byId("cookieBody").innerHTML.includes("acc0"));
  const html = byId("cookieBody").innerHTML;
  assert.match(html, /3 read \(no OSID\)/, html);
  assert.ok(html.includes("No gemini.google.com OSID found"), html);
  assert.deepEqual(fake.calls.missingI18n, []);
});

test("侧边栏 Cookie 区：读不到完整 Cookie（getAll 出错）时照旧显示 PSID/PSIDTS，完整 Cookie 一行标未读到", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  t.mock.method(console, "warn", () => {});
  const fake = createFakeChrome({ local: { baseUrl: "http://relay.test:5918", apiKey: "sk-test", accountId: "acc0" }, jar: jarOf(), relay: relayOf() });
  fake.chrome.cookies.getAll = async () => {
    throw new Error("getAll boom");
  };
  const { byId } = await loadPopup(t, fake);
  await waitFor(() => byId("cookieBody").innerHTML.includes("Full cookie set") && byId("cookieBody").innerHTML.includes("acc0"));
  const html = byId("cookieBody").innerHTML;
  assert.match(html, /Full cookie set.*✗ Not found/s, html);
  assert.ok(html.includes("g.a000…1234"));
});

test("侧边栏：gemini.google.com 的 OSID 变化也刷新 Cookie 区，*PSIDCC 变化不刷新", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const fake = createFakeChrome({ local: { baseUrl: "http://relay.test:5918", apiKey: "sk-test", accountId: "acc0" }, jar: jarOf(), relay: relayOf() });
  const { byId } = await loadPopup(t, fake);
  await waitFor(() => byId("cookieBody").innerHTML.includes("acc0"));
  const fire = (name, domain) => {
    for (const fn of [...fake.events.cookies.fns]) fn({ removed: false, cause: "explicit", cookie: { name, domain, path: "/", value: "x" } });
  };
  const before = fake.calls.cookiesGetAll.length;
  fire("__Secure-1PSIDCC", ".google.com");
  fire("OSID", "mail.google.com");
  await flush(20);
  assert.equal(fake.calls.cookiesGetAll.length, before, "常变 cookie / 别的服务的 OSID 不该触发重读");
  fake.jar.OSID = null;
  fire("OSID", "gemini.google.com");
  await waitFor(() => byId("cookieBody").innerHTML.includes("3 read (no OSID)"));
});
