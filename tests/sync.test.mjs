// sync.js 纯逻辑单测（不依赖 chrome.*）
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  needsRefresh,
  displayStatus,
  relayReportsSessionExpiry,
  isAuthCookieChange,
  isSyncTriggerCookie,
  pickTarget,
  shouldPush,
  debounceDelay,
  cookieFingerprint,
  SYNC_DEBOUNCE_MS,
  SYNC_MAX_WAIT_MS,
  SYNC_MIN_INTERVAL_MS,
} from "../sync.js";

const PSID = "g.a000AAAAbbbbCCCCddddEEEEffffGGGGhhhhIIIIjjjjKKKK1234";
const OTHER_PSID = "g.a000ZZZZyyyyXXXXwwwwVVVVuuuuTTTTssssRRRRqqqqPPPP9876";
const PSIDTS = "sidts-CjEB_first_value_xxxxxxxxxxxxxxxx";
const masked = (v) => `${v.slice(0, 4)}****${v.slice(-4)}`;
const acct = (over = {}) => ({ id: "acc0", psid: masked(PSID), status: "active", is_healthy: true, ...over });
// gemini2api ≥ 1.6.44 的账号：多一个 keepalive_mode 字段（与「打回登录页 → expired」同一版加入）
const newAcct = (over = {}) => acct({ keepalive_mode: "browser", ...over });

describe("needsRefresh", () => {
  test("status expired → 要救", () => {
    assert.equal(needsRefresh(acct({ status: "expired" })), true);
    assert.equal(needsRefresh(acct({ status: "expired", is_healthy: true })), true);
  });
  test("status 仍是 active 但 is_healthy === false → 要救（gemini2api 1.6.41～1.6.43）", () => {
    assert.equal(needsRefresh(acct({ status: "active", is_healthy: false })), true);
  });
  test("≥ 1.6.44（带 keepalive_mode）：active + is_healthy=false 是中转站自身不健康，不救", () => {
    // 1.6.44 已把「打回登录页」直接报成 expired；剩下的不健康是网络抖动 / 5xx / 刚启动，换 Cookie 没用
    assert.equal(needsRefresh(newAcct({ is_healthy: false })), false);
    assert.equal(needsRefresh(newAcct({ is_healthy: false, keepalive_mode: "server" })), false);
    assert.equal(needsRefresh(newAcct({ is_healthy: false, keepalive_mode: null })), false);
  });
  test("≥ 1.6.44：expired 照救，健康的 active 不救", () => {
    assert.equal(needsRefresh(newAcct({ status: "expired", is_healthy: false })), true);
    assert.equal(needsRefresh(newAcct({ status: "expired", is_healthy: true })), true);
    assert.equal(needsRefresh(newAcct()), false);
    assert.equal(needsRefresh(newAcct({ status: "disabled", is_healthy: false })), false);
  });
  test("active 且健康 → 不救", () => {
    assert.equal(needsRefresh(acct()), false);
  });
  test("旧服务端没有 is_healthy 字段 → 只看 status", () => {
    const { is_healthy: _omit, ...noField } = acct();
    assert.equal(needsRefresh(noField), false);
    assert.equal(needsRefresh({ ...noField, status: "expired" }), true);
  });
  test("is_healthy 必须严格等于 false（null/0/undefined 不算）", () => {
    assert.equal(needsRefresh(acct({ is_healthy: null })), false);
    assert.equal(needsRefresh(acct({ is_healthy: 0 })), false);
    assert.equal(needsRefresh(acct({ is_healthy: undefined })), false);
  });
  test("已禁用的账号不救（即使不健康）", () => {
    assert.equal(needsRefresh(acct({ status: "disabled", is_healthy: false })), false);
  });
  test("refreshing 且健康 → 不救", () => {
    assert.equal(needsRefresh(acct({ status: "refreshing" })), false);
  });
  test("空值 → false", () => {
    assert.equal(needsRefresh(null), false);
    assert.equal(needsRefresh(undefined), false);
  });
});

describe("relayReportsSessionExpiry", () => {
  test("账号带 keepalive_mode 字段 → 新版中转站（≥ 1.6.44）", () => {
    assert.equal(relayReportsSessionExpiry(newAcct()), true);
    assert.equal(relayReportsSessionExpiry(newAcct({ keepalive_mode: "server" })), true);
    assert.equal(relayReportsSessionExpiry(newAcct({ keepalive_mode: null })), true);
  });
  test("没有这个字段 → 旧版中转站；空值 → false", () => {
    assert.equal(relayReportsSessionExpiry(acct()), false);
    assert.equal(relayReportsSessionExpiry(null), false);
    assert.equal(relayReportsSessionExpiry(undefined), false);
  });
});

describe("displayStatus", () => {
  test("旧版中转站：active + is_healthy false → session_invalid（会话失效）", () => {
    assert.equal(displayStatus(acct({ is_healthy: false })), "session_invalid");
  });
  test("≥ 1.6.44：active + is_healthy false → unhealthy（中转站不健康，不是会话失效）", () => {
    assert.equal(displayStatus(newAcct({ is_healthy: false })), "unhealthy");
    assert.equal(displayStatus(newAcct()), "active");
    assert.equal(displayStatus(newAcct({ status: "expired", is_healthy: false })), "expired");
  });
  test("其余情况原样返回 status", () => {
    assert.equal(displayStatus(acct()), "active");
    assert.equal(displayStatus(acct({ status: "expired", is_healthy: false })), "expired");
    assert.equal(displayStatus(acct({ status: "disabled", is_healthy: false })), "disabled");
    assert.equal(displayStatus(acct({ is_healthy: undefined })), "active");
  });
  test("空值 → 空串", () => {
    assert.equal(displayStatus(null), "");
  });
});

describe("isAuthCookieChange", () => {
  const ev = (cookie = {}, extra = {}) => ({
    removed: false,
    cause: "explicit",
    cookie: { name: "__Secure-1PSIDTS", domain: ".google.com", value: "v", ...cookie },
    ...extra,
  });
  test("google.com 上的 __Secure-1PSIDTS / __Secure-1PSID 写入 → true", () => {
    assert.equal(isAuthCookieChange(ev()), true);
    assert.equal(isAuthCookieChange(ev({ name: "__Secure-1PSID" })), true);
    assert.equal(isAuthCookieChange(ev({ domain: "google.com" })), true);
    assert.equal(isAuthCookieChange(ev({ domain: "gemini.google.com" })), true);
    assert.equal(isAuthCookieChange(ev({ domain: ".GOOGLE.COM" })), true);
  });
  test("removed=true（overwrite 的前半段 / 过期删除）→ false", () => {
    assert.equal(isAuthCookieChange(ev({}, { removed: true, cause: "overwrite" })), false);
    assert.equal(isAuthCookieChange(ev({}, { removed: true, cause: "expired" })), false);
  });
  test("removed 不是严格 false → false", () => {
    assert.equal(isAuthCookieChange(ev({}, { removed: undefined })), false);
  });
  test("其它 cookie 名 → false", () => {
    for (const name of ["NID", "SID", "__Secure-3PSIDTS", "__Secure-3PSID", "__Secure-1PSIDCC", "__secure-1psidts"]) {
      assert.equal(isAuthCookieChange(ev({ name })), false, name);
    }
  });
  test("域名必须以 google.com 结尾且在标签边界上", () => {
    for (const domain of ["evilgoogle.com", ".evilgoogle.com", "google.com.evil.net", "google.co.jp", "", undefined]) {
      assert.equal(isAuthCookieChange(ev({ domain })), false, String(domain));
    }
  });
  test("v1.4.0：gemini.google.com 的 OSID / __Secure-OSID 写入也触发", () => {
    for (const name of ["OSID", "__Secure-OSID"]) {
      assert.equal(isAuthCookieChange(ev({ name, domain: "gemini.google.com" })), true, name);
      assert.equal(isAuthCookieChange(ev({ name, domain: ".gemini.google.com" })), true, name);
      assert.equal(isAuthCookieChange(ev({ name, domain: "gemini.google.com" }, { removed: true, cause: "overwrite" })), false, name);
    }
  });
  test("别的谷歌服务自己的 OSID 不触发（mail / myaccount / accounts / .google.com）", () => {
    for (const domain of ["mail.google.com", "myaccount.google.com", "accounts.google.com", ".google.com", "google.com", "evilgemini.google.com", "gemini.google.com.evil.net"]) {
      assert.equal(isAuthCookieChange(ev({ name: "OSID", domain })), false, domain);
      assert.equal(isAuthCookieChange(ev({ name: "__Secure-OSID", domain })), false, domain);
    }
    assert.equal(isAuthCookieChange(ev({ name: "osid", domain: "gemini.google.com" })), false, "名字区分大小写");
  });
  test("每次请求都会变的 *PSIDCC / SIDCC 等不触发（否则刷屏）", () => {
    for (const name of ["SIDCC", "__Secure-1PSIDCC", "__Secure-3PSIDCC", "NID", "AEC", "COMPASS", "__Secure-3PSIDTS", "SAPISID"]) {
      assert.equal(isAuthCookieChange(ev({ name })), false, name);
      assert.equal(isAuthCookieChange(ev({ name, domain: "gemini.google.com" })), false, `${name}@gemini`);
    }
  });
  test("畸形事件 → false", () => {
    assert.equal(isAuthCookieChange(null), false);
    assert.equal(isAuthCookieChange({}), false);
    assert.equal(isAuthCookieChange({ removed: false }), false);
  });
});

describe("isSyncTriggerCookie（侧边栏刷新 Cookie 区也用它）", () => {
  test("只看名字 + 域，不看 removed", () => {
    assert.equal(isSyncTriggerCookie({ name: "__Secure-1PSIDTS", domain: ".google.com" }), true);
    assert.equal(isSyncTriggerCookie({ name: "__Secure-1PSID", domain: "google.com" }), true);
    assert.equal(isSyncTriggerCookie({ name: "OSID", domain: "gemini.google.com" }), true);
    assert.equal(isSyncTriggerCookie({ name: "__Secure-OSID", domain: "gemini.google.com" }), true);
    assert.equal(isSyncTriggerCookie({ name: "OSID", domain: "mail.google.com" }), false);
    assert.equal(isSyncTriggerCookie({ name: "SIDCC", domain: ".google.com" }), false);
    assert.equal(isSyncTriggerCookie(null), false);
    assert.equal(isSyncTriggerCookie({}), false);
  });
});

describe("pickTarget", () => {
  test("绑定账号需要救（expired / 旧中转站会话失效）→ PSID 对不上也选它（psidMatch=false，与救火一致）", () => {
    for (const over of [{ status: "expired" }, { is_healthy: false }, { status: "expired", keepalive_mode: "browser" }]) {
      const accounts = [acct({ id: "acc1", psid: masked(OTHER_PSID) }), acct({ id: "acc0", psid: masked(OTHER_PSID), ...over })];
      const r = pickTarget(accounts, { accountId: "acc0" }, PSID);
      assert.equal(r.account && r.account.id, "acc0", JSON.stringify(over));
      assert.equal(r.reason, "bound");
      assert.equal(r.psidMatch, false);
    }
  });
  test("绑定账号状态正常但 PSID 对不上（本浏览器换登了别的账号？）→ bound-mismatch，不覆盖", () => {
    for (const over of [{}, { keepalive_mode: "browser" }, { is_healthy: false, keepalive_mode: "browser" }, { is_healthy: undefined }]) {
      const r = pickTarget([acct({ id: "acc0", psid: masked(OTHER_PSID), ...over })], { accountId: "acc0" }, PSID);
      assert.equal(r.account, null, JSON.stringify(over));
      assert.equal(r.reason, "bound-mismatch");
      assert.equal(r.accountId, "acc0");
    }
  });
  test("绑定了账号 ID 但本地没有 PSID → no-local-psid", () => {
    const r = pickTarget([acct({ id: "acc0" })], { accountId: "acc0" }, null);
    assert.equal(r.account, null);
    assert.equal(r.reason, "no-local-psid");
  });
  test("绑定了账号 ID 且 PSID 对得上 → psidMatch=true", () => {
    const r = pickTarget([acct({ id: "acc0" })], { accountId: "acc0" }, PSID);
    assert.equal(r.account.id, "acc0");
    assert.equal(r.psidMatch, true);
  });
  test("绑定的账号在中转站不存在 → bound-missing", () => {
    const r = pickTarget([acct({ id: "acc1" })], { accountId: "acc0" }, PSID);
    assert.equal(r.account, null);
    assert.equal(r.reason, "bound-missing");
    assert.equal(r.accountId, "acc0");
  });
  test("绑定的账号已禁用 → disabled，不推", () => {
    const r = pickTarget([acct({ id: "acc0", status: "disabled" })], { accountId: "acc0" }, PSID);
    assert.equal(r.account, null);
    assert.equal(r.reason, "disabled");
  });
  test("未绑定 → 按脱敏 PSID 唯一匹配", () => {
    const accounts = [acct({ id: "acc1", psid: masked(OTHER_PSID) }), acct({ id: "acc0" })];
    const r = pickTarget(accounts, { accountId: "" }, PSID);
    assert.equal(r.account.id, "acc0");
    assert.equal(r.reason, "matched");
    assert.equal(r.psidMatch, true);
  });
  test("未绑定 → 旧服务端返回完整 PSID 时按前缀匹配", () => {
    const r = pickTarget([acct({ id: "acc0", psid: PSID.slice(0, 30) + "rotated" })], {}, PSID);
    assert.equal(r.account.id, "acc0");
  });
  test("未绑定且没有任何账号匹配 → no-match", () => {
    const r = pickTarget([acct({ id: "acc1", psid: masked(OTHER_PSID) })], { accountId: "" }, PSID);
    assert.equal(r.account, null);
    assert.equal(r.reason, "no-match");
  });
  test("未绑定且匹配到多个账号 → ambiguous，不猜", () => {
    const r = pickTarget([acct({ id: "acc0" }), acct({ id: "acc1" })], {}, PSID);
    assert.equal(r.account, null);
    assert.equal(r.reason, "ambiguous");
    assert.deepEqual(r.candidates, ["acc0", "acc1"]);
  });
  test("未绑定且匹配到的账号已禁用 → disabled", () => {
    const r = pickTarget([acct({ id: "acc0", status: "disabled" })], {}, PSID);
    assert.equal(r.account, null);
    assert.equal(r.reason, "disabled");
  });
  test("未绑定且本地没有 PSID → no-local-psid", () => {
    assert.equal(pickTarget([acct()], {}, null).reason, "no-local-psid");
  });
  test("accounts 不是数组也不崩", () => {
    assert.equal(pickTarget(undefined, {}, PSID).reason, "no-match");
    assert.equal(pickTarget(null, { accountId: "acc0" }, PSID).reason, "bound-missing");
  });
});

describe("shouldPush", () => {
  const base = { lastHash: "aaaa", newHash: "bbbb", lastAt: 1_000_000, now: 1_000_000 + 60_000, minIntervalMs: 60_000 };
  test("从没推过 → 推", () => {
    assert.equal(shouldPush({ ...base, lastHash: undefined, lastAt: undefined }), true);
  });
  test("哈希没变 → 不推", () => {
    assert.equal(shouldPush({ ...base, newHash: "aaaa", now: base.lastAt + 3_600_000 }), false);
  });
  test("哈希变了但距上次推送不足最小间隔 → 不推", () => {
    assert.equal(shouldPush({ ...base, now: base.lastAt + 59_999 }), false);
    assert.equal(shouldPush({ ...base, now: base.lastAt }), false);
  });
  test("哈希变了且正好满最小间隔 → 推", () => {
    assert.equal(shouldPush({ ...base, now: base.lastAt + 60_000 }), true);
  });
  test("哈希变了且超过最小间隔 → 推", () => {
    assert.equal(shouldPush({ ...base, now: base.lastAt + 600_000 }), true);
  });
  test("没有新哈希（没读到 cookie）→ 不推", () => {
    assert.equal(shouldPush({ ...base, newHash: null }), false);
    assert.equal(shouldPush({ ...base, newHash: "" }), false);
  });
  test("上次推送时间在未来（系统时钟被往回调）→ 不卡死，允许推", () => {
    assert.equal(shouldPush({ ...base, lastAt: base.now + 3_600_000 }), true);
  });
  test("minIntervalMs 缺省为 60 秒", () => {
    const { minIntervalMs: _omit, ...noMin } = base;
    assert.equal(shouldPush({ ...noMin, now: base.lastAt + 59_000 }), false);
    assert.equal(shouldPush({ ...noMin, now: base.lastAt + 60_000 }), true);
  });
});

describe("debounceDelay", () => {
  test("第一次变化 → 等满防抖时长", () => {
    assert.equal(debounceDelay({ firstAt: 5_000, now: 5_000, waitMs: 10_000, maxWaitMs: 30_000 }), 10_000);
  });
  test("持续变化时重置等待，但从第一次变化起最多等 maxWaitMs", () => {
    assert.equal(debounceDelay({ firstAt: 0, now: 8_000, waitMs: 10_000, maxWaitMs: 30_000 }), 10_000);
    assert.equal(debounceDelay({ firstAt: 0, now: 25_000, waitMs: 10_000, maxWaitMs: 30_000 }), 5_000);
    assert.equal(debounceDelay({ firstAt: 0, now: 45_000, waitMs: 10_000, maxWaitMs: 30_000 }), 0);
  });
  test("缺省参数用模块常量；firstAt 非数字时按普通防抖处理", () => {
    assert.equal(debounceDelay({ firstAt: 0, now: 0 }), SYNC_DEBOUNCE_MS);
    assert.equal(debounceDelay({ firstAt: undefined, now: 123 }), SYNC_DEBOUNCE_MS);
  });
});

describe("cookieFingerprint", () => {
  test("16 位小写十六进制、确定性", async () => {
    const a = await cookieFingerprint(PSID, PSIDTS);
    assert.match(a, /^[0-9a-f]{16}$/);
    assert.equal(await cookieFingerprint(PSID, PSIDTS), a);
  });
  test("等于 SHA-256(psid + \\n + psidts) 的前 16 位", async () => {
    const want = createHash("sha256").update(`${PSID}\n${PSIDTS}`).digest("hex").slice(0, 16);
    assert.equal(await cookieFingerprint(PSID, PSIDTS), want);
  });
  test("PSIDTS 或 PSID 任一变化，指纹都变", async () => {
    const a = await cookieFingerprint(PSID, PSIDTS);
    assert.notEqual(await cookieFingerprint(PSID, PSIDTS + "x"), a);
    assert.notEqual(await cookieFingerprint(OTHER_PSID, PSIDTS), a);
  });
  test("不含 cookie 原值", async () => {
    const a = await cookieFingerprint(PSID, PSIDTS);
    assert.ok(!PSID.includes(a) && !PSIDTS.includes(a));
    assert.ok(!a.includes(PSIDTS.slice(0, 8)));
  });
  test("没有 PSID → null；PSIDTS 缺失按空串算", async () => {
    assert.equal(await cookieFingerprint(null, PSIDTS), null);
    assert.equal(await cookieFingerprint("", PSIDTS), null);
    assert.equal(await cookieFingerprint(PSID, null), await cookieFingerprint(PSID, ""));
  });
});

describe("cookieFingerprint（v1.4.0 带完整 cookie）", () => {
  const ck = (name, value, domain = ".google.com") => ({ name, value, domain, path: "/", hostOnly: !domain.startsWith("."), secure: true, httpOnly: true });
  const full = (over = {}) => [
    ck("__Secure-1PSID", PSID),
    ck("__Secure-1PSIDTS", PSIDTS),
    ck("SID", over.SID ?? "sid-1"),
    ck("__Secure-1PSIDCC", over.PSIDCC ?? "psidcc-1"),
    ck("SIDCC", over.SIDCC ?? "sidcc-1"),
    ck("NID", over.NID ?? "nid-1"),
    ck("OSID", over.OSID ?? "osid-1", "gemini.google.com"),
    ck("__Secure-OSID", over.SOSID ?? "sosid-1", "gemini.google.com"),
    ck("OSID", over.MAIL_OSID ?? "mail-osid-1", "mail.google.com"),
  ];

  test("与只有 PSID/PSIDTS 的老指纹不同：从 1.3.0 升级后第一轮会把完整 cookie 补推一次", async () => {
    assert.notEqual(await cookieFingerprint(PSID, PSIDTS, full()), await cookieFingerprint(PSID, PSIDTS));
  });
  test("cookies 为 null / 空数组 → 与老指纹相同（推的内容和 1.3.0 一样）", async () => {
    const legacy = await cookieFingerprint(PSID, PSIDTS);
    assert.equal(await cookieFingerprint(PSID, PSIDTS, null), legacy);
    assert.equal(await cookieFingerprint(PSID, PSIDTS, []), legacy);
  });
  test("gemini.google.com 的 OSID / __Secure-OSID 变了 → 指纹变", async () => {
    const a = await cookieFingerprint(PSID, PSIDTS, full());
    assert.notEqual(await cookieFingerprint(PSID, PSIDTS, full({ OSID: "osid-2" })), a);
    assert.notEqual(await cookieFingerprint(PSID, PSIDTS, full({ SOSID: "sosid-2" })), a);
    assert.notEqual(await cookieFingerprint(PSID, PSIDTS + "x", full()), a);
    assert.notEqual(await cookieFingerprint(OTHER_PSID, PSIDTS, full()), a);
  });
  test("*PSIDCC / SIDCC / NID 等常变 cookie、别的服务的 OSID 变了 → 指纹不变（不刷屏）", async () => {
    const a = await cookieFingerprint(PSID, PSIDTS, full());
    for (const over of [{ PSIDCC: "psidcc-2" }, { SIDCC: "sidcc-2" }, { NID: "nid-2" }, { SID: "sid-2" }, { MAIL_OSID: "mail-osid-2" }]) {
      assert.equal(await cookieFingerprint(PSID, PSIDTS, full(over)), a, JSON.stringify(over));
    }
  });
  test("与 cookie 顺序无关；有没有 OSID 指纹不同（补上 OSID 后会再推一次）", async () => {
    const a = await cookieFingerprint(PSID, PSIDTS, full());
    assert.equal(await cookieFingerprint(PSID, PSIDTS, full().reverse()), a);
    const noOsid = full().filter((c) => !(c.domain === "gemini.google.com"));
    assert.notEqual(await cookieFingerprint(PSID, PSIDTS, noOsid), a);
  });
  test("16 位十六进制，不含任何 cookie 原值", async () => {
    const a = await cookieFingerprint(PSID, PSIDTS, full());
    assert.match(a, /^[0-9a-f]{16}$/);
    for (const c of full()) assert.ok(!c.value.includes(a) && !a.includes(c.value), c.name);
  });
});

test("常量：防抖约 10 秒、最长 30 秒、同账号最小间隔 60 秒", () => {
  assert.equal(SYNC_DEBOUNCE_MS, 10_000);
  assert.equal(SYNC_MAX_WAIT_MS, 30_000);
  assert.equal(SYNC_MIN_INTERVAL_MS, 60_000);
});
