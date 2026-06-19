<div align="center">

<h1>Gemini2API Plugin</h1>
<h3>Gemini Cookie キープアライブブラウザ拡張機能</h3>
<p>中継サーバーのアカウント状態を定期的に確認し、期限切れ時にローカルブラウザ（住宅 IP）で Gemini を更新して新しい Cookie を送信し、約 2 時間の制限突破を支援します。</p>

<p>
  <img src="https://img.shields.io/badge/Manifest-V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="MV3">
  <img src="https://img.shields.io/badge/Chrome%20%7C%20Edge-Latest-1a73e8?style=flat-square&logo=googlechrome&logoColor=white" alt="Browser">
  <img src="https://img.shields.io/badge/JavaScript-ES%20Module-f7df1e?style=flat-square&logo=javascript&logoColor=black" alt="JS">
  <img src="https://img.shields.io/badge/%E4%BE%9D%E8%B5%96-%E9%9B%B6-success?style=flat-square" alt="No deps">
  <img src="https://img.shields.io/badge/License-Non--Commercial-red?style=flat-square" alt="License">
</p>

<p>📦 メインプロジェクト：<a href="https://github.com/xwteam/gemini2api"><b>gemini2api</b></a>（Gemini Web リバースプロキシ）· 本拡張機能は Cookie キープアライブ用のコンパニオンです</p>

<p>
  <a href="#-仕組み">仕組み</a> &bull;
  <a href="#-主な機能">主な機能</a> &bull;
  <a href="#-インストール">インストール</a> &bull;
  <a href="#-設定">設定</a> &bull;
  <a href="#-マルチアカウント">マルチアカウント</a> &bull;
  <a href="#-ui">UI</a> &bull;
  <a href="#-権限">権限</a> &bull;
  <a href="#-faq">FAQ</a> &bull;
  <a href="#-既知の制限">制限</a>
</p>

<p>
  📖 ドキュメント：<a href="../zh-CN/README.md">简体中文</a> | <a href="../zh-TW/README.md">繁體中文</a> | <a href="../en/README.md">English</a> | 日本語 | <a href="../ko/README.md">한국어</a>
</p>

</div>

---

> [!NOTE]
> 本拡張機能は [Gemini2API](https://github.com/xwteam/gemini2api) のコンパニオンです。研究・学習目的のみ。商用利用は禁止してください。

> [!WARNING]
> Google とは無関係です。ブラウザ拡張機能経由で Gemini ログイン Cookie を読み取るため、Google 利用規約に違反する可能性があります。自己責任でご利用ください。

> [!IMPORTANT]
> **2 時間制限を 100% 突破できるとは保証しません。** パッシブ応答（期限切れ時のみ 1 回更新）で Google セッションへの干渉を最小化しますが、ローカルブラウザと中継は同一アカウントセッションを共有します。実測結果は [Issue](https://github.com/xwteam/gemini2api-plugin/issues) で共有歓迎です。

---

## 💡 仕組み

データセンター IP の中継サーバーでは Google セッションが約 2 時間で失効しがちです。**ローカルブラウザは住宅 IP で動作するため、同一アカウントのセッションはより長く維持できます。** 本拡張機能はこれを利用します：

```
N 秒ごと → GET /admin/status で中継アカウント状態を確認
  ├─ active（有効）  → 何もしない
  └─ expired（期限切れ）→ 開いている gemini.google.com タブを更新
                       → chrome.cookies で新しい __Secure-1PSID / __Secure-1PSIDTS を取得
                       → PUT /admin/accounts/{id}/cookies で中継に送信
                       → 次回ポーリングで active 復帰を確認
```

通常はサイレントポーリングのみ。**期限切れ検出時に 1 回だけ更新**し、クールダウンで繰り返し更新を防止します。

## 🌟 主な機能

- **パッシブ応答**：期限切れまでブラウザを操作しない
- **HttpOnly Cookie 読取**：`chrome.cookies` で `__Secure-` 認証 Cookie を取得
- **サイレント更新**：開いている Gemini タブを自動更新
- **アカウント単位送信 + 混同防止**：アカウント ID 指定で直接送信；未指定時は PSID 自動マッチ
- **クールダウン**：同一アカウントの連続更新を防止
- **固定サイドバー**：右側に常駐、ログを長時間監視可能
- **多言語 UI**：拡張機能 UI とログは Chrome の言語に自動追従（簡体中国語 / 繁体中国語 / 英 / 日 / 韓）、ドキュメント言語と一致
- **ゼロ依存**：Manifest V3 + 素の JavaScript、ビルド不要
- **プライバシー**：API Key と Cookie はローカルのみ、設定した中継先のみに送信

## 📦 インストール

> [!TIP]
> Chrome、Edge など Chromium 系ブラウザに対応。

1. 本リポジトリをクローンまたはダウンロード
2. 拡張機能ページを開く：`chrome://extensions` または `edge://extensions`
3. 右上の **デベロッパーモード** を有効化
4. **パッケージ化されていない拡張機能を読み込む** でプロジェクトルート（`manifest.json` があるフォルダ）を選択

> [!IMPORTANT]
> Chrome は `_` 始まりのファイル/フォルダを拒否します（**`_locales` を除く**）。v1.2.2 以降、開発用は `doc-templates/` と `gen_docs.py` に改名済み。`_doc_templates` エラーが出る場合は最新コードを取得してください。

5. 拡張機能アイコン → サイドバーを開く：
   - 上部で **このブラウザが担当するアカウント ID** をバインド（例：`account-0`）
   - 右上 **中継設定** で URL と API Key を入力（下記参照）

## ⚙ 設定

### サイドバー（このブラウザインスタンス）

| 項目 | 説明 |
|------|------|
| **アカウント ID** | **強く推奨**（例：`account-0`）。1 ブラウザ = 1 アカウント。ここでバインド；マルチアカウント時はプロファイルごとに設定 |

**バインド** をクリック。空欄時は PSID 自動マッチ（マルチアカウントでは非推奨）。

### 中継設定ページ

| 項目 | 説明 |
|------|------|
| **中継 URL** | Gemini2API のアドレス（例：`http://1.2.3.4:5918`） |
| **API Key** | 中継の `sk-` キー；gemini2api ≥ v1.6.16 で `ADMIN_API_KEY` 分離時は**管理キー**を入力 |
| **ポーリング間隔** | デフォルト 60 秒、最小 30 秒 |
| **更新クールダウン** | デフォルト 120 秒 |

**接続テスト** → **保存**（中継ドメインの権限を許可）。

> [!NOTE]
> **gemini2api 互換**：v1.6.16 以降 `/admin/status` の PSID はマスク表示。**アカウント ID のバインドを推奨**。

> [!IMPORTANT]
> **1 ブラウザインスタンス = 1 アカウントのみ。** ログイン中の **gemini.google.com タブを常時開く**、**専用ブラウザプロファイル**を使用。サイドバー上部で**アカウント ID をバインド**（マルチアカウント時はプロファイルごとに異なる ID）。

## 👥 マルチアカウント

複数アカウントは **ブラウザ環境ごとに分離**し、各環境に本拡張機能をインストール：

| アカウント | ブラウザ環境 | Google アカウント |
|-----------|-------------|------------------|
| account-0 | Chrome プロファイル A | アカウント 0 |
| account-1 | Chrome プロファイル B | アカウント 1 |

同一 **中継設定**（URL + API Key）；**サイドバー上部**で異なるアカウント ID をバインド（例：A→`account-0`、B→`account-1`）。

## 🖥 UI

ツールバーアイコンで **右固定サイドバー** を開きます。

- **サイドバー**：上部で **アカウント ID をバインド**；アカウント状態、マスク済み PSID、動作ログ、**今すぐ確認**、**強制更新＆送信**、右上 **中継設定**
- **ローカル Cookie**：`__Secure-1PSID` / `__Secure-1PSIDTS` の表示と中継アカウントとの一致確認
- **バッジ**：青 = 有効数、赤 = 期限切れ数、`!` = 接続失敗

## 🔐 権限

| 権限 | 用途 |
|------|------|
| `cookies` + `*://*.google.com/*` | Gemini HttpOnly Cookie 読取 |
| `tabs` | gemini.google.com タブの検索・更新 |
| `storage` | 設定とログの保存 |
| `alarms` | 定期ポーリング |
| 中継ホスト権限 | 保存時に動的申請 |

> [!NOTE]
> API Key と Cookie はローカルのみ保存し、設定した中継先以外には送信しません。

## ❓ FAQ

**Q：「gemini.google.com タブが見つかりません」？**
A：https://gemini.google.com を開いてログインし、タブを開いたままにしてください。

**Q：更新後も Cookie が読めない？**
A：未ログイン、または中継と異なるアカウントでログインしています。再ログインしてください。

**Q：送信後も expired のまま？**
A：PSID が Google 側で失効している可能性があります。再ログインが必要です。

**Q：アカウント BAN のリスクは？**
A：パッシブ・低頻度ですが非公式手段です。自己判断で。

**Q：アカウント混同は？**
A：送信前に PSID を照合し不一致なら拒否。**1 ブラウザ 1 アカウント**を守ってください。

**Q：`Cannot load extension with file or directory name _doc_templates`？**
A：**v1.2.2+** に更新し最新リポジトリを取得。旧版の `_` プレフィックス開発フォルダは Chrome が拒否します。

## 📝 ドキュメント

| パス | 説明 |
|------|------|
| `README.md` | 簡体中国語メイン |
| `doc-templates/` | 繁中 / 英 / 日 / 韓 テンプレート |
| `gen_docs.py` | `docs/{locale}/README.md` 生成 |
| `CHANGELOG.md` | 変更履歴 |

`README.md` または `doc-templates/*.md` 編集後、`python gen_docs.py` で再生成。

## ⚠ 既知の制限

- **1 ブラウザ = 1 アカウント**
- **2 時間突破は保証しない**
- **ブラウザ常駐が必要**（タブを閉じるとキープアライブ停止）

## 📄 ライセンス

[PolyForm Noncommercial License 1.0.0](../../LICENSE) — 非商用のみ。

## ⚠ 免責事項

Google とは無関係。学習・研究目的のみ。利用による一切の結果は利用者の責任です。
