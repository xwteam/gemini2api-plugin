<div align="center">

<h1>Gemini2API Plugin</h1>
<h3>Gemini Cookie Keep-Alive Browser Extension</h3>
<p>Polls your relay server for account health; when expired, refreshes Gemini in your local browser (residential IP) and submits fresh cookies to help break the ~2-hour limit.</p>

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
> **Does not guarantee breaking the 2-hour limit 100% of the time.** It minimizes interference with Google sessions (passive mode, refresh only on expiry), but your local browser and relay share the same account session. Results vary — share your findings via [Issue](https://github.com/xwteam/gemini2api-plugin/issues).

---

## 💡 How It Works

Relay servers on datacenter IPs often see Google sessions expire in ~2 hours. **Your local browser runs on a residential IP, so the same account can stay alive longer.** This extension bridges the gap:

```
Every N seconds → GET /admin/status to check relay account health
  ├─ active   → do nothing
  └─ expired  → refresh an open gemini.google.com tab locally
               → chrome.cookies reads new __Secure-1PSID / __Secure-1PSIDTS
               → PUT /admin/accounts/{id}/cookies to submit to relay
               → next poll verifies active again
```

Normally the extension only polls silently. **It refreshes once only when expiry is detected**, with a cooldown to avoid repeated refreshes and minimize session disruption.

## 🌟 Core Features

- **Passive response**: zero interference until an account expires; does not compete for cookie rotation
- **HttpOnly cookie access**: uses `chrome.cookies` to read `__Secure-` auth cookies that page JS cannot
- **Silent refresh**: auto-refreshes open Gemini tabs — no manual steps
- **Per-account submit + anti-mix-up**: set Account ID to push cookies directly (works even when cookie values change); without ID, matches by local PSID to avoid cross-account submission
- **Cooldown debounce**: after a refresh, same account enters cooldown to prevent repeated fights
- **Pinned sidebar**: fixed right-side panel stays open for long monitoring sessions and action logs
- **Multilingual UI**: extension UI and logs automatically follow Chrome browser language (Simplified & Traditional Chinese, English, Japanese, Korean), aligned with documentation locales
- **Zero dependencies**: vanilla JavaScript + Manifest V3, no build step, no third-party libs
- **Privacy**: API Key and cookies stay local and are sent only to your configured relay

## 📦 Installation

> [!TIP]
> Works on Chrome, Edge, and other Chromium browsers.

1. Download or clone this repo locally
2. Open extensions: `chrome://extensions` (Chrome) or `edge://extensions` (Edge)
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select this project root (the folder containing `manifest.json`)

> [!IMPORTANT]
> Load the repo root containing `manifest.json`. This repo contains **only the extension runtime and static docs** (`docs/`) — no doc-generation scripts.

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
| **Refresh cooldown** | After refresh, skip same account for this long; default 120s |

Click **Test connection**, then **Save** (browser will request host permission for your relay URL — allow it).

> [!NOTE]
> **gemini2api compatibility**: From v1.6.16, `/admin/status` returns masked PSID. Without Account ID, the extension matches first/last PSID fragments. **Always bind Account ID** for reliability.

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

- **Sidebar**: bind **Account ID** at top; account active/expired status, masked PSID, action log; **Check now** / **Force refresh & submit**; **Relay settings** (top right) for connection config.
- **Local cookies**: shows `__Secure-1PSID` / `__Secure-1PSIDTS` from this browser (masked by default; **👁 Show full** for full values) and whether they match relay accounts.
- **Badge**:
  - Blue number = active accounts
  - Red number = expired accounts
  - `!` = relay connection failed

## 🔐 Permissions

| Permission | Purpose |
|------------|---------|
| `cookies` + `*://*.google.com/*` | Read Gemini HttpOnly auth cookies |
| `tabs` | Find and refresh gemini.google.com tabs |
| `storage` | Save settings and action logs |
| `alarms` | Scheduled polling |
| Relay host permission | Requested dynamically when you save settings |

> [!NOTE]
> **Privacy**: API Key and cookies are stored only locally and sent only to your configured relay — never to third parties.

## ❓ FAQ

**Q: "No gemini.google.com tab found"?**
A: Open and log in at https://gemini.google.com and keep the tab open.

**Q: Still no cookies after refresh?**
A: This browser is not logged into Gemini, or logged into a different account than the relay. Log in again.

**Q: Status stays expired after submit?**
A: Google may have revoked the main session (PSID cannot be recovered by refresh). Log in again for fresh cookies.

**Q: Will this get my account banned?**
A: Passive mode with very low frequency — still non-official; assess risk yourself.

**Q: Can account A's cookies be submitted to account B?**
A: No. Local PSID is verified against the target account before submit. Still use **one account per browser** (see Multi-Account).

**Q: `Cannot load extension with file or directory name _doc_templates`?**
A: Update to **v1.2.3** and `git pull`. If `_doc_templates` still exists locally, your copy is outdated.

**Q: Why is there still an `_locales` folder? Will it block install?**
A: **No.** `_locales` is Chrome’s **official** i18n folder name (required for `default_locale`). Chrome **only** allows this `_`-prefixed directory; others like `_doc_templates` are rejected. Do not rename or delete it.

## ⚠ Known Limitations

- **One browser = one account**: multiple accounts need separate browser environments.
- **No guarantee on 2-hour limit**: local browser and relay share one Google session; PSIDTS rotation may still interact. Passive design minimizes risk — observe in practice.
- **Requires browser to stay open**: closing browser or Gemini tab stops keep-alive — trade-off of not refreshing aggressively.

## 📄 License

[PolyForm Noncommercial License 1.0.0](../../LICENSE) — non-commercial use only.

## ⚠ Disclaimer

Not affiliated with Google; for learning and research only. You bear all consequences including account bans or data loss.
