// popup.js（侧边栏）渲染测试：用最小 DOM stub 跑真实的 renderAccounts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome, flush } from "./helpers/fake-chrome.mjs";

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
test("侧边栏：仍报 active 但 is_healthy=false 显示红色「会话失效」，其余状态文案不变", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] }); // popup 有 15 秒的刷新 setInterval
  const fake = createFakeChrome({
    local: { baseUrl: "http://relay.test:5918", apiKey: "sk-test" },
    relay: {
      accounts: [
        { id: "acc0", psid: "g.a0****1234", status: "active", is_healthy: false },
        { id: "acc1", psid: "g.a0****5678", status: "active", is_healthy: true },
        { id: "acc2", psid: "g.a0****9999", status: "expired", is_healthy: false },
        { id: "acc3", psid: "g.a0****0000", status: "active" },
      ],
    },
  });
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
  for (let i = 0; i < 50 && !byId("accounts").innerHTML.includes("acc3"); i++) await flush(2);

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
  assert.deepEqual(fake.calls.missingI18n, []);
});
