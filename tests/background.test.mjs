// background.js 接线测试：用假 chrome.* / fetch 驱动 service worker 的真实代码路径
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome, loadBackground, settle } from "./helpers/fake-chrome.mjs";

const BASE = "http://relay.test:5918";
const PSID = "g.a000AAAAbbbbCCCCddddEEEEffffGGGGhhhhIIIIjjjjKKKK1234";
const OTHER_PSID = "g.a000ZZZZyyyyXXXXwwwwVVVVuuuuTTTTssssRRRRqqqqPPPP9876";
const PSIDTS_1 = "sidts-CjEB_first_value_xxxxxxxxxxxxxxxx";
const masked = (v) => `${v.slice(0, 4)}****${v.slice(-4)}`;
const acct = (over = {}) => ({ id: "acc0", psid: masked(PSID), status: "active", is_healthy: true, cooling_down: false, ...over });
const T0 = 1_700_000_000_000;
const RED = "#d93025";
const BLUE = "#1a73e8";

async function setup(t, { local = {}, accounts = [acct()], jar } = {}) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0 });
  t.mock.method(console, "log", () => {});
  const warns = [];
  t.mock.method(console, "warn", (...args) => warns.push(args));
  const fake = createFakeChrome({
    local: { baseUrl: BASE, apiKey: "sk-test", ...local },
    jar: jar ?? { "__Secure-1PSID": PSID, "__Secure-1PSIDTS": PSIDTS_1 },
    relay: { accounts },
  });
  const had = "chrome" in globalThis;
  const prevChrome = globalThis.chrome;
  const prevFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = prevFetch;
    if (had) globalThis.chrome = prevChrome;
    else delete globalThis.chrome;
  });
  const bg = await loadBackground(fake);
  return { fake, bg, warns };
}

const puts = (fake) => fake.calls.fetch.filter((c) => c.method === "PUT");
const logs = (fake) => (fake.stores.local.actionLog || []).map((e) => e.msg);
const last = (arr) => arr[arr.length - 1];

describe("救火口径：expired 或 is_healthy === false", () => {
  test("绑定账号仍报 active 但 is_healthy=false → 刷新标签页并提交，徽章红色计数，日志写「会话失效」", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" }, accounts: [acct({ is_healthy: false })] });
    await settle(t, bg.pollOnce());
    assert.deepEqual(fake.calls.reload, [1]);
    const p = puts(fake);
    assert.equal(p.length, 1);
    assert.equal(p[0].path, "/admin/accounts/acc0/cookies");
    assert.equal(p[0].headers["X-Gemini2API-Keepalive"], "gemini2api-plugin/1.3.0");
    assert.deepEqual(JSON.parse(p[0].body), { psid: PSID, psidts: PSIDTS_1 });
    assert.equal(last(fake.calls.badgeText), "1");
    assert.equal(last(fake.calls.badgeColor), RED);
    assert.ok(logs(fake).some((m) => m.includes("Account acc0 session invalid")), logs(fake).join("\n"));
    assert.deepEqual(fake.calls.missingI18n, []);
  });

  test("未绑定时只救 PSID 对得上的不健康账号", async (t) => {
    const { fake, bg } = await setup(t, {
      accounts: [acct({ id: "acc1", psid: masked(OTHER_PSID), is_healthy: false }), acct({ id: "acc0", is_healthy: false })],
    });
    await settle(t, bg.pollOnce());
    assert.deepEqual(fake.calls.reload, [1]);
    assert.deepEqual(puts(fake).map((c) => c.path), ["/admin/accounts/acc0/cookies"]);
    assert.equal(last(fake.calls.badgeText), "2");
  });

  test("status expired 照旧救（行为不变）", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" }, accounts: [acct({ status: "expired" })] });
    await settle(t, bg.pollOnce());
    assert.deepEqual(fake.calls.reload, [1]);
    assert.equal(puts(fake).length, 1);
    assert.ok(logs(fake).some((m) => m.includes("Account acc0 expired")));
  });

  test("已禁用的账号即使不健康也不救", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" }, accounts: [acct({ status: "disabled", is_healthy: false })] });
    await settle(t, bg.pollOnce());
    assert.deepEqual(fake.calls.reload, []);
    assert.equal(puts(fake).length, 0);
    assert.notEqual(last(fake.calls.badgeColor), RED);
  });

  test("健康的 active 账号：不刷新标签页，徽章蓝色显示活动数", async (t) => {
    const { fake, bg } = await setup(t, { accounts: [acct(), acct({ id: "acc1", psid: masked(OTHER_PSID) })] });
    await settle(t, bg.pollOnce());
    assert.deepEqual(fake.calls.reload, []);
    assert.equal(last(fake.calls.badgeText), "2");
    assert.equal(last(fake.calls.badgeColor), BLUE);
  });
});
