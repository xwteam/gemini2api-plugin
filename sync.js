// sync.js —— 判定 / 主动同步的纯逻辑（不碰 chrome.*，可直接在 Node 里单测）
//
// 背景：浏览器和中转站共用同一个 Google 会话。浏览器每换一次 __Secure-1PSIDTS，中转站手里的
// 旧值很快就失效；gemini2api ≥ 1.6.44 对插件推送过的账号不再自己轮换，前提是插件把浏览器换出
// 的新值及时推过去。这里放「该不该救 / 推给谁 / 该不该推」这些判断，background.js 只管接线。
import { isSameAccount, isGeminiHostCookie, COOKIE_PSID, COOKIE_PSIDTS, GEMINI_OSID_COOKIES } from "./cookies.js";

/** Cookie 变化后等这么久再读（合并 PSID/PSIDTS 连续写入）；持续变化时最多等 SYNC_MAX_WAIT_MS */
export const SYNC_DEBOUNCE_MS = 10_000;
export const SYNC_MAX_WAIT_MS = 30_000;
/** 同一账号两次主动推送的最小间隔 */
export const SYNC_MIN_INTERVAL_MS = 60_000;
/** 指纹长度（十六进制位数），SHA-256 截断 */
export const FINGERPRINT_HEX_LEN = 16;

/**
 * 中转站会不会把「谷歌会话被打回登录页」直接报成 expired（gemini2api ≥ 1.6.44）。
 * 1.6.44 起 /admin/status 的每个账号都带 keepalive_mode 字段（与这个派生 expired 同一版加入），
 * 旧版本没有——据此区分新旧中转站。
 */
export function relayReportsSessionExpiry(account) {
  return !!account && account.keepalive_mode !== undefined;
}

/**
 * 中转站账号是否需要插件「救火」（刷新标签页并提交新 Cookie）。
 * - status === "expired"；
 * - 或旧中转站（gemini2api 1.6.41～1.6.43，没有 keepalive_mode 字段）报 is_healthy === false：
 *   它们对谷歌会话已失效的账号仍报 active，只把 is_healthy 置 false。
 *   ≥ 1.6.44 已把这种账号直接报成 expired，仍报 active 但 is_healthy=false 只说明中转站自己暂时
 *   不健康（网络抖动、5xx、刚启动还没就绪……）——换 Cookie 没用，不救，否则每轮都会刷新用户的标签页。
 *   is_healthy 字段缺失（更旧的服务端）也不算。
 * 已禁用的账号是管理员的决定，不救（新服务端提交成功会把账号置回 active）。
 */
export function needsRefresh(account) {
  if (!account || account.status === "disabled") return false;
  if (account.status === "expired") return true;
  return account.is_healthy === false && !relayReportsSessionExpiry(account);
}

/**
 * 展示口径（徽章 / 侧边栏 / 日志共用）：status 仍是 active 但 is_healthy === false 时——
 * 旧中转站（1.6.41～1.6.43）→ "session_invalid"（会话失效，要救）；
 * ≥ 1.6.44 → "unhealthy"（中转站自身不健康，不是登录失效，不救）。其余原样返回 status。
 */
export function displayStatus(account) {
  if (!account) return "";
  if (account.status === "active" && account.is_healthy === false) {
    return relayReportsSessionExpiry(account) ? "unhealthy" : "session_invalid";
  }
  return account.status;
}

/**
 * 这个 cookie 变了要不要主动同步（只看名字 + 域）：
 * - google.com（含子域，按域名标签边界判断）上的 __Secure-1PSIDTS / __Secure-1PSID；
 * - v1.4.0 起再加 gemini.google.com 自己的 OSID / __Secure-OSID（别的谷歌服务各有一份同名的，不算）。
 * *PSIDCC / SIDCC 之类每次请求都会变，不触发（否则刷屏）——它们跟着下一次 PSIDTS 轮换一起推过去。
 */
export function isSyncTriggerCookie(cookie) {
  if (!cookie) return false;
  if (cookie.name === COOKIE_PSIDTS || cookie.name === COOKIE_PSID) {
    const domain = String(cookie.domain || "").toLowerCase().replace(/^\./, "");
    return domain === "google.com" || domain.endsWith(".google.com");
  }
  if (GEMINI_OSID_COOKIES.includes(cookie.name)) return isGeminiHostCookie(cookie);
  return false;
}

/**
 * chrome.cookies.onChanged 的事件是否该触发主动同步：isSyncTriggerCookie 认的 cookie，
 * 且只要 removed === false 的那一条（overwrite 时 Chrome 先发 removed=true 再发 removed=false）。
 */
export function isAuthCookieChange(changeInfo) {
  const cookie = changeInfo && changeInfo.cookie;
  if (!cookie || changeInfo.removed !== false) return false;
  return isSyncTriggerCookie(cookie);
}

/**
 * 选主动同步的目标账号。
 * - 侧边栏绑定了账号 ID → 该账号。PSID 对不上时：
 *   - 账号需要救（needsRefresh）→ 照推（与救火路径一致：绑定优先），psidMatch 置 false 供调用方记提示；
 *   - 账号状态正常 → 不推（bound-mismatch）。本浏览器很可能换登了别的谷歌账号，照推会把另一个
 *     账号的会话覆盖到中转站这个正常的账号上、原会话找不回来；真要替换由用户点「强制刷新提交」。
 * - 没绑定 → 用 isSameAccount 按 PSID 在 /admin/status 里找，唯一命中才推，多个命中不猜。
 * 已禁用的账号不推。返回 { account, reason, ... }，account 为 null 时 reason 说明为什么跳过：
 * bound-missing / disabled / bound-mismatch / no-local-psid / no-match / ambiguous。
 */
export function pickTarget(accounts, cfg, localPsid) {
  const list = Array.isArray(accounts) ? accounts.filter(Boolean) : [];
  const boundId = cfg && cfg.accountId;
  if (boundId) {
    const account = list.find((a) => a.id === boundId);
    if (!account) return { account: null, reason: "bound-missing", accountId: boundId };
    if (account.status === "disabled") return { account: null, reason: "disabled", accountId: boundId };
    if (!localPsid) return { account: null, reason: "no-local-psid" };
    const psidMatch = isSameAccount(localPsid, account.psid);
    if (!psidMatch && !needsRefresh(account)) return { account: null, reason: "bound-mismatch", accountId: boundId };
    return { account, reason: "bound", psidMatch };
  }
  if (!localPsid) return { account: null, reason: "no-local-psid" };
  const matches = list.filter((a) => isSameAccount(localPsid, a.psid));
  if (!matches.length) return { account: null, reason: "no-match" };
  if (matches.length > 1) return { account: null, reason: "ambiguous", candidates: matches.map((a) => a.id) };
  const [account] = matches;
  if (account.status === "disabled") return { account: null, reason: "disabled", accountId: account.id };
  return { account, reason: "matched", psidMatch: true };
}

/**
 * 是否该主动推送：有新指纹、与上次成功推给该账号的指纹不同、且距该账号上次推送已满 minIntervalMs。
 * lastAt 在未来（系统时钟被往回调）时不卡住，直接放行。
 */
export function shouldPush({ lastHash, newHash, lastAt, now, minIntervalMs = SYNC_MIN_INTERVAL_MS }) {
  if (!newHash || newHash === lastHash) return false;
  if (typeof lastAt === "number" && lastAt > 0) {
    const elapsed = now - lastAt;
    if (elapsed >= 0 && elapsed < minIntervalMs) return false;
  }
  return true;
}

/**
 * 防抖时长：每次变化都重新等 waitMs，但从第一次变化算起最多等 maxWaitMs，
 * 免得持续不断的变化把同步无限往后推。
 */
export function debounceDelay({ firstAt, now, waitMs = SYNC_DEBOUNCE_MS, maxWaitMs = SYNC_MAX_WAIT_MS }) {
  if (typeof firstAt !== "number" || !Number.isFinite(firstAt)) return waitMs;
  return Math.max(0, Math.min(waitMs, firstAt + maxWaitMs - now));
}

/**
 * Cookie 指纹：SHA-256 的前 FINGERPRINT_HEX_LEN 位十六进制。
 * 只用来判断「和上次推的是不是同一份」，storage 里只存它、不另存 cookie 原值。
 * 把 PSID 也算进去：重新登录（PSID 变了）同样要推。没有 PSID 返回 null。
 * - 没有完整 cookie（cookies 为 null / 空，推的是 1.3.0 那种只有 psid/psidts 的老格式）：
 *   SHA-256(psid + "\n" + psidts)，与 1.3.0 相同；
 * - 有完整 cookie：开头加 "full" 标记，再加 gemini.google.com 的 OSID / __Secure-OSID（排序后）。
 *   与老指纹必然不同——从 1.3.0 升级后第一轮就把完整 cookie 补推一次；只算触发同步的那几个
 *   （见 isSyncTriggerCookie），*PSIDCC / SIDCC / NID 这些常变的不算，否则每 60 秒推一次。
 */
export async function cookieFingerprint(psid, psidts, cookies = null) {
  if (!psid) return null;
  let text = `${psid}\n${psidts || ""}`;
  if (Array.isArray(cookies) && cookies.length) {
    const osid = cookies
      .filter((c) => c && GEMINI_OSID_COOKIES.includes(c.name) && isGeminiHostCookie(c))
      .map((c) => `${c.name}=${c.value}`)
      .sort();
    text = ["full", text, ...osid].join("\n");
  }
  const data = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, FINGERPRINT_HEX_LEN);
}
