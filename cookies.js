// cookies.js —— 读取 Gemini 的 HttpOnly 认证 Cookie
//
// chrome.cookies API（配 cookies 权限 + google.com host_permissions）可以读取
// HttpOnly cookie，这是它区别于网页 document.cookie 的关键能力，也是本插件成立的前提。

const GEMINI_URL = "https://gemini.google.com";
// 「浏览器打开 Gemini 时会发哪些 cookie」以这个 URL 为准：.google.com 域 cookie（SID、HSID、
// __Secure-3PSID、*PSIDCC……）+ gemini.google.com 自己的 host-only cookie（OSID / __Secure-OSID）
const GEMINI_APP_URL = "https://gemini.google.com/app";
const GEMINI_HOST = "gemini.google.com";

// Gemini Web 认证所需的两个核心 cookie
const COOKIE_PSID = "__Secure-1PSID";
const COOKIE_PSIDTS = "__Secure-1PSIDTS";
// gemini.google.com 的 host-only 会话 cookie。谷歌 2026-11-20 改版后只带 PSID/PSIDTS 打开 /app
// 会被 302 到登录页（中转站以为初始化成功，实际是未登录访客），必须连同它们一起给中转站。
// 别的谷歌服务（mail、myaccount……）也各有一份同名的 OSID，只认 gemini.google.com 的。
const GEMINI_OSID_COOKIES = ["OSID", "__Secure-OSID"];

/**
 * 读取单个 cookie 的值，读不到返回 null。
 * 优先按 https://gemini.google.com 这个 url 读，确保拿到 .google.com 域下的值。
 */
async function getCookie(name) {
  try {
    const c = await chrome.cookies.get({ url: GEMINI_URL, name });
    return c && c.value ? c.value : null;
  } catch (e) {
    console.warn(`[cookies] 读取 ${name} 失败:`, e);
    return null;
  }
}

/**
 * 读取 Gemini 认证 cookie 对。
 * 返回 { psid, psidts }，任一为 null 表示没读到（可能未登录或域不对）。
 */
async function readGeminiCookies() {
  const [psid, psidts] = await Promise.all([
    getCookie(COOKIE_PSID),
    getCookie(COOKIE_PSIDTS),
  ]);
  return { psid, psidts };
}

/** cookie 是否属于 gemini.google.com 主机本身（host-only，或极少见的 .gemini.google.com 域 cookie） */
function isGeminiHostCookie(cookie) {
  const domain = String((cookie && cookie.domain) || "").toLowerCase().replace(/^\./, "");
  return domain === GEMINI_HOST;
}

/** 这批 cookie 里有没有 gemini.google.com 的 OSID / __Secure-OSID */
function hasGeminiOsid(cookies) {
  return Array.isArray(cookies) && cookies.some((c) => c && GEMINI_OSID_COOKIES.includes(c.name) && isGeminiHostCookie(c));
}

/**
 * chrome.cookies.Cookie → 推给中转站的形状，字段名照 chrome.cookies.Cookie：name / value / domain / path /
 * hostOnly / secure / httpOnly / expirationDate（gemini2api ≥ 1.6.53 按 domain / hostOnly 分域存、分域发）。
 * 丢掉 storeId / session / sameSite 等；会话 cookie 没有 expirationDate 就不带这个字段。
 */
function toSubmitCookie(c) {
  const out = {
    name: String(c.name),
    value: String(c.value ?? ""),
    domain: String(c.domain || ""),
    path: c.path || "/",
    hostOnly: !!c.hostOnly,
    secure: !!c.secure,
    httpOnly: !!c.httpOnly,
  };
  if (typeof c.expirationDate === "number" && Number.isFinite(c.expirationDate)) out.expirationDate = c.expirationDate;
  return out;
}

/**
 * 读浏览器访问 gemini.google.com/app 时会发的全部 cookie（含 HttpOnly 与 host-only 的 OSID）。
 * 没有名字的 cookie 丢掉。getAll 不可用或出错返回 null（不抛；错误信息里没有 cookie 值）。
 */
async function readAllGeminiCookies() {
  if (typeof chrome.cookies.getAll !== "function") return null;
  try {
    const list = await chrome.cookies.getAll({ url: GEMINI_APP_URL });
    if (!Array.isArray(list)) return null;
    return list.filter((c) => c && typeof c.name === "string" && c.name).map(toSubmitCookie);
  } catch (e) {
    console.warn("[cookies] 读取完整 Cookie 失败:", e && e.message);
    return null;
  }
}

/**
 * 取某个名字的值。Chrome 的 getAll({ url }) 按「浏览器发送顺序」返回（path 长者在前、同长先创建的在前），
 * 取第一条正好与 chrome.cookies.get 的挑选规则一致。没有 / 空值返回 null。
 */
function cookieValue(cookies, name) {
  const c = cookies.find((x) => x.name === name);
  return c && c.value ? c.value : null;
}

/**
 * 读 Gemini 会话：{ psid, psidts, cookies }，推给中转站用（主动同步 / 救火 / 强制刷新）。
 * - psid / psidts 从同一份 getAll 快照里取，保证与 cookies 里的 __Secure-1PSID/1PSIDTS 完全一致
 *   （gemini2api ≥ 1.6.53 收到不一致的会回 400；分开读的话浏览器恰好在两次读取之间轮换就会对不上）；
 * - getAll 不可用 / 出错、或快照里没有 PSID（未登录，只有访客 cookie，不推）时退回逐个读 PSID/PSIDTS，
 *   cookies 为 null——调用方按 1.3.0 的老格式只提交这两个。
 * - 快照里有 PSID 却没有 PSIDTS（或值为空）时同样退回、cookies 为 null：这时 body 的 psidts 是 ""、列表里
 *   又没有 __Secure-1PSIDTS，1.6.53 会判不一致回 400；救火失败不设冷却，每轮都会再刷新一次用户的 Gemini
 *   标签页。老格式中转站照旧接受。主动同步本来就要求两个都有，不受影响。
 */
async function readGeminiSession() {
  const all = await readAllGeminiCookies();
  if (all) {
    const psid = cookieValue(all, COOKIE_PSID);
    const psidts = cookieValue(all, COOKIE_PSIDTS);
    if (psid && psidts) return { psid, psidts, cookies: all };
  }
  const { psid, psidts } = await readGeminiCookies();
  return { psid, psidts, cookies: null };
}

/**
 * 把 cookie 值打码用于展示（只留前后几位）。
 */
function maskCookie(value, emptyText = "") {
  if (!value) return emptyText;
  if (value.length <= 12) return value.slice(0, 4) + "****";
  return value.slice(0, 6) + "…" + value.slice(-4);
}

/**
 * 判断两个 PSID 是否属于同一账号。
 *
 * PSID 形如 "g.a000-xxxxx..."，其主体在 PSIDTS 轮换过程中保持稳定（被吊销才会变），
 * 因此可用作账号身份锚点。用较长前缀比对，避免误判。
 * 用于防串号：本地浏览器登录的账号必须和要刷新的目标账号一致才提交。
 *
 * gemini2api v1.6.16+ 的 /admin/status 会对 psid 脱敏为「前4位****后4位」，
 * 此时改用首尾片段比对；完整 psid 仍走前缀比对。
 */
function isSameAccount(psidA, psidB, prefixLen = 24) {
  if (!psidA || !psidB) return false;
  if (psidA === psidB) return true;
  // 服务端脱敏格式，如 g.a0****xYz9
  if (psidB.includes("****")) {
    const head = psidB.slice(0, 4);
    const tail = psidB.slice(-4);
    return psidA.length >= 8 && psidA.startsWith(head) && psidA.endsWith(tail);
  }
  if (psidA.includes("****")) {
    const head = psidA.slice(0, 4);
    const tail = psidA.slice(-4);
    return psidB.length >= 8 && psidB.startsWith(head) && psidB.endsWith(tail);
  }
  return psidA.slice(0, prefixLen) === psidB.slice(0, prefixLen);
}

export {
  readGeminiCookies,
  readGeminiSession,
  readAllGeminiCookies,
  getCookie,
  maskCookie,
  isSameAccount,
  toSubmitCookie,
  hasGeminiOsid,
  isGeminiHostCookie,
  GEMINI_URL,
  GEMINI_APP_URL,
  GEMINI_HOST,
  COOKIE_PSID,
  COOKIE_PSIDTS,
  GEMINI_OSID_COOKIES,
};
