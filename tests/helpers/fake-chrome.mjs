// tests/helpers/fake-chrome.mjs —— 给 background.js 接线测试用的最小 chrome.* / fetch 假实现
//
// 只实现 background.js / api.js / cookies.js / i18n.js 真正用到的 API；storage 按 Chrome 的
// get(null | string | string[] | defaults) 语义，值做 structuredClone 模拟序列化。
// i18n 读真实的 _locales/en/messages.json，缺键时像 Chrome 一样返回 ""，并记到 calls.missingI18n。
import { readFileSync } from "node:fs";

const EN = JSON.parse(readFileSync(new URL("../../_locales/en/messages.json", import.meta.url), "utf8"));

function eventTarget() {
  const fns = [];
  return {
    fns,
    addListener(fn) {
      fns.push(fn);
    },
    removeListener(fn) {
      const i = fns.indexOf(fn);
      if (i >= 0) fns.splice(i, 1);
    },
    hasListener(fn) {
      return fns.includes(fn);
    },
  };
}

function pick(store, keys) {
  if (keys == null) return structuredClone(store);
  if (typeof keys === "string") keys = [keys];
  const out = {};
  if (Array.isArray(keys)) {
    for (const k of keys) if (k in store) out[k] = structuredClone(store[k]);
    return out;
  }
  for (const [k, def] of Object.entries(keys)) out[k] = k in store ? structuredClone(store[k]) : def;
  return out;
}

/**
 * @param {object} o
 * @param {object} [o.local]   chrome.storage.local 初始内容
 * @param {object} [o.jar]     cookie 名 → 值（gemini.google.com 能读到的）
 * @param {object} [o.relay]   中转站假实现：{ accounts, statusCode, putStatus, reloadStatus }，可在用例中途修改
 * @param {Array}  [o.tabs]    chrome.tabs.query 返回的标签页
 */
export function createFakeChrome({ local = {}, sync = {}, jar = {}, relay = {}, tabs, manifestVersion = "1.3.0" } = {}) {
  const stores = { local: structuredClone(local), sync: structuredClone(sync) };
  const events = {
    alarm: eventTarget(),
    cookies: eventTarget(),
    installed: eventTarget(),
    startup: eventTarget(),
    message: eventTarget(),
    storage: eventTarget(),
    actionClicked: eventTarget(),
    tabUpdated: eventTarget(),
  };
  const calls = { fetch: [], badgeText: [], badgeColor: [], reload: [], alarmsCreate: [], missingI18n: [] };
  const tabList = tabs || [{ id: 1, url: "https://gemini.google.com/app" }];

  const area = (name) => ({
    async get(keys) {
      return pick(stores[name], keys);
    },
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: stores[name][k], newValue: structuredClone(v) };
        stores[name][k] = structuredClone(v);
      }
      for (const fn of [...events.storage.fns]) fn(changes, name);
    },
    async remove(keys) {
      const changes = {};
      for (const k of [].concat(keys)) {
        if (k in stores[name]) {
          changes[k] = { oldValue: stores[name][k] };
          delete stores[name][k];
        }
      }
      if (Object.keys(changes).length) for (const fn of [...events.storage.fns]) fn(changes, name);
    },
  });

  function getMessage(key, subs = []) {
    const entry = EN[key];
    if (!entry) {
      calls.missingI18n.push(key);
      return "";
    }
    const list = [].concat(subs);
    return entry.message.replace(/\$(\d)/g, (_, n) => list[Number(n) - 1] ?? "");
  }

  const chrome = {
    storage: { local: area("local"), sync: area("sync"), onChanged: events.storage },
    alarms: {
      onAlarm: events.alarm,
      async clear() {
        return true;
      },
      async create(name, info) {
        calls.alarmsCreate.push({ name, info });
      },
    },
    action: {
      onClicked: events.actionClicked,
      async setBadgeText({ text }) {
        calls.badgeText.push(text);
      },
      async setBadgeBackgroundColor({ color }) {
        calls.badgeColor.push(color);
      },
    },
    sidePanel: {
      async open() {},
      async setPanelBehavior() {},
    },
    runtime: {
      onInstalled: events.installed,
      onStartup: events.startup,
      onMessage: events.message,
      getManifest: () => ({ manifest_version: 3, version: manifestVersion }),
    },
    i18n: { getMessage, getUILanguage: () => "en-US" },
    cookies: {
      async get({ name }) {
        const value = jar[name];
        return value == null ? null : { name, value, domain: ".google.com" };
      },
      onChanged: events.cookies,
    },
    tabs: {
      async query() {
        return tabList.map((tab) => ({ ...tab }));
      },
      async reload(tabId) {
        calls.reload.push(tabId);
      },
      async get(tabId) {
        return { id: tabId, status: "complete" };
      },
      onUpdated: events.tabUpdated,
    },
  };

  const json = (status, obj) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => structuredClone(obj),
    text: async () => JSON.stringify(obj),
  });

  async function fetch(url, init = {}) {
    const method = (init.method || "GET").toUpperCase();
    const u = new URL(url);
    calls.fetch.push({ method, path: u.pathname, headers: { ...(init.headers || {}) }, body: init.body });
    if (method === "GET" && u.pathname === "/admin/status") {
      const code = relay.statusCode || 200;
      return json(code, code === 200 ? { accounts: relay.accounts || [] } : { error: "status down" });
    }
    if (method === "PUT" && /^\/admin\/accounts\/[^/]+\/cookies$/.test(u.pathname)) {
      const code = relay.putStatus || 200;
      return json(code, code === 200 ? { status: "ok" } : { error: { message: "Cookie reload failed" } });
    }
    if (method === "POST" && u.pathname === "/admin/reload-cookies") {
      return json(relay.reloadStatus || 200, { status: "ok" });
    }
    const check = u.pathname.match(/^\/admin\/accounts\/([^/]+)\/check$/);
    if (method === "GET" && check) {
      return json(200, { valid: true, status: "active", account_id: decodeURIComponent(check[1]) });
    }
    return json(404, { error: "not found" });
  }

  /** 模拟 MV3 service worker 被回收：旧实例的监听器全部失效（storage 保留） */
  function killWorker() {
    for (const e of Object.values(events)) e.fns.length = 0;
  }

  // loadBackground() 加载过的 background 实例（用例结束时等它们空闲，避免残留异步串到下一个用例）
  const instances = [];
  return { chrome, fetch, stores, events, calls, jar, relay, killWorker, instances };
}

/** 让出事件循环几轮（setImmediate 不受 mock.timers 影响），只用于等纯微任务链落定 */
export async function flush(rounds = 5) {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}

// 下面的等待一律按「真实时间」设上限（performance.now 不受 mock.timers 影响），不按循环次数：
// WebCrypto 摘要在线程池里完成，并行跑多个测试文件、CPU 紧张时一次摘要可能要好几毫秒，
// 比几百次 setImmediate 还慢——按次数放弃会误判超时，残留的异步还会串进下一个用例。
async function yieldFor(ms) {
  const end = performance.now() + ms;
  do {
    await new Promise((resolve) => setImmediate(resolve));
  } while (performance.now() < end);
}

/** 在真实时间 timeoutMs 内等 cond() 成立（期间让出事件循环），超时抛错 */
export async function waitFor(cond, { timeoutMs = 10_000 } = {}) {
  const deadline = performance.now() + timeoutMs;
  while (!cond()) {
    if (performance.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * 等 promise 落定；期间每让出约 1ms 真实时间就把 mock 时钟推进 stepMs
 * （用于要等 setTimeout 的路径，如救火流程里刷新标签页后固定等 5 秒）。
 */
export async function settle(t, promise, { stepMs = 100, timeoutMs = 10_000 } = {}) {
  let done = false;
  let value;
  let error;
  promise.then(
    (v) => {
      done = true;
      value = v;
    },
    (e) => {
      done = true;
      error = e;
    },
  );
  const deadline = performance.now() + timeoutMs;
  while (!done) {
    if (performance.now() > deadline) throw new Error(`promise did not settle within ${timeoutMs}ms`);
    await yieldFor(1);
    if (!done) t.mock.timers.tick(stepMs);
  }
  if (error) throw error;
  return value;
}

/** 用例收尾：最多等 timeoutMs（真实时间）让这些 background 实例把排队的轮询 / 同步跑完 */
export async function drainInstances(instances, { timeoutMs = 2_000 } = {}) {
  let idle = false;
  Promise.all(instances.map((bg) => bg.whenIdle())).then(() => {
    idle = true;
  });
  await waitFor(() => idle, { timeoutMs }).catch(() => {});
}

let seq = 0;
/** 装好全局 chrome / fetch 后加载一份全新的 background.js 实例（模块缓存按 query 区分） */
export async function loadBackground(fake) {
  globalThis.chrome = fake.chrome;
  globalThis.fetch = fake.fetch;
  const bg = await import(new URL(`../../background.js?instance=${++seq}`, import.meta.url).href);
  fake.instances.push(bg);
  return bg;
}
