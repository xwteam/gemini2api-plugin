// cookies.js —— 读取 Gemini 的 HttpOnly 认证 Cookie
//
// chrome.cookies API（配 cookies 权限 + google.com host_permissions）可以读取
// HttpOnly cookie，这是它区别于网页 document.cookie 的关键能力，也是本插件成立的前提。

const GEMINI_URL = "https://gemini.google.com";

// Gemini Web 认证所需的两个核心 cookie
const COOKIE_PSID = "__Secure-1PSID";
const COOKIE_PSIDTS = "__Secure-1PSIDTS";

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

/**
 * 把 cookie 值打码用于展示（只留前后几位）。
 */
function maskCookie(value) {
  if (!value) return "（空）";
  if (value.length <= 12) return value.slice(0, 4) + "****";
  return value.slice(0, 6) + "…" + value.slice(-4);
}

export { readGeminiCookies, getCookie, maskCookie, GEMINI_URL, COOKIE_PSID, COOKIE_PSIDTS };
