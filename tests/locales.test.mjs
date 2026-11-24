// _locales 守卫：五语言键集合一致、占位一致、代码 / 页面引用的键都存在、v1.3.0 / v1.4.0 新文案齐全
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const LOCALES = ["en", "ja", "ko", "zh_CN", "zh_TW"];
const read = (rel) => readFileSync(new URL(rel, root), "utf8");
const load = (loc) => JSON.parse(read(`_locales/${loc}/messages.json`));
const subTokens = (msg) => [...new Set(msg.match(/\$\d/g) || [])].sort();

export const V130_KEYS = [
  "statusSessionInvalid",
  "statusUnhealthy",
  "logAccountSessionInvalidSubmit",
  "logSyncPushed",
  "logSyncPushFail",
  "logSyncNoLocalCookie",
  "logSyncNoMatch",
  "logSyncAmbiguous",
  "logSyncBoundMissing",
  "logSyncBoundMismatch",
  "logSyncDisabled",
  "logSyncStatusFail",
  "syncTriggerCookie",
  "syncTriggerPoll",
];

// v1.4.0 完整 Cookie：日志里的「同步了 N 个 Cookie、含不含 OSID」+ 侧边栏「完整 Cookie」一行
export const V140_KEYS = [
  "syncSetOsid",
  "syncSetNoOsid",
  "syncSetPsidOnly",
  "cookieSetLabel",
  "cookieSetRead",
  "cookieSetReadNoOsid",
  "cookieSetNoOsidHint",
];

test("_locales 恰好是这五种语言", () => {
  assert.deepEqual(readdirSync(new URL("_locales/", root)).sort(), LOCALES);
});

test("五语言 messages.json 都能解析，且键集合一致", () => {
  const base = Object.keys(load("zh_CN")).sort();
  for (const loc of LOCALES) assert.deepEqual(Object.keys(load(loc)).sort(), base, loc);
});

test("同一个键五语言的 $N 占位一致，placeholders 与之对应，没有未转义的 $", () => {
  const all = Object.fromEntries(LOCALES.map((l) => [l, load(l)]));
  for (const key of Object.keys(all.zh_CN)) {
    const want = subTokens(all.zh_CN[key].message);
    for (const loc of LOCALES) {
      const entry = all[loc][key];
      assert.equal(typeof entry.message, "string", `${loc}.${key}`);
      assert.ok(entry.message.trim(), `${loc}.${key} 为空`);
      assert.deepEqual(subTokens(entry.message), want, `${loc}.${key} 占位与 zh_CN 不一致`);
      if (want.length) {
        const ph = Object.keys(entry.placeholders || {}).map((n) => `$${n}`).sort();
        assert.deepEqual(ph, want, `${loc}.${key} placeholders`);
      }
      assert.ok(!/\$(?!\d)/.test(entry.message.replace(/\$\$/g, "")), `${loc}.${key} 含未转义的 $`);
    }
  }
});

test("代码、页面、manifest 引用到的 i18n 键在 zh_CN 里都存在", () => {
  const keys = new Set(Object.keys(load("zh_CN")));
  const used = new Set();
  for (const f of readdirSync(root).filter((n) => n.endsWith(".js"))) {
    const src = read(f);
    for (const m of src.matchAll(/\bt\(\s*"([A-Za-z0-9_]+)"/g)) used.add(m[1]);
    // t(cond ? "keyA" : "keyB", ...)
    for (const m of src.matchAll(/\bt\(\s*[^()"]*?\?\s*"([A-Za-z0-9_]+)"\s*:\s*"([A-Za-z0-9_]+)"/g)) {
      used.add(m[1]);
      used.add(m[2]);
    }
  }
  for (const f of ["popup.html", "options.html"]) {
    for (const m of read(f).matchAll(/data-(?:i18n(?:-placeholder|-title|-aria)?|page-title)="([A-Za-z0-9_]+)"/g)) {
      used.add(m[1]);
    }
  }
  for (const m of read("manifest.json").matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) used.add(m[1]);
  assert.ok(used.size > 80, `扫描结果过少（${used.size}），正则可能失效`);
  assert.deepEqual([...used].filter((k) => !keys.has(k)).sort(), []);
});

test("v1.3.0 新文案五语言齐全", () => {
  for (const loc of LOCALES) {
    const d = load(loc);
    for (const key of V130_KEYS) assert.ok(d[key] && d[key].message, `${loc}.${key}`);
  }
});

test("v1.3.0 新文案都被代码用到（不留死键）", () => {
  const src = readdirSync(root).filter((n) => n.endsWith(".js")).map((f) => read(f)).join("\n");
  for (const key of V130_KEYS) assert.ok(src.includes(`"${key}"`), key);
});

test("v1.4.0 新文案五语言齐全、都被代码用到", () => {
  const src = readdirSync(root).filter((n) => n.endsWith(".js")).map((f) => read(f)).join("\n");
  for (const loc of LOCALES) {
    const d = load(loc);
    for (const key of V140_KEYS) assert.ok(d[key] && d[key].message, `${loc}.${key}`);
  }
  for (const key of V140_KEYS) assert.ok(src.includes(`"${key}"`), key);
});

test("v1.4.0：日志的 Cookie 小结作为占位传入（logSyncPushed 四个、logCookieSubmitted 三个），五语言一致", () => {
  for (const loc of LOCALES) {
    const d = load(loc);
    assert.deepEqual(subTokens(d.logSyncPushed.message), ["$1", "$2", "$3", "$4"], `${loc}.logSyncPushed`);
    assert.deepEqual(subTokens(d.logCookieSubmitted.message), ["$1", "$2", "$3"], `${loc}.logCookieSubmitted`);
    for (const key of ["syncSetOsid", "syncSetNoOsid", "cookieSetRead", "cookieSetReadNoOsid"]) {
      assert.deepEqual(subTokens(d[key].message), ["$1"], `${loc}.${key}`);
      assert.ok(d[key].message.includes("OSID"), `${loc}.${key} 要写明 OSID`);
    }
    // 会作为 t() 的占位再转义一次：不能含 HTML 特殊字符，否则日志里显示成 &amp; 之类
    for (const key of ["syncSetOsid", "syncSetNoOsid", "syncSetPsidOnly"]) {
      assert.ok(!/[&<>"']/.test(d[key].message), `${loc}.${key} 含 HTML 特殊字符`);
    }
  }
});
