// cookies.js：读取浏览器访问 Gemini 时会发的完整 cookie（v1.4.0，谷歌 2026-11-20 改版后只有 PSID/PSIDTS 不够了）
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createFakeChrome } from "./helpers/fake-chrome.mjs";
import {
  readGeminiSession,
  readGeminiCookies,
  toSubmitCookie,
  hasGeminiOsid,
  isGeminiHostCookie,
  GEMINI_APP_URL,
  GEMINI_OSID_COOKIES,
} from "../cookies.js";

const PSID = "g.a000AAAAbbbbCCCCddddEEEEffffGGGGhhhhIIIIjjjjKKKK1234";
const PSIDTS = "sidts-CjEB_first_value_xxxxxxxxxxxxxxxx";
const OSID = "osid-gemini-host-only-value-0001";
const SOSID = "secure-osid-gemini-host-only-0002";

/** 一份接近真实浏览器的 jar：.google.com 域 cookie + gemini.google.com host-only + 别的主机的 host-only */
const realisticJar = () => ({
  "__Secure-1PSID": PSID,
  "__Secure-1PSIDTS": PSIDTS,
  "__Secure-3PSID": "3psid-value",
  SID: "sid-value",
  HSID: { value: "hsid-value", secure: false },
  SSID: "ssid-value",
  APISID: { value: "apisid-value", httpOnly: false, secure: false },
  SAPISID: { value: "sapisid-value", httpOnly: false },
  "__Secure-1PAPISID": { value: "1papisid-value", httpOnly: false },
  "__Secure-1PSIDCC": "1psidcc-value",
  SIDCC: { value: "sidcc-value", session: true, expirationDate: undefined },
  OSID: [
    { value: OSID, domain: "gemini.google.com", hostOnly: true },
    // 别的谷歌服务也有自己的 OSID：浏览器访问 gemini 时不会发
    { value: "osid-of-mail", domain: "mail.google.com", hostOnly: true },
  ],
  "__Secure-OSID": { value: SOSID, domain: "gemini.google.com", hostOnly: true },
  "__Host-GAPS": { value: "gaps-value", domain: "accounts.google.com", hostOnly: true },
});

function withChrome(t, fake) {
  const had = "chrome" in globalThis;
  const prev = globalThis.chrome;
  globalThis.chrome = fake.chrome;
  t.after(() => {
    if (had) globalThis.chrome = prev;
    else delete globalThis.chrome;
  });
}

describe("readGeminiSession（B1：完整 cookie）", () => {
  test("按 https://gemini.google.com/app 调 chrome.cookies.getAll，拿到浏览器访问 Gemini 时会发的全部 cookie", async (t) => {
    const fake = createFakeChrome({ jar: realisticJar() });
    withChrome(t, fake);
    const s = await readGeminiSession();
    assert.deepEqual(fake.calls.cookiesGetAll, [{ url: "https://gemini.google.com/app" }]);
    assert.equal(GEMINI_APP_URL, "https://gemini.google.com/app");
    assert.equal(s.psid, PSID);
    assert.equal(s.psidts, PSIDTS);
    const names = s.cookies.map((c) => `${c.name}@${c.domain}`).sort();
    assert.deepEqual(names, [
      "APISID@.google.com",
      "HSID@.google.com",
      "OSID@gemini.google.com",
      "SAPISID@.google.com",
      "SID@.google.com",
      "SIDCC@.google.com",
      "SSID@.google.com",
      "__Secure-1PAPISID@.google.com",
      "__Secure-1PSID@.google.com",
      "__Secure-1PSIDCC@.google.com",
      "__Secure-1PSIDTS@.google.com",
      "__Secure-3PSID@.google.com",
      "__Secure-OSID@gemini.google.com",
    ]);
  });

  test("每条只保留 chrome.cookies.Cookie 的 name/value/domain/path/hostOnly/secure/httpOnly/expirationDate", async (t) => {
    const fake = createFakeChrome({ jar: realisticJar() });
    withChrome(t, fake);
    const { cookies } = await readGeminiSession();
    const osid = cookies.find((c) => c.name === "OSID");
    assert.deepEqual(osid, {
      name: "OSID",
      value: OSID,
      domain: "gemini.google.com",
      path: "/",
      hostOnly: true,
      secure: true,
      httpOnly: true,
      expirationDate: 1_900_000_000,
    });
    const apisid = cookies.find((c) => c.name === "APISID");
    assert.equal(apisid.hostOnly, false);
    assert.equal(apisid.secure, false);
    assert.equal(apisid.httpOnly, false);
    // 会话 cookie 没有 expirationDate：不带这个字段，不能填 null / 0
    const sidcc = cookies.find((c) => c.name === "SIDCC");
    assert.ok(!("expirationDate" in sidcc), JSON.stringify(sidcc));
    for (const c of cookies) {
      assert.deepEqual(
        Object.keys(c).filter((k) => !["name", "value", "domain", "path", "hostOnly", "secure", "httpOnly", "expirationDate"].includes(k)),
        [],
        c.name,
      );
    }
  });

  test("psid / psidts 与 cookies 里的 __Secure-1PSID/1PSIDTS 出自同一份快照（中转站不一致会回 400）", async (t) => {
    const fake = createFakeChrome({ jar: realisticJar() });
    withChrome(t, fake);
    // getAll 一返回就把 PSIDTS 换掉：模拟浏览器恰好在两次读取之间轮换
    const realGetAll = fake.chrome.cookies.getAll;
    fake.chrome.cookies.getAll = async (d) => {
      const list = await realGetAll(d);
      fake.jar["__Secure-1PSIDTS"] = "sidts-rotated-after-snapshot";
      return list;
    };
    const s = await readGeminiSession();
    assert.equal(s.psidts, PSIDTS);
    assert.equal(s.cookies.find((c) => c.name === "__Secure-1PSIDTS").value, s.psidts);
    assert.equal(s.cookies.find((c) => c.name === "__Secure-1PSID").value, s.psid);
  });

  test("同名多条时取浏览器发送顺序里的第一条（path 长者优先，与 chrome.cookies.get 一致）", async (t) => {
    const fake = createFakeChrome({
      jar: {
        "__Secure-1PSID": [
          { value: "g.a000-root-path", path: "/" },
          { value: "g.a000-app-path", path: "/app" },
        ],
        "__Secure-1PSIDTS": PSIDTS,
      },
    });
    withChrome(t, fake);
    const s = await readGeminiSession();
    assert.equal(s.psid, "g.a000-app-path");
    assert.equal(s.cookies.filter((c) => c.name === "__Secure-1PSID").length, 2, "原样带上，不擅自去重");
  });

  test("getAll 抛错：退回逐个读 PSID/PSIDTS，cookies 为 null，不抛", async (t) => {
    const fake = createFakeChrome({ jar: realisticJar() });
    withChrome(t, fake);
    t.mock.method(console, "warn", () => {});
    fake.chrome.cookies.getAll = async () => {
      throw new Error("getAll boom");
    };
    const s = await readGeminiSession();
    assert.deepEqual(s, { psid: PSID, psidts: PSIDTS, cookies: null });
  });

  test("没有 getAll（极旧浏览器 / 测试桩）：退回逐个读", async (t) => {
    const fake = createFakeChrome({ jar: realisticJar() });
    withChrome(t, fake);
    delete fake.chrome.cookies.getAll;
    const s = await readGeminiSession();
    assert.deepEqual(s, { psid: PSID, psidts: PSIDTS, cookies: null });
  });

  test("未登录（快照里没有 PSID）：psid 为 null、cookies 为 null（不把访客 cookie 推上去）", async (t) => {
    const fake = createFakeChrome({ jar: { NID: "nid-value", AEC: "aec-value" } });
    withChrome(t, fake);
    const s = await readGeminiSession();
    assert.deepEqual(s, { psid: null, psidts: null, cookies: null });
  });

  test("有 PSID 没有 PSIDTS：cookies 为 null，调用方按老格式只推 psid/psidts（不推缺 1PSIDTS 的列表，中转站会判不一致回 400）", async (t) => {
    const fake = createFakeChrome({ jar: { "__Secure-1PSID": PSID, SID: "sid-value", OSID: { value: OSID, domain: "gemini.google.com", hostOnly: true } } });
    withChrome(t, fake);
    const s = await readGeminiSession();
    assert.deepEqual(s, { psid: PSID, psidts: null, cookies: null });
  });

  test("快照里 PSIDTS 为空值：同样当缺 PSIDTS，cookies 为 null", async (t) => {
    const fake = createFakeChrome({ jar: { "__Secure-1PSID": PSID, "__Secure-1PSIDTS": "", SID: "sid-value" } });
    withChrome(t, fake);
    const s = await readGeminiSession();
    assert.equal(s.psid, PSID);
    assert.equal(s.psidts, null);
    assert.equal(s.cookies, null);
  });

  test("没有名字的 cookie 丢掉（中转站按名字存）", async (t) => {
    const fake = createFakeChrome({ jar: { "__Secure-1PSID": PSID, "__Secure-1PSIDTS": PSIDTS } });
    withChrome(t, fake);
    const realGetAll = fake.chrome.cookies.getAll;
    fake.chrome.cookies.getAll = async (d) => [...(await realGetAll(d)), { name: "", value: "nameless", domain: ".google.com", path: "/" }];
    const s = await readGeminiSession();
    assert.deepEqual(s.cookies.map((c) => c.name).sort(), ["__Secure-1PSID", "__Secure-1PSIDTS"]);
  });

  test("readGeminiCookies（侧边栏匹配 / 救火前预检用）照旧只读 PSID/PSIDTS", async (t) => {
    const fake = createFakeChrome({ jar: realisticJar() });
    withChrome(t, fake);
    assert.deepEqual(await readGeminiCookies(), { psid: PSID, psidts: PSIDTS });
    assert.deepEqual(fake.calls.cookiesGetAll, []);
  });
});

describe("toSubmitCookie / hasGeminiOsid / isGeminiHostCookie", () => {
  test("toSubmitCookie：丢掉 storeId / session / sameSite 等字段，path 缺省为 /，布尔字段规范化", () => {
    assert.deepEqual(
      toSubmitCookie({ name: "SID", value: "v", domain: ".google.com", storeId: "0", session: true, sameSite: "lax" }),
      { name: "SID", value: "v", domain: ".google.com", path: "/", hostOnly: false, secure: false, httpOnly: false },
    );
    assert.equal(toSubmitCookie({ name: "X", value: "v", domain: "a", expirationDate: Number.NaN }).expirationDate, undefined);
    assert.equal(toSubmitCookie({ name: "X", value: "v", domain: "a", expirationDate: 1.5 }).expirationDate, 1.5);
  });

  test("OSID 只认 gemini.google.com 的（别的谷歌服务也各有一份 OSID）", () => {
    assert.deepEqual(GEMINI_OSID_COOKIES, ["OSID", "__Secure-OSID"]);
    assert.equal(isGeminiHostCookie({ domain: "gemini.google.com" }), true);
    assert.equal(isGeminiHostCookie({ domain: ".gemini.google.com" }), true);
    assert.equal(isGeminiHostCookie({ domain: "GEMINI.google.com" }), true);
    for (const domain of [".google.com", "google.com", "mail.google.com", "evilgemini.google.com", "gemini.google.com.evil", "", undefined]) {
      assert.equal(isGeminiHostCookie({ domain }), false, String(domain));
    }
    assert.equal(hasGeminiOsid([{ name: "OSID", domain: "gemini.google.com" }]), true);
    assert.equal(hasGeminiOsid([{ name: "__Secure-OSID", domain: "gemini.google.com" }]), true);
    assert.equal(hasGeminiOsid([{ name: "OSID", domain: "mail.google.com" }]), false);
    assert.equal(hasGeminiOsid([{ name: "SID", domain: "gemini.google.com" }]), false);
    assert.equal(hasGeminiOsid([]), false);
    assert.equal(hasGeminiOsid(null), false);
  });
});
