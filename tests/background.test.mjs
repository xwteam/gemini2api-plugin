// background.js 接线测试：用假 chrome.* / fetch 驱动 service worker 的真实代码路径
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome, flush, loadBackground, settle } from "./helpers/fake-chrome.mjs";

const BASE = "http://relay.test:5918";
const PSID = "g.a000AAAAbbbbCCCCddddEEEEffffGGGGhhhhIIIIjjjjKKKK1234";
const OTHER_PSID = "g.a000ZZZZyyyyXXXXwwwwVVVVuuuuTTTTssssRRRRqqqqPPPP9876";
const PSIDTS_1 = "sidts-CjEB_first_value_xxxxxxxxxxxxxxxx";
const PSIDTS_2 = "sidts-CjEB_second_value_yyyyyyyyyyyyyyy";
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

/** 模拟 chrome.cookies.onChanged 事件 */
function cookieEvent(fake, { name = "__Secure-1PSIDTS", domain = ".google.com", removed = false, cause } = {}) {
  const info = { removed, cause: cause ?? (removed ? "overwrite" : "explicit"), cookie: { name, domain, path: "/", value: "x" } };
  for (const fn of [...fake.events.cookies.fns]) fn(info);
}
/** 模拟定时轮询的 alarm 到点 */
function fireAlarm(fake, name = "gemini-cookie-poll") {
  for (const fn of [...fake.events.alarm.fns]) fn({ name });
}

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
    // 救火提交也记进同步状态，同一轮的兜底补推看到同一指纹不会再推（上面 PUT 只有 1 次）
    assert.match(fake.stores.local.syncState.acc0.hash, /^[0-9a-f]{16}$/);
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

describe("主动同步：cookie 变化 → 防抖 → 推送", () => {
  test("chrome.cookies.onChanged 在模块顶层注册（加载即注册，MV3 才能被事件唤醒），原有监听器都在", async (t) => {
    const { fake } = await setup(t);
    assert.equal(fake.events.cookies.fns.length, 1);
    assert.equal(fake.events.alarm.fns.length, 1);
    assert.equal(fake.events.message.fns.length, 1);
    assert.equal(fake.events.installed.fns.length, 1);
    assert.equal(fake.events.startup.fns.length, 1);
    assert.equal(fake.events.storage.fns.length, 1);
    assert.equal(fake.events.actionClicked.fns.length, 1);
  });

  test("连续变化合并：最后一次变化后约 10 秒推一次，带请求头，不刷新标签页，storage 只存指纹", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" } });
    cookieEvent(fake, { removed: true }); // overwrite：先 removed=true
    cookieEvent(fake); //                    再 removed=false
    t.mock.timers.tick(4_000);
    cookieEvent(fake, { name: "__Secure-1PSID" }); // 4 秒后又变 → 重新计时
    t.mock.timers.tick(9_999);
    await flush();
    assert.equal(fake.calls.fetch.length, 0, "防抖期间不应发请求");
    t.mock.timers.tick(1);
    await bg.whenIdle();
    const p = puts(fake);
    assert.equal(p.length, 1);
    assert.equal(p[0].path, "/admin/accounts/acc0/cookies");
    assert.equal(p[0].headers["X-Gemini2API-Keepalive"], "gemini2api-plugin/1.3.0");
    assert.deepEqual(JSON.parse(p[0].body), { psid: PSID, psidts: PSIDTS_1 });
    assert.deepEqual(fake.calls.reload, [], "主动同步不刷新标签页");
    const st = fake.stores.local.syncState.acc0;
    assert.match(st.hash, /^[0-9a-f]{16}$/);
    assert.equal(st.pushedAt, T0 + 14_000);
    const dump = JSON.stringify(fake.stores.local);
    assert.ok(!dump.includes(PSIDTS_1), "storage 里不能出现 PSIDTS 原值");
    assert.ok(!dump.includes(PSID), "storage 里不能出现 PSID 原值");
    assert.ok(logs(fake).some((m) => m.startsWith("Account acc0 synced") && m.includes("cookie change")));
    assert.deepEqual(fake.calls.missingI18n, []);
  });

  test("只认 google.com 上 __Secure-1PSIDTS / __Secure-1PSID 的写入（removed=false）", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" } });
    cookieEvent(fake, { removed: true, cause: "expired" });
    cookieEvent(fake, { name: "NID" });
    cookieEvent(fake, { name: "__Secure-3PSIDTS" });
    cookieEvent(fake, { domain: "evilgoogle.com" });
    cookieEvent(fake, { domain: ".google.com.evil.example" });
    t.mock.timers.tick(60_000);
    await bg.whenIdle();
    await flush();
    assert.equal(fake.calls.fetch.length, 0);
  });

  test("变化持续不断时，从第一次变化起最多等 30 秒", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" } });
    for (let i = 0; i < 6; i++) {
      cookieEvent(fake);
      t.mock.timers.tick(5_000);
    }
    await bg.whenIdle();
    assert.equal(puts(fake).length, 1);
  });

  test("cookie 与上次成功推送的相同（指纹没变）→ 不重复推", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" } });
    cookieEvent(fake);
    t.mock.timers.tick(10_000);
    await bg.whenIdle();
    assert.equal(puts(fake).length, 1);
    t.mock.timers.tick(120_000);
    cookieEvent(fake);
    t.mock.timers.tick(10_000);
    await bg.whenIdle();
    fireAlarm(fake);
    await bg.whenIdle();
    assert.equal(puts(fake).length, 1);
  });

  test("同一账号两次主动推送至少隔 60 秒；被挡下的新值由定时轮询补推", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" } });
    cookieEvent(fake);
    t.mock.timers.tick(10_000); // T0+10s 第一次推送
    await bg.whenIdle();
    assert.equal(puts(fake).length, 1);
    fake.jar["__Secure-1PSIDTS"] = PSIDTS_2;
    t.mock.timers.tick(20_000);
    cookieEvent(fake);
    t.mock.timers.tick(10_000); // T0+40s：距上次 30 秒，挡下
    await bg.whenIdle();
    assert.equal(puts(fake).length, 1);
    t.mock.timers.tick(30_000); // T0+70s 定时轮询
    fireAlarm(fake);
    await bg.whenIdle();
    const p = puts(fake);
    assert.equal(p.length, 2);
    assert.deepEqual(JSON.parse(p[1].body), { psid: PSID, psidts: PSIDTS_2 });
    assert.ok(logs(fake).some((m) => m.startsWith("Account acc0 synced") && m.includes("poll catch-up")));
  });

  test("防抖期间 service worker 被回收：重启后的下一次定时轮询补推", async (t) => {
    const { fake } = await setup(t, { local: { accountId: "acc0" } });
    cookieEvent(fake); // 旧 worker 里起了 10 秒的防抖计时器……
    fake.killWorker(); // ……没到点 worker 就被回收：监听器和计时器都没了
    t.mock.timers.reset();
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: T0 + 5_000 });
    const bg2 = await loadBackground(fake); // alarm 唤醒一个新 worker
    fireAlarm(fake);
    await bg2.whenIdle();
    const p = puts(fake);
    assert.equal(p.length, 1);
    assert.deepEqual(JSON.parse(p[0].body), { psid: PSID, psidts: PSIDTS_1 });
    assert.ok(logs(fake).some((m) => m.startsWith("Account acc0 synced") && m.includes("poll catch-up")));
  });

  test("cookie 同步与定时轮询同时到点：串行执行，同一份 cookie 只推一次", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" } });
    cookieEvent(fake);
    t.mock.timers.tick(10_000); // cookie 同步开始
    fireAlarm(fake); //              轮询紧接着到点
    await bg.whenIdle();
    await flush();
    assert.equal(puts(fake).length, 1);
  });

  test("没配置中转站：cookie 变化不发任何请求", async (t) => {
    const { fake, bg } = await setup(t, { local: { baseUrl: "" } });
    cookieEvent(fake);
    t.mock.timers.tick(10_000);
    await bg.whenIdle();
    assert.equal(fake.calls.fetch.length, 0);
  });
});

describe("主动同步：目标账号", () => {
  test("未绑定账号 ID：推给 PSID 匹配到的账号", async (t) => {
    const { fake, bg } = await setup(t, { accounts: [acct({ id: "acc1", psid: masked(OTHER_PSID) }), acct({ id: "acc0" })] });
    cookieEvent(fake);
    t.mock.timers.tick(10_000);
    await bg.whenIdle();
    assert.deepEqual(puts(fake).map((c) => c.path), ["/admin/accounts/acc0/cookies"]);
  });

  test("未绑定且没有账号匹配：跳过，同一原因只记一条日志", async (t) => {
    const { fake, bg } = await setup(t, { accounts: [acct({ id: "acc1", psid: masked(OTHER_PSID) })] });
    for (let i = 0; i < 3; i++) {
      fireAlarm(fake);
      await bg.whenIdle();
      t.mock.timers.tick(60_000);
    }
    cookieEvent(fake);
    t.mock.timers.tick(10_000);
    await bg.whenIdle();
    assert.equal(puts(fake).length, 0);
    const skips = logs(fake).filter((m) => m.startsWith("Sync skipped"));
    assert.equal(skips.length, 1, skips.join("\n"));
    assert.ok(skips[0].includes(`PSID(${PSID.slice(0, 10)}…)`));
  });

  test("未绑定且 PSID 同时匹配多个账号：不猜，跳过", async (t) => {
    const { fake, bg } = await setup(t, { accounts: [acct({ id: "acc0" }), acct({ id: "acc1" })] });
    fireAlarm(fake);
    await bg.whenIdle();
    assert.equal(puts(fake).length, 0);
    assert.ok(logs(fake).some((m) => m.startsWith("Sync skipped") && m.includes("acc0, acc1")));
  });

  test("绑定账号但 PSID 对不上：仍推给绑定账号，并记一条提示", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" }, accounts: [acct({ psid: masked(OTHER_PSID) })] });
    fireAlarm(fake);
    await bg.whenIdle();
    assert.deepEqual(puts(fake).map((c) => c.path), ["/admin/accounts/acc0/cookies"]);
    assert.ok(logs(fake).some((m) => m.startsWith("Note: local PSID differs from account acc0")));
  });

  test("绑定的账号在中转站不存在：不推，只记一条", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc9" } });
    fireAlarm(fake);
    await bg.whenIdle();
    t.mock.timers.tick(60_000);
    fireAlarm(fake);
    await bg.whenIdle();
    assert.equal(puts(fake).length, 0);
    assert.equal(logs(fake).filter((m) => m === "Sync skipped: relay has no account acc9 — check the side panel binding").length, 1);
  });

  test("绑定的账号已禁用：不推", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" }, accounts: [acct({ status: "disabled" })] });
    cookieEvent(fake);
    t.mock.timers.tick(10_000);
    await bg.whenIdle();
    fireAlarm(fake);
    await bg.whenIdle();
    assert.equal(puts(fake).length, 0);
    assert.equal(logs(fake).filter((m) => m === "Sync skipped: account acc0 is disabled").length, 1);
  });

  test("读不到本地 PSIDTS：不推，只记一条", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" }, jar: { "__Secure-1PSID": PSID } });
    fireAlarm(fake);
    await bg.whenIdle();
    cookieEvent(fake, { name: "__Secure-1PSID" });
    t.mock.timers.tick(10_000);
    await bg.whenIdle();
    assert.equal(puts(fake).length, 0);
    assert.equal(logs(fake).filter((m) => m.startsWith("Sync skipped: no local PSID/PSIDTS")).length, 1);
  });
});

describe("主动同步：失败处理", () => {
  test("推送失败：记错误、不抛、不记指纹；不足 60 秒不重试，满 60 秒的下一轮重试成功", async (t) => {
    const { fake, bg, warns } = await setup(t, { local: { accountId: "acc0" } });
    fake.relay.putStatus = 503;
    cookieEvent(fake);
    t.mock.timers.tick(10_000);
    await bg.whenIdle();
    assert.equal(puts(fake).length, 1);
    assert.equal(fake.stores.local.syncState.acc0.hash, undefined);
    assert.equal(fake.stores.local.syncState.acc0.triedAt, T0 + 10_000);
    const errors = (fake.stores.local.actionLog || []).filter((e) => e.level === "error");
    assert.equal(errors.length, 1);
    assert.match(errors[0].msg, /^Account acc0 sync failed: PUT failed HTTP 503/);
    t.mock.timers.tick(30_000);
    fireAlarm(fake);
    await bg.whenIdle();
    assert.equal(puts(fake).length, 1, "距上次尝试不足 60 秒，不重试");
    fake.relay.putStatus = 200;
    t.mock.timers.tick(30_000);
    fireAlarm(fake);
    await bg.whenIdle();
    assert.equal(puts(fake).length, 2);
    assert.match(fake.stores.local.syncState.acc0.hash, /^[0-9a-f]{16}$/);
    assert.deepEqual(warns, [], "失败要走日志，不该变成异常");
  });

  test("相同的失败连续发生只记一条", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" } });
    fake.relay.putStatus = 503;
    for (let i = 0; i < 3; i++) {
      fireAlarm(fake);
      await bg.whenIdle();
      t.mock.timers.tick(60_000);
    }
    assert.equal(puts(fake).length, 3);
    assert.equal(logs(fake).filter((m) => m.startsWith("Account acc0 sync failed")).length, 1);
  });

  test("cookie 变化触发时查询中转站状态失败：只记一条，不推", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" } });
    fake.relay.statusCode = 500;
    for (let i = 0; i < 2; i++) {
      cookieEvent(fake);
      t.mock.timers.tick(10_000);
      await bg.whenIdle();
    }
    assert.equal(puts(fake).length, 0);
    assert.equal(logs(fake).filter((m) => m.startsWith("Sync: relay status query failed")).length, 1);
  });
});
