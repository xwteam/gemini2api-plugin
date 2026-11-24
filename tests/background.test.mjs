// background.js 接线测试：用假 chrome.* / fetch 驱动 service worker 的真实代码路径
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome, drainInstances, flush, loadBackground, settle, visibleCookies } from "./helpers/fake-chrome.mjs";
import { cookieFingerprint } from "../sync.js";
import { toSubmitCookie } from "../cookies.js";

const BASE = "http://relay.test:5918";
const PSID = "g.a000AAAAbbbbCCCCddddEEEEffffGGGGhhhhIIIIjjjjKKKK1234";
const OTHER_PSID = "g.a000ZZZZyyyyXXXXwwwwVVVVuuuuTTTTssssRRRRqqqqPPPP9876";
const PSIDTS_1 = "sidts-CjEB_first_value_xxxxxxxxxxxxxxxx";
const PSIDTS_2 = "sidts-CjEB_second_value_yyyyyyyyyyyyyyy";
const OSID_1 = "osid-gemini-host-only-value-1111";
const OSID_2 = "osid-gemini-host-only-value-2222";
const GEMINI_APP = "https://gemini.google.com/app";
/**
 * 接近真实浏览器的 jar：.google.com 域 cookie + gemini.google.com host-only 的 OSID +
 * 浏览器访问 Gemini 时不会发的 accounts.google.com host-only cookie
 */
const jarOf = (psid = PSID, psidts = PSIDTS_1, osid = OSID_1) => ({
  "__Secure-1PSID": psid,
  "__Secure-1PSIDTS": psidts,
  SID: "sid-value-aaaaaaaaaaaa",
  "__Secure-1PSIDCC": "psidcc-value-bbbbbbbbbbbb",
  OSID: { value: osid, domain: "gemini.google.com", hostOnly: true },
  "__Host-GAPS": { value: "gaps-value-cccccccccccc", domain: "accounts.google.com", hostOnly: true },
});
/** 插件应当推给中转站的完整 cookie（= 浏览器访问 gemini.google.com/app 时会发的那些） */
const fullOf = (jar) => visibleCookies(jar, GEMINI_APP).map(toSubmitCookie);
const masked = (v) => `${v.slice(0, 4)}****${v.slice(-4)}`;
const acct = (over = {}) => ({ id: "acc0", psid: masked(PSID), status: "active", is_healthy: true, cooling_down: false, ...over });
// gemini2api ≥ 1.6.44 的账号（多一个 keepalive_mode 字段）；不带它的 acct() 就是 1.6.41～1.6.43 这类旧中转站
const newAcct = (over = {}) => acct({ keepalive_mode: "browser", ...over });
/** 预置「上次成功推送的就是浏览器当前这份 cookie」，让兜底补推没有东西可推，只看救火本身 */
async function syncedState(accountId = "acc0", psid = PSID, psidts = PSIDTS_1) {
  const hash = await cookieFingerprint(psid, psidts, fullOf(jarOf(psid, psidts)));
  return { [accountId]: { hash, pushedAt: T0 - 3_600_000, triedAt: T0 - 3_600_000 } };
}
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
    jar: jar ?? jarOf(),
    relay: { accounts },
  });
  const had = "chrome" in globalThis;
  const prevChrome = globalThis.chrome;
  const prevFetch = globalThis.fetch;
  t.after(async () => {
    // 先等本用例的 worker 实例空闲，再还原全局，免得残留的异步打到下一个用例的假 chrome 上
    await drainInstances(fake.instances);
    globalThis.fetch = prevFetch;
    if (had) globalThis.chrome = prevChrome;
    else delete globalThis.chrome;
  });
  const bg = await loadBackground(fake);
  return { fake, bg, warns };
}

const puts = (fake) => fake.calls.fetch.filter((c) => c.method === "PUT");
/** 请求体里的 psid / psidts（完整 cookie 列表另外断言） */
const authOf = (call) => {
  const { psid, psidts } = JSON.parse(call.body);
  return { psid, psidts };
};
const logs = (fake) => (fake.stores.local.actionLog || []).map((e) => e.msg);
const last = (arr) => arr[arr.length - 1];

/** 模拟 chrome.cookies.onChanged 事件 */
function cookieEvent(fake, { name = "__Secure-1PSIDTS", domain = ".google.com", removed = false, cause } = {}) {
  const info = { removed, cause: cause ?? (removed ? "overwrite" : "explicit"), cookie: { name, domain, path: "/", value: "x", hostOnly: !domain.startsWith(".") } };
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
    assert.deepEqual(JSON.parse(p[0].body), { psid: PSID, psidts: PSIDTS_1, cookies: fullOf(jarOf()) });
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

describe("救火：刷新标签页之前先看冷却与 PSID（刷新会打断用户正在用的页面）", () => {
  test("绑定账号已过期但在冷却期：不刷新标签页，只记冷却；冷却过了照常救", async (t) => {
    const { fake, bg } = await setup(t, {
      local: { accountId: "acc0", cooldownMap: { acc0: T0 - 30_000 }, syncState: await syncedState() },
      accounts: [acct({ status: "expired" })],
    });
    await settle(t, bg.pollOnce());
    assert.deepEqual(fake.calls.reload, [], "冷却期内本来就不会提交，不该先刷新标签页");
    assert.equal(puts(fake).length, 0);
    assert.equal(logs(fake).filter((m) => m === "Account acc0 in cooldown — skipping this round").length, 1);
    t.mock.timers.tick(90_000); // 距上次提交 120 秒，冷却结束
    await settle(t, bg.pollOnce());
    assert.deepEqual(fake.calls.reload, [1]);
    assert.equal(puts(fake).length, 1);
  });

  test("未绑定且要救的账号都和本地 PSID 对不上（别的浏览器负责的）：不刷新标签页", async (t) => {
    const { fake, bg } = await setup(t, {
      local: { syncState: await syncedState() },
      accounts: [acct({ id: "acc1", psid: masked(OTHER_PSID), is_healthy: false }), acct({ id: "acc2", psid: masked(OTHER_PSID), status: "expired" }), acct()],
    });
    for (let i = 0; i < 2; i++) {
      await settle(t, bg.pollOnce());
      t.mock.timers.tick(60_000);
    }
    assert.deepEqual(fake.calls.reload, [], "PSID 只在重新登录时才变，刷新改变不了匹配结果");
    assert.equal(puts(fake).length, 0);
    assert.ok(logs(fake).some((m) => m.startsWith(`No account ID and local PSID(${PSID.slice(0, 10)}…) matches no`)), logs(fake).join("\n"));
    assert.equal(last(fake.calls.badgeColor), RED, "徽章照常显示待救数");
  });

  test("部分账号在冷却、部分不在：照常刷新并提交，冷却中的只记一条冷却", async (t) => {
    const { fake, bg } = await setup(t, {
      local: { cooldownMap: { acc0: T0 - 30_000 } },
      accounts: [acct({ status: "expired" }), acct({ id: "acc1", status: "expired" })],
    });
    await settle(t, bg.pollOnce());
    assert.deepEqual(fake.calls.reload, [1]);
    assert.deepEqual(puts(fake).map((c) => c.path), ["/admin/accounts/acc1/cookies"]);
    assert.equal(logs(fake).filter((m) => m === "Account acc0 in cooldown — skipping this round").length, 1);
  });

  test("本地读不到 PSID：照旧刷新一次再读（行为不变）", async (t) => {
    const { fake, bg } = await setup(t, { accounts: [acct({ status: "expired" })], jar: {} });
    await settle(t, bg.pollOnce());
    assert.deepEqual(fake.calls.reload, [1]);
    assert.ok(logs(fake).some((m) => m.startsWith("No local __Secure-1PSID after refresh")));
  });
});

describe("救火口径：gemini2api ≥ 1.6.44（账号带 keepalive_mode）", () => {
  test("绑定账号仍报 active 但 is_healthy=false（网络抖动 / 5xx / 刚启动）：每轮都不刷新标签页、不提交，徽章蓝色", async (t) => {
    const { fake, bg } = await setup(t, {
      local: { accountId: "acc0", syncState: await syncedState() },
      accounts: [newAcct({ is_healthy: false })],
    });
    for (let i = 0; i < 3; i++) {
      await settle(t, bg.pollOnce());
      t.mock.timers.tick(60_000);
    }
    assert.deepEqual(fake.calls.reload, [], "中转站自身不健康时刷新用户的标签页没有用");
    assert.equal(puts(fake).length, 0);
    assert.equal(last(fake.calls.badgeText), "1");
    assert.equal(last(fake.calls.badgeColor), BLUE);
    assert.ok(!logs(fake).some((m) => m.includes("session invalid")), logs(fake).join("\n"));
  });

  test("未绑定时别的浏览器负责的账号不健康：本浏览器不刷新标签页", async (t) => {
    const { fake, bg } = await setup(t, {
      local: { syncState: await syncedState() },
      accounts: [newAcct({ id: "acc1", psid: masked(OTHER_PSID), is_healthy: false, keepalive_mode: "server" }), newAcct()],
    });
    await settle(t, bg.pollOnce());
    assert.deepEqual(fake.calls.reload, []);
    assert.equal(puts(fake).length, 0);
    assert.equal(last(fake.calls.badgeColor), BLUE);
  });

  test("expired 照救（新版中转站对被打回登录页的账号直接报 expired）", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" }, accounts: [newAcct({ status: "expired", is_healthy: false })] });
    await settle(t, bg.pollOnce());
    assert.deepEqual(fake.calls.reload, [1]);
    assert.equal(puts(fake).length, 1);
    assert.equal(last(fake.calls.badgeColor), RED);
    assert.ok(logs(fake).some((m) => m.includes("Account acc0 expired")));
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
    assert.deepEqual(JSON.parse(p[0].body), { psid: PSID, psidts: PSIDTS_1, cookies: fullOf(jarOf()) });
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
    assert.deepEqual(authOf(p[1]), { psid: PSID, psidts: PSIDTS_2 });
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
    assert.deepEqual(authOf(p[0]), { psid: PSID, psidts: PSIDTS_1 });
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

  test("绑定账号状态正常但 PSID 对不上（本浏览器换登了别的谷歌账号）：不覆盖它，同一原因只记一条", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" }, accounts: [acct({ psid: masked(OTHER_PSID), keepalive_mode: "browser" })] });
    cookieEvent(fake);
    t.mock.timers.tick(10_000);
    await bg.whenIdle();
    for (let i = 0; i < 2; i++) {
      t.mock.timers.tick(60_000);
      fireAlarm(fake);
      await bg.whenIdle();
    }
    assert.equal(puts(fake).length, 0, "不能把另一个账号的会话推上去顶掉中转站上正常的会话");
    assert.deepEqual(fake.calls.reload, []);
    const skips = logs(fake).filter((m) => m.startsWith("Sync skipped") && m.includes("bound account acc0"));
    assert.equal(skips.length, 1, logs(fake).join("\n"));
    assert.ok(skips[0].includes(`PSID(${PSID.slice(0, 10)}…)`));
    assert.deepEqual(fake.calls.missingI18n, []);
  });

  test("绑定账号已过期且 PSID 对不上：救火照绑定推并记提示，同一轮兜底补推不重复", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" }, accounts: [acct({ psid: masked(OTHER_PSID), status: "expired" })] });
    fireAlarm(fake);
    await settle(t, bg.whenIdle());
    assert.deepEqual(fake.calls.reload, [1]);
    assert.deepEqual(puts(fake).map((c) => c.path), ["/admin/accounts/acc0/cookies"]);
    assert.ok(logs(fake).some((m) => m.startsWith("Note: local PSID differs from account acc0")));
  });

  test("绑定账号已过期且 PSID 对不上：cookie 变化也照绑定推（账号需要救）", async (t) => {
    const { fake, bg } = await setup(t, {
      local: { accountId: "acc0" },
      accounts: [acct({ psid: masked(OTHER_PSID), status: "expired", keepalive_mode: "server" })],
    });
    cookieEvent(fake);
    t.mock.timers.tick(10_000);
    await bg.whenIdle();
    assert.deepEqual(puts(fake).map((c) => c.path), ["/admin/accounts/acc0/cookies"]);
    assert.deepEqual(fake.calls.reload, [], "主动同步不刷新标签页");
    assert.ok(logs(fake).some((m) => m.startsWith("Note: local PSID differs from account acc0")));
  });

  test("强制刷新：绑定账号正常、PSID 对不上也照推（手动覆盖，跳过提示里指的就是它）", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" }, accounts: [acct({ psid: masked(OTHER_PSID), keepalive_mode: "browser" })] });
    const replies = [];
    fake.events.message.fns[0]({ type: "refresh-now" }, {}, (r) => replies.push(r));
    await settle(t, bg.whenIdle());
    assert.deepEqual(replies, [{ ok: true }]);
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

  test("原因消失、与中转站重新一致后，同样的原因再出现会重新记一条", async (t) => {
    const MISSING = "Sync skipped: relay has no account acc0 — check the side panel binding";
    const { fake, bg } = await setup(t, { local: { accountId: "acc0", syncState: await syncedState() }, accounts: [] });
    fireAlarm(fake); // 绑定的账号被删了
    await bg.whenIdle();
    fake.relay.accounts = [acct()]; // 恢复，且中转站手里就是浏览器当前这份 cookie（不用推）
    t.mock.timers.tick(60_000);
    fireAlarm(fake);
    await bg.whenIdle();
    fake.relay.accounts = []; // 又被删了
    t.mock.timers.tick(60_000);
    fireAlarm(fake);
    await bg.whenIdle();
    assert.equal(puts(fake).length, 0);
    assert.equal(logs(fake).filter((m) => m === MISSING).length, 2, logs(fake).join("\n"));
  });

  test("清空日志后，仍在持续的跳过原因会重新出现在日志里", async (t) => {
    const MISSING = "Sync skipped: relay has no account acc9 — check the side panel binding";
    const { fake, bg } = await setup(t, { local: { accountId: "acc9" } });
    fireAlarm(fake);
    await bg.whenIdle();
    assert.deepEqual(logs(fake).filter((m) => m === MISSING).length, 1);
    const replies = [];
    fake.events.message.fns[0]({ type: "clear-log" }, {}, (r) => replies.push(r));
    await settle(t, bg.whenIdle());
    await flush(10);
    assert.deepEqual(replies, [{ ok: true }]);
    assert.ok(!logs(fake).includes(MISSING));
    t.mock.timers.tick(60_000);
    fireAlarm(fake);
    await bg.whenIdle();
    assert.equal(logs(fake).filter((m) => m === MISSING).length, 1, logs(fake).join("\n"));
    assert.ok(logs(fake).includes("Log cleared"));
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

describe("v1.4.0 完整 cookie（谷歌 11-20 改版后只有 PSID/PSIDTS 会被打回登录页）", () => {
  /** jar 里所有 cookie 的值（含访问 Gemini 时不会发的那些），用来确认哪里都没有泄露 */
  const allValues = (jar) => visibleCookies(jar, GEMINI_APP).concat(visibleCookies(jar, "https://accounts.google.com/")).map((c) => c.value);
  function assertNoCookieValues(fake, jar, extra = []) {
    const logDump = JSON.stringify(fake.stores.local.actionLog || []);
    const storeDump = JSON.stringify(fake.stores.local);
    const consoleDump = JSON.stringify([console.log.mock.calls.map((c) => c.arguments), console.warn.mock.calls.map((c) => c.arguments)]);
    for (const v of [...allValues(jar), ...extra]) {
      assert.ok(!logDump.includes(v), `日志里出现了 cookie 值 ${v.slice(0, 6)}…`);
      assert.ok(!storeDump.includes(v), `storage 里出现了 cookie 值 ${v.slice(0, 6)}…`);
      assert.ok(!consoleDump.includes(v), `控制台里出现了 cookie 值 ${v.slice(0, 6)}…`);
    }
  }

  test("主动同步：body 带完整 cookie（含 gemini.google.com host-only 的 OSID，不含 accounts.google.com 的），psid/psidts 与列表一致", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" } });
    cookieEvent(fake);
    t.mock.timers.tick(10_000);
    await bg.whenIdle();
    const p = puts(fake);
    assert.equal(p.length, 1);
    assert.deepEqual(fake.calls.cookiesGetAll.at(-1), { url: GEMINI_APP });
    const body = JSON.parse(p[0].body);
    assert.deepEqual(
      body.cookies.map((c) => `${c.name}@${c.domain}${c.hostOnly ? " host-only" : ""}`).sort(),
      ["OSID@gemini.google.com host-only", "SID@.google.com", "__Secure-1PSID@.google.com", "__Secure-1PSIDCC@.google.com", "__Secure-1PSIDTS@.google.com"],
    );
    assert.equal(body.cookies.find((c) => c.name === "__Secure-1PSID").value, body.psid);
    assert.equal(body.cookies.find((c) => c.name === "__Secure-1PSIDTS").value, body.psidts);
    assert.ok(logs(fake).some((m) => m.startsWith("Account acc0 synced") && m.includes("5 cookies synced, incl. OSID")), logs(fake).join("\n"));
    assertNoCookieValues(fake, jarOf());
    assert.deepEqual(fake.calls.missingI18n, []);
  });

  test("gemini.google.com 的 OSID 变了（PSID/PSIDTS 没变）也触发主动同步，推上新的 OSID", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0", syncState: await syncedState() } });
    fake.jar.OSID = { value: OSID_2, domain: "gemini.google.com", hostOnly: true };
    cookieEvent(fake, { name: "OSID", domain: "gemini.google.com" });
    t.mock.timers.tick(10_000);
    await bg.whenIdle();
    const p = puts(fake);
    assert.equal(p.length, 1);
    assert.deepEqual(authOf(p[0]), { psid: PSID, psidts: PSIDTS_1 });
    assert.equal(JSON.parse(p[0].body).cookies.find((c) => c.name === "OSID").value, OSID_2);
    assert.ok(logs(fake).some((m) => m.startsWith("Account acc0 synced") && m.includes("cookie change")));
  });

  test("__Secure-OSID 变化同样触发；别的谷歌服务的 OSID、*PSIDCC / SIDCC 变化不触发，兜底补推也不推", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0", syncState: await syncedState() } });
    fake.jar["__Secure-1PSIDCC"] = "psidcc-value-changed-every-request";
    cookieEvent(fake, { name: "__Secure-1PSIDCC" });
    cookieEvent(fake, { name: "SIDCC" });
    cookieEvent(fake, { name: "OSID", domain: "mail.google.com" });
    t.mock.timers.tick(60_000);
    await bg.whenIdle();
    await flush();
    assert.equal(fake.calls.fetch.length, 0, "不该因为常变 cookie 去查中转站");
    fireAlarm(fake);
    await bg.whenIdle();
    assert.equal(puts(fake).length, 0, "指纹不含 *PSIDCC：兜底补推也不推");

    fake.jar["__Secure-OSID"] = { value: "secure-osid-new-value-3333", domain: "gemini.google.com", hostOnly: true };
    t.mock.timers.tick(60_000);
    cookieEvent(fake, { name: "__Secure-OSID", domain: "gemini.google.com" });
    t.mock.timers.tick(10_000);
    await bg.whenIdle();
    assert.equal(puts(fake).length, 1);
    assert.ok(JSON.parse(puts(fake)[0].body).cookies.some((c) => c.name === "__Secure-OSID" && c.domain === "gemini.google.com"));
  });

  test("救火（expired）：刷新标签页后读的完整 cookie 一并提交，日志注明含 OSID", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" }, accounts: [newAcct({ status: "expired", is_healthy: false })] });
    await settle(t, bg.pollOnce());
    assert.deepEqual(fake.calls.reload, [1]);
    const p = puts(fake);
    assert.equal(p.length, 1, "救火推过的指纹记下来，同一轮兜底补推不重复");
    assert.deepEqual(JSON.parse(p[0].body), { psid: PSID, psidts: PSIDTS_1, cookies: fullOf(jarOf()) });
    assert.ok(logs(fake).some((m) => m.startsWith("Account acc0 — new cookies submitted") && m.includes("5 cookies synced, incl. OSID")), logs(fake).join("\n"));
    assertNoCookieValues(fake, jarOf());
  });

  test("强制刷新：同样提交完整 cookie", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" } });
    const replies = [];
    fake.events.message.fns[0]({ type: "refresh-now" }, {}, (r) => replies.push(r));
    await settle(t, bg.whenIdle());
    assert.deepEqual(replies, [{ ok: true }]);
    const p = puts(fake);
    assert.equal(p.length, 1);
    assert.deepEqual(JSON.parse(p[0].body), { psid: PSID, psidts: PSIDTS_1, cookies: fullOf(jarOf()) });
  });

  // 中转站（A2）要求 psid/psidts 与 cookies 里的 __Secure-1PSID/1PSIDTS 一致，不一致回 400；而救火失败不设冷却，
  // 每轮都会再刷新一次用户的 Gemini 标签页。所以本地缺 PSIDTS 时救火 / 强制刷新按 1.3.0 老格式只推两个值。
  const jarNoPsidts = () => {
    const jar = jarOf();
    delete jar["__Secure-1PSIDTS"];
    return jar;
  };

  test("救火：本地有 PSID 没有 PSIDTS → 按老格式推 { psid, psidts: \"\" }，不带缺 1PSIDTS 的 cookies 列表，成功后进冷却", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" }, accounts: [newAcct({ status: "expired", is_healthy: false })], jar: jarNoPsidts() });
    await settle(t, bg.pollOnce());
    assert.deepEqual(fake.calls.reload, [1]);
    const p = puts(fake);
    assert.equal(p.length, 1);
    assert.deepEqual(JSON.parse(p[0].body), { psid: PSID, psidts: "" });
    assert.ok(logs(fake).some((m) => m.startsWith("Account acc0 — new cookies submitted") && m.includes("only PSID/PSIDTS synced")), logs(fake).join("\n"));
    // 提交成功进了冷却：下一轮不再刷新标签页
    t.mock.timers.tick(60_000);
    await settle(t, bg.pollOnce());
    assert.deepEqual(fake.calls.reload, [1]);
    assertNoCookieValues(fake, jarNoPsidts());
  });

  test("强制刷新：本地有 PSID 没有 PSIDTS → 同样按老格式推，不带 cookies", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" }, jar: jarNoPsidts() });
    const replies = [];
    fake.events.message.fns[0]({ type: "refresh-now" }, {}, (r) => replies.push(r));
    await settle(t, bg.whenIdle());
    assert.deepEqual(replies, [{ ok: true }]);
    const p = puts(fake);
    assert.equal(p.length, 1);
    assert.deepEqual(JSON.parse(p[0].body), { psid: PSID, psidts: "" });
  });

  test("从 1.3.0 升级：syncState 里是只含 PSID/PSIDTS 的老指纹 → 第一轮补推一次完整 cookie，之后不重复", async (t) => {
    const legacy = { acc0: { hash: await cookieFingerprint(PSID, PSIDTS_1), pushedAt: T0 - 3_600_000, triedAt: T0 - 3_600_000 } };
    const { fake, bg } = await setup(t, { local: { accountId: "acc0", syncState: legacy } });
    fireAlarm(fake);
    await bg.whenIdle();
    assert.equal(puts(fake).length, 1);
    assert.deepEqual(JSON.parse(puts(fake)[0].body).cookies, fullOf(jarOf()));
    assert.ok(logs(fake).some((m) => m.startsWith("Account acc0 synced") && m.includes("poll catch-up")));
    for (let i = 0; i < 3; i++) {
      t.mock.timers.tick(60_000);
      fireAlarm(fake);
      await bg.whenIdle();
    }
    assert.equal(puts(fake).length, 1);
  });

  test("读不到完整 cookie（getAll 出错）：照 1.3.0 老格式推 psid/psidts，日志注明只同步了 PSID/PSIDTS", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" } });
    const realGetAll = fake.chrome.cookies.getAll;
    fake.chrome.cookies.getAll = async () => {
      throw new Error("getAll boom");
    };
    fireAlarm(fake);
    await bg.whenIdle();
    const p = puts(fake);
    assert.equal(p.length, 1);
    assert.deepEqual(JSON.parse(p[0].body), { psid: PSID, psidts: PSIDTS_1 });
    assert.ok(logs(fake).some((m) => m.startsWith("Account acc0 synced") && m.includes("only PSID/PSIDTS synced")), logs(fake).join("\n"));
    // 指纹按老格式记：getAll 恢复后会再推一次完整 cookie
    assert.equal(fake.stores.local.syncState.acc0.hash, await cookieFingerprint(PSID, PSIDTS_1));
    fake.chrome.cookies.getAll = realGetAll; // getAll 恢复
    t.mock.timers.tick(60_000);
    fireAlarm(fake);
    await bg.whenIdle();
    assert.equal(puts(fake).length, 2);
    assert.deepEqual(JSON.parse(puts(fake)[1].body).cookies, fullOf(jarOf()));
  });

  test("读到完整 cookie 但没有 gemini.google.com 的 OSID：照推，日志写缺 OSID", async (t) => {
    const jar = jarOf();
    delete jar.OSID;
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" }, jar });
    fireAlarm(fake);
    await bg.whenIdle();
    const p = puts(fake);
    assert.equal(p.length, 1);
    assert.equal(JSON.parse(p[0].body).cookies.length, 4);
    assert.ok(logs(fake).some((m) => m.startsWith("Account acc0 synced") && m.includes("4 cookies synced, no OSID")), logs(fake).join("\n"));
  });

  test("未登录（只有访客 cookie，没有 PSID）：不推", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" }, jar: { NID: "nid-value-guest", AEC: "aec-value-guest" } });
    fireAlarm(fake);
    await bg.whenIdle();
    assert.equal(puts(fake).length, 0);
    assert.ok(logs(fake).some((m) => m.startsWith("Sync skipped: no local PSID/PSIDTS")));
  });
});

describe("事件回调不留未处理的 Promise 拒绝", () => {
  /** 记录本用例期间的 unhandledRejection */
  function trackUnhandled(t) {
    const seen = [];
    const onRejection = (reason) => seen.push(reason);
    process.on("unhandledRejection", onRejection);
    t.after(() => process.off("unhandledRejection", onRejection));
    return seen;
  }

  test("定时轮询抛异常（如设置徽章失败）：被兜住，只打 console.warn", async (t) => {
    const { fake, bg, warns } = await setup(t, { local: { accountId: "acc0" } });
    const unhandled = trackUnhandled(t);
    fake.chrome.action.setBadgeText = async () => {
      throw new Error("badge boom");
    };
    fireAlarm(fake);
    await bg.whenIdle();
    await flush(10);
    assert.deepEqual(unhandled, []);
    assert.ok(warns.some((w) => String(w[1]).includes("badge boom")));
  });

  test("救火流程抛异常（标签页刚被关掉，reload 失败）：不影响同一轮的兜底补推", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" }, accounts: [acct({ is_healthy: false })] });
    const unhandled = trackUnhandled(t);
    fake.chrome.tabs.reload = async () => {
      throw new Error("No tab with id: 1.");
    };
    fireAlarm(fake);
    await bg.whenIdle();
    await flush(10);
    assert.deepEqual(unhandled, []);
    assert.equal(puts(fake).length, 1, "兜底补推照常把浏览器当前 cookie 推过去");
  });

  test("强制刷新出错时也一定回复 sendResponse", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" } });
    const unhandled = trackUnhandled(t);
    fake.chrome.tabs.reload = async () => {
      throw new Error("No tab with id: 1.");
    };
    const replies = [];
    const keepOpen = fake.events.message.fns[0]({ type: "refresh-now" }, {}, (r) => replies.push(r));
    assert.equal(keepOpen, true);
    await bg.whenIdle();
    await flush(10);
    assert.deepEqual(unhandled, []);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].ok, false);
  });

  test("清空日志写 storage 失败时也回复 sendResponse", async (t) => {
    const { fake } = await setup(t);
    const unhandled = trackUnhandled(t);
    fake.chrome.storage.local.set = async () => {
      throw new Error("QUOTA_BYTES quota exceeded");
    };
    const replies = [];
    fake.events.message.fns[0]({ type: "clear-log" }, {}, (r) => replies.push(r));
    await flush(10);
    assert.deepEqual(unhandled, []);
    assert.deepEqual(replies.map((r) => r.ok), [false]);
  });

  test("安装 / 启动 / 改轮询间隔时重设 alarm 失败：被兜住", async (t) => {
    const { fake, bg } = await setup(t, { local: { accountId: "acc0" } });
    const unhandled = trackUnhandled(t);
    fake.chrome.alarms.create = async () => {
      throw new Error("alarm boom");
    };
    fake.events.installed.fns[0]({ reason: "update" });
    fake.events.startup.fns[0]();
    fake.events.storage.fns[0]({ intervalSeconds: { oldValue: 60, newValue: 90 } }, "local");
    await bg.whenIdle();
    await flush(10);
    assert.deepEqual(unhandled, []);
  });
});
