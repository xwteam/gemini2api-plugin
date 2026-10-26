// sync.js —— 判定 / 主动同步的纯逻辑（不碰 chrome.*，可直接在 Node 里单测）
//
// 背景：浏览器和中转站共用同一个 Google 会话。浏览器每换一次 __Secure-1PSIDTS，中转站手里的
// 旧值很快就失效；gemini2api ≥ 1.6.44 对插件推送过的账号不再自己轮换，前提是插件把浏览器换出
// 的新值及时推过去。这里放「该不该救 / 推给谁 / 该不该推」这些判断，background.js 只管接线。
import { isSameAccount, COOKIE_PSID, COOKIE_PSIDTS } from "./cookies.js";

/** Cookie 变化后等这么久再读（合并 PSID/PSIDTS 连续写入）；持续变化时最多等 SYNC_MAX_WAIT_MS */
export const SYNC_DEBOUNCE_MS = 10_000;
export const SYNC_MAX_WAIT_MS = 30_000;
/** 同一账号两次主动推送的最小间隔 */
export const SYNC_MIN_INTERVAL_MS = 60_000;
/** 指纹长度（十六进制位数），SHA-256 截断 */
export const FINGERPRINT_HEX_LEN = 16;

/**
 * 中转站账号是否需要插件「救火」（刷新标签页并提交新 Cookie）。
 * - status === "expired"；
 * - 或 is_healthy === false：gemini2api 1.6.41～1.6.43 对谷歌会话已失效的账号仍报 active，
 *   只把 is_healthy 置 false（新服务端两者都会给）。字段缺失（更旧的服务端）不算。
 * 已禁用的账号是管理员的决定，不救（新服务端提交成功会把账号置回 active）。
 */
export function needsRefresh(account) {
  if (!account || account.status === "disabled") return false;
  return account.status === "expired" || account.is_healthy === false;
}

/**
 * 展示口径：status 仍是 active 但 is_healthy === false → "session_invalid"（会话失效），
 * 其余原样返回 status。徽章 / 侧边栏 / 日志共用。
 */
export function displayStatus(account) {
  if (!account) return "";
  if (account.status === "active" && account.is_healthy === false) return "session_invalid";
  return account.status;
}

/**
 * chrome.cookies.onChanged 的事件是否该触发主动同步：
 * 只看 google.com（含子域，按域名标签边界判断）上的 __Secure-1PSIDTS / __Secure-1PSID，
 * 且只要 removed === false 的那一条（overwrite 时 Chrome 先发 removed=true 再发 removed=false）。
 */
export function isAuthCookieChange(changeInfo) {
  const cookie = changeInfo && changeInfo.cookie;
  if (!cookie || changeInfo.removed !== false) return false;
  if (cookie.name !== COOKIE_PSIDTS && cookie.name !== COOKIE_PSID) return false;
  const domain = String(cookie.domain || "").toLowerCase().replace(/^\./, "");
  return domain === "google.com" || domain.endsWith(".google.com");
}

/**
 * 选主动同步的目标账号。
 * - 侧边栏绑定了账号 ID → 就是该账号（与现有救火路径一致：绑定优先，PSID 对不上也照推，
 *   只把 psidMatch 置 false 供调用方记一条提示）；
 * - 没绑定 → 用 isSameAccount 按 PSID 在 /admin/status 里找，唯一命中才推，多个命中不猜。
 * 已禁用的账号不推。返回 { account, reason, ... }，account 为 null 时 reason 说明为什么跳过：
 * bound-missing / disabled / no-local-psid / no-match / ambiguous。
 */
export function pickTarget(accounts, cfg, localPsid) {
  const list = Array.isArray(accounts) ? accounts.filter(Boolean) : [];
  const boundId = cfg && cfg.accountId;
  if (boundId) {
    const account = list.find((a) => a.id === boundId);
    if (!account) return { account: null, reason: "bound-missing", accountId: boundId };
    if (account.status === "disabled") return { account: null, reason: "disabled", accountId: boundId };
    return { account, reason: "bound", psidMatch: isSameAccount(localPsid, account.psid) };
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
 * Cookie 指纹：SHA-256(psid + "\n" + psidts) 的前 FINGERPRINT_HEX_LEN 位十六进制。
 * 只用来判断「和上次推的是不是同一份」，storage 里只存它、不另存 cookie 原值。
 * 把 PSID 也算进去：重新登录（PSID 变了）同样要推。没有 PSID 返回 null。
 */
export async function cookieFingerprint(psid, psidts) {
  if (!psid) return null;
  const data = new TextEncoder().encode(`${psid}\n${psidts || ""}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, FINGERPRINT_HEX_LEN);
}
