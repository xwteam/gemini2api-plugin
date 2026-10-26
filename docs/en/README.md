<div align="center">

<h1>Gemini2API Plugin</h1>
<h3>Gemini Cookie Keep-Alive Browser Extension</h3>
<p>Pushes cookies to your relay as soon as your browser rotates them; when an account expires or its session goes invalid, refreshes Gemini in your local browser (residential IP) and submits fresh cookies to help break the ~2-hour limit.</p>

<p>
  <img src="https://img.shields.io/badge/Manifest-V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="MV3">
  <img src="https://img.shields.io/badge/Chrome%20%7C%20Edge-Latest-1a73e8?style=flat-square&logo=googlechrome&logoColor=white" alt="Browser">
  <img src="https://img.shields.io/badge/JavaScript-ES%20Module-f7df1e?style=flat-square&logo=javascript&logoColor=black" alt="JS">
  <img src="https://img.shields.io/badge/Dependencies-Zero-success?style=flat-square" alt="No deps">
  <img src="https://img.shields.io/badge/License-Non--Commercial-red?style=flat-square" alt="License">
</p>

<p>📦 Main project: <a href="https://github.com/xwteam/gemini2api"><b>gemini2api</b></a> (Gemini Web reverse proxy) · This extension is its cookie keep-alive companion</p>

<p>
  <a href="#-how-it-works">How It Works</a> &bull;
  <a href="#-core-features">Core Features</a> &bull;
  <a href="#-installation">Installation</a> &bull;
  <a href="#-configuration">Configuration</a> &bull;
  <a href="#-multi-account-setup">Multi-Account</a> &bull;
  <a href="#-user-interface">UI</a> &bull;
  <a href="#-permissions">Permissions</a> &bull;
  <a href="#-faq">FAQ</a> &bull;
  <a href="#-known-limitations">Limitations</a>
</p>

<p>
  📖 Documentation: <a href="../zh-CN/README.md">简体中文</a> | <a href="../zh-TW/README.md">繁體中文</a> | English | <a href="../ja/README.md">日本語</a> | <a href="../ko/README.md">한국어</a>
</p>

</div>

---

> [!NOTE]
> This extension is a companion to [Gemini2API](https://github.com/xwteam/gemini2api). For research and learning only — please use responsibly and not for commercial purposes.

> [!WARNING]
> Not affiliated with Google. It reads Gemini login cookies via a browser extension, which may violate Google's Terms of Service. Use at your own risk. The author is not responsible for account penalties or data loss.

> [!IMPORTANT]
> **Does not guarantee breaking the 2-hour limit 100% of the time.** Your local browser and relay share the same account session: since v1.3.0 the extension forwards cookies the browser rotates to the relay right away, and with **gemini2api ≥ v1.6.44** the relay stops rotating those accounts itself, so the two sides no longer knock each other out (relays on v1.6.41–v1.6.43 still rotate on their own). Results vary — share your findings via [Issue](https://github.com/xwteam/gemini2api-plugin/issues).

---

## 💡 How It Works

Relay servers on datacenter IPs often see Google sessions expire in ~2 hours. **Your local browser runs on a residential IP, so the same account can stay alive longer.** This extension bridges the gap along two paths:

```
① Active sync (v1.3.0): the browser rotated its cookies → forward them to the relay
chrome.cookies.onChanged sees __Secure-1PSIDTS / __Secure-1PSID change
  → wait ~10s to coalesce bursts → read current cookies (no tab refresh)
  → target: the Account ID bound in the sidebar; if none, match by PSID
  → differs from the last successful push and ≥ 60s since the last push
       → PUT /admin/accounts/{id}/cookies
  (every scheduled poll re-checks too, in case the service worker was suspended mid-wait)

② Rescue: every N seconds → GET /admin/status to check relay account health
  ├─ anything else → do nothing
  └─ expired, or a v1.6.41–v1.6.43 relay still says active with is_healthy=false (session invalid)
        → all in cooldown, or (without an Account ID) no local PSID match → no refresh, wait for the next poll
        → refresh an open gemini.google.com tab locally
        → chrome.cookies reads new __Secure-1PSID / __Secure-1PSIDTS
        → PUT /admin/accounts/{id}/cookies to submit to relay
        → next poll verifies active again
```

The extension never rotates cookies itself: active sync only hands over what the browser already rotated. Otherwise it leaves the browser alone — **it refreshes the tab once only when expiry or an invalid session is detected and an account is actually due for a submit**, with a cooldown to avoid repeated refreshes. Both paths send the header `X-Gemini2API-Keepalive: gemini2api-plugin/<version>`; **gemini2api ≥ v1.6.44** then marks the account as browser-kept-alive and stops rotating it server-side, so the browser and relay stop invalidating each other's PSIDTS. Older relays ignore the header.

## 🌟 Core Features

- **Active sync (v1.3.0)**: pushes cookies to the relay ~10s after the browser rotates them — only when they changed, at most once per 60s per account, with a catch-up on every poll; the extension itself never rotates cookies or reloads pages for this
- **Rescue**: when an account expires, or a v1.6.41–v1.6.43 relay still says active but `is_healthy=false` (session invalid), refreshes the tab and submits new cookies — but not while in cooldown, or (without an Account ID) when the local PSID matches none of them; otherwise it leaves the browser alone
- **HttpOnly cookie access**: uses `chrome.cookies` to read `__Secure-` auth cookies that page JS cannot
- **Silent refresh**: auto-refreshes open Gemini tabs — no manual steps
- **Per-account submit + anti-mix-up**: set Account ID to push cookies directly (works even when cookie values change); without ID, matches by local PSID to avoid cross-account submission
- **Cooldown debounce**: after a refresh, same account enters cooldown to prevent repeated fights
- **Pinned sidebar**: fixed right-side panel stays open for long monitoring sessions and action logs
- **Multilingual UI**: extension UI and logs automatically follow Chrome browser language (Simplified & Traditional Chinese, English, Japanese, Korean), aligned with documentation locales
- **Zero dependencies**: vanilla JavaScript + Manifest V3, no build step, no third-party libs
- **Privacy**: API Key and cookies stay local and are sent only to your configured relay; sync records keep only a hash fingerprint of the cookies, never the values

## 📦 Installation

> [!TIP]
> Works on Chrome, Edge, and other Chromium browsers.

1. Download or clone this repo locally
2. Open extensions: `chrome://extensions` (Chrome) or `edge://extensions` (Edge)
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select this project root (the folder containing `manifest.json`)

> [!IMPORTANT]
> Load the repo root containing `manifest.json`. This repo contains **only the extension runtime, static docs** (`docs/`) **and unit tests** (`tests/`, never loaded by the extension; developers can run `node --test tests/` with Node ≥ 22) — no doc-generation scripts.

5. Click the extension icon → open the sidebar:
   - At the top, **bind the Account ID** this browser owns (e.g. `account-0`)
   - **Relay settings** (top right) for URL and API Key (see below)

## ⚙ Configuration

### Sidebar (this browser instance)

| Setting | Description |
|---------|-------------|
| **Account ID** | **Strongly recommended** (e.g. `account-0`). One browser instance keeps alive one account — bind it here; use a different profile per account in multi-account setups |

Click **Bind**. If empty, PSID auto-match is used (less reliable for multi-account).

### Relay settings page

| Setting | Description |
|---------|-------------|
| **Relay URL** | Your Gemini2API address, e.g. `http://1.2.3.4:5918` |
| **API Key** | Relay `sk-` key; if gemini2api ≥ v1.6.16 uses separate `ADMIN_API_KEY`, enter the **admin key** here |
| **Poll interval** | How often to check status; default 60s, minimum 30s |
| **Refresh cooldown** | During rescue, skip the same account for this long after a refresh; default 120s (active sync has its own fixed 60s minimum interval) |

Click **Test connection**, then **Save** (browser will request host permission for your relay URL — allow it).

> [!NOTE]
> **gemini2api compatibility**:
> - From v1.6.16, `/admin/status` returns masked PSID. Without Account ID, the extension matches first/last PSID fragments. **Always bind Account ID** for reliability.
> - v1.6.40 and earlier don't update an account's PSID record in `/admin/status` after cookies are submitted. If the relay account was originally set up with cookies from another session (e.g. an incognito window), active sync in bound mode skips it because the PSID doesn't match (the log says so), leaving only the expiry rescue; upgrade the relay and click **Force refresh & submit** once.
> - v1.6.41–v1.6.43 keep reporting `active` for accounts whose Google session is dead and only set `is_healthy` to false; since v1.3.0 the extension rescues those as "session invalid".
> - **From v1.6.44**, accounts bounced to Google's login page are reported as `expired`; `active` with `is_healthy` false then only means the relay itself is temporarily unhealthy (network hiccups, 5xx, still starting up…), which new cookies won't fix — the extension shows "Unhealthy" and neither refreshes nor submits (it tells new relays from old ones by the `keepalive_mode` field in `/admin/status`).
> - **From v1.6.44**, accounts the extension has pushed cookies to are marked as browser-kept-alive (`keepalive_mode` is `browser` in `/admin/status`) and the relay stops rotating them. To hand an account back to server-side rotation (e.g. you switched to cookies from an incognito window), first disable this extension in that browser, then update the cookies manually in the panel — otherwise the next sync marks it browser-kept-alive again.

> [!IMPORTANT]
> **One browser instance can keep alive only one account.** The browser has a single cookie jar for `gemini.google.com`; the extension always reads the currently logged-in account. Therefore:
> - Keep **one logged-in `gemini.google.com` tab** open for the account you want to keep alive.
> - **Use a dedicated browser profile** (separate Chrome profile / incognito / anti-detect browser) — do not mix with daily Google accounts or you risk wrong-account reads and cross-talk.
> - **Bind Account ID** at the top of the sidebar (one ID per browser profile in multi-account setups).
> - If the tab or browser closes, expired accounts cannot auto-recover.

## 👥 Multi-Account Setup

When the relay has multiple accounts, **use one isolated browser environment per account, each with its own copy of this extension**:

| Account | Browser environment | Google account |
|---------|---------------------|----------------|
| account-0 | Chrome profile A / anti-detect window 1 | Google account 0 |
| account-1 | Chrome profile B / anti-detect window 2 | Google account 1 |
| … | … | … |

Each instance: same **Relay settings** (URL + API Key); **different Account ID** bound at the sidebar top (e.g. profile A → `account-0`, profile B → `account-1`). Browsers stay isolated — no cross-account leakage.

> [!TIP]
> Chrome **Profiles** or anti-detect browsers give fully isolated cookie jars. Incognito works but cookies are lost when closed.

## 🖥 User Interface

Click the toolbar icon to open a **fixed right sidebar** (stays visible for monitoring).

- **Sidebar**: bind **Account ID** at top; account active / expired / session-invalid / unhealthy status, masked PSID, action log (including active-sync entries); **Check now** / **Force refresh & submit**; **Relay settings** (top right) for connection config.
- **Local cookies**: shows `__Secure-1PSID` / `__Secure-1PSIDTS` from this browser (masked by default; **👁 Show full** for full values) and whether they match relay accounts.
- **Badge**:
  - Blue number = active accounts
  - Red number = accounts expired or with an invalid session (need rescue)
  - `!` = relay connection failed

## 🔐 Permissions

| Permission | Purpose |
|------------|---------|
| `cookies` + `*://*.google.com/*` | Read Gemini HttpOnly auth cookies and watch them change for active sync |
| `tabs` | Find and refresh gemini.google.com tabs |
| `storage` | Save settings, action logs and sync records (hash fingerprints only) |
| `alarms` | Scheduled polling |
| Relay host permission | Requested dynamically when you save settings |

> [!NOTE]
> **Privacy**: API Key and cookies are stored only locally and sent only to your configured relay — never to third parties. Active sync in v1.3.0 adds no permissions; sync records store only a truncated SHA-256 fingerprint, never the cookie values.

## ❓ FAQ

**Q: "No gemini.google.com tab found"?**
A: Open and log in at https://gemini.google.com and keep the tab open.

**Q: Still no cookies after refresh?**
A: This browser is not logged into Gemini, or logged into a different account than the relay. Log in again.

**Q: Status stays expired after submit?**
A: Google may have revoked the main session (PSID cannot be recovered by refresh). Log in again for fresh cookies.

**Q: Why does the extension submit cookies when nothing has expired?**
A: That is active sync (v1.3.0). Your browser and the relay share one Google session; once the browser rotates PSIDTS, the relay's copy soon stops working, so the extension forwards the new value (only when it changed, at most once per 60s per account, without refreshing the tab). With gemini2api ≥ v1.6.44 the relay then stops rotating that account itself, so the two sides stop knocking each other out.

**Q: What do "Session invalid" and "Unhealthy" in the sidebar mean?**
A: Both mean the relay still reports `active` with `is_healthy` false; which one you see depends on the relay version. "Session invalid" only appears with gemini2api v1.6.41–v1.6.43, which report dead Google sessions this way; the extension treats it like "Expired" — it refreshes the tab and submits new cookies (on those versions, unhealthiness from other causes such as network hiccups is treated the same way). From v1.6.44, accounts bounced to the login page are reported as `expired`, so `active` but unhealthy only means the relay itself has a problem (network hiccups, 5xx, still starting up…), not a dead login: the extension shows "Unhealthy", neither refreshes the tab nor submits, and you should check the relay's panel / logs.

**Q: Will this get my account banned?**
A: The extension makes no extra requests to Google: active sync only forwards cookies the browser already has, and only a rescue refreshes the tab — very low frequency. Still non-official; assess the risk yourself.

**Q: Can account A's cookies be submitted to account B?**
A: Without an Account ID, the extension only submits to the account whose PSID matches the local one, and submits nothing if none (or several) match. With an Account ID bound, the binding wins: while that account is healthy, active sync skips it when the local PSID doesn't match the relay's record (e.g. this browser switched Google accounts) and notes it in the log instead of overwriting a working session; when the account needs a rescue (expired / session invalid) or you click **Force refresh & submit**, it still submits to the bound account without a PSID check (the log notes the mismatch). So still use **one account per browser** (see Multi-Account).

**Q: `Cannot load extension with file or directory name _doc_templates`?**
A: Update to **v1.2.3** and `git pull`. If `_doc_templates` still exists locally, your copy is outdated.

**Q: Why is there still an `_locales` folder? Will it block install?**
A: **No.** `_locales` is Chrome’s **official** i18n folder name (required for `default_locale`). Chrome **only** allows this `_`-prefixed directory; others like `_doc_templates` are rejected. Do not rename or delete it.

## ⚠ Known Limitations

- **One browser = one account**: multiple accounts need separate browser environments.
- **No guarantee on 2-hour limit**: local browser and relay share one Google session. Relays on gemini2api v1.6.41–v1.6.43 also rotate PSIDTS on a timer, so the two sides may knock each other out; only v1.6.44+ stops server-side rotation for accounts this extension pushes. Observe in practice.
- **Requires browser to stay open**: closing browser or Gemini tab stops keep-alive (active sync also relies on an open Gemini tab so the browser keeps rotating cookies) — trade-off of not refreshing aggressively.

## 📄 License

[PolyForm Noncommercial License 1.0.0](../../LICENSE) — non-commercial use only.

## ⚠ Disclaimer

Not affiliated with Google; for learning and research only. You bear all consequences including account bans or data loss.
