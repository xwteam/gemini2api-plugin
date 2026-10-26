// i18n.js：账号状态文案（侧边栏徽章 + 后台日志共用）
import { test } from "node:test";
import assert from "node:assert/strict";
import { accountStatusText, t } from "../i18n.js";

/** getMessage 直接回显键名（带 substitution 时附在括号里），便于断言 */
function stubI18n(tc) {
  const had = "chrome" in globalThis;
  const prev = globalThis.chrome;
  globalThis.chrome = {
    i18n: {
      getMessage: (key, subs = []) => (subs.length ? `${key}(${subs.join(",")})` : key),
      getUILanguage: () => "en-US",
    },
  };
  tc.after(() => {
    if (had) globalThis.chrome = prev;
    else delete globalThis.chrome;
  });
}

test("session_invalid → statusSessionInvalid（会话失效）", (tc) => {
  stubI18n(tc);
  assert.equal(accountStatusText("session_invalid"), "statusSessionInvalid");
});

test("会话失效优先于冷却中显示", (tc) => {
  stubI18n(tc);
  assert.equal(accountStatusText("session_invalid", true), "statusSessionInvalid");
});

test("原有状态文案不变", (tc) => {
  stubI18n(tc);
  assert.equal(accountStatusText("active"), "statusActive");
  assert.equal(accountStatusText("expired"), "statusExpired");
  assert.equal(accountStatusText("disabled"), "statusDisabled");
  assert.equal(accountStatusText("refreshing"), "statusRefreshing");
  assert.equal(accountStatusText(""), "statusUnknown");
  assert.equal(accountStatusText("weird"), "weird");
  assert.equal(accountStatusText("active", true), "statusCoolingDown");
  assert.equal(accountStatusText("expired", true), "statusCoolingDown");
});

test("t() 仍对 substitution 做 HTML 转义（沿用 v1.2.2 约定）", (tc) => {
  stubI18n(tc);
  assert.equal(t("logSubmitFail", "acc0", `<img src=x onerror="1">`), 'logSubmitFail(acc0,&lt;img src=x onerror=&quot;1&quot;&gt;)');
});
