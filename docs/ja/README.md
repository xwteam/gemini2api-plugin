<div align="center">

<h1>Gemini2API Plugin</h1>
<h3>Gemini Cookie キープアライブブラウザ拡張機能</h3>
<p>ブラウザが Cookie をローテーションしたらすぐ中継へ同期し、アカウントの期限切れ・セッション無効時にはローカルブラウザ（住宅 IP）で Gemini を更新して新しい Cookie を送信し、約 2 時間の制限突破を支援します。</p>

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
> **2 時間制限を 100% 突破できるとは保証しません。** ローカルブラウザと中継は同一アカウントセッションを共有します。v1.3.0 からはブラウザがローテーションした新しい Cookie をすぐ中継へ同期し、**gemini2api ≥ v1.6.44** と組み合わせると中継側はそのアカウントを自分でローテーションしなくなり、互いに押し出し合うのを防ぎます（v1.6.41～v1.6.43 の中継は自前のローテーションを続けます）。実測結果は [Issue](https://github.com/xwteam/gemini2api-plugin/issues) で共有歓迎です。

---

## 💡 仕組み

データセンター IP の中継サーバーでは Google セッションが約 2 時間で失効しがちです。**ローカルブラウザは住宅 IP で動作するため、同一アカウントのセッションはより長く維持できます。** 本拡張機能はこれを利用し、2 つの経路で動きます：

```
① アクティブ同期（v1.3.0）：ブラウザが Cookie をローテーション → 中継へ転送
chrome.cookies.onChanged が __Secure-1PSIDTS / __Secure-1PSID の変化を検知
  → 約 10 秒待って連続変化をまとめる → 現在の Cookie を読む（タブは更新しない）
  → 送信先：サイドバーでバインドしたアカウント ID、未設定なら PSID で照合
  → 前回の送信成功時と異なり、かつ前回送信から 60 秒以上 → PUT /admin/accounts/{id}/cookies
  （service worker が待機中に停止しても、定期ポーリングごとに再確認して補完）

② 救済：N 秒ごと → GET /admin/status で中継アカウント状態を確認
  ├─ active かつ正常 → 何もしない
  └─ expired（期限切れ）または is_healthy=false（セッション無効）
        → 開いている gemini.google.com タブを更新
        → chrome.cookies で新しい __Secure-1PSID / __Secure-1PSIDTS を取得
        → PUT /admin/accounts/{id}/cookies で中継に送信
        → 次回ポーリングで active 復帰を確認
```

拡張機能自身は Cookie をローテーションしません。アクティブ同期はブラウザが更新済みの値を中継へ渡すだけで、**タブの更新は期限切れ・セッション無効を検出したときの 1 回だけ**です（クールダウンで繰り返しを防止）。どちらの経路も `X-Gemini2API-Keepalive: gemini2api-plugin/<バージョン>` ヘッダーを付けて送信し、**gemini2api ≥ v1.6.44** はこれを見てそのアカウントを「ブラウザ維持」とし、サーバー側のローテーションを止めます（旧版の中継はヘッダーを無視します）。

## 🌟 主な機能

- **アクティブ同期（v1.3.0）**：ブラウザの Cookie ローテーション後約 10 秒で中継へ送信。値が変わったときのみ、同一アカウントは最短 60 秒間隔、定期ポーリングで補完。拡張機能自身はローテーションもページ更新もしない
- **救済**：期限切れ、または中継が active のまま `is_healthy=false`（セッション無効）のときだけタブを更新して新 Cookie を送信
- **HttpOnly Cookie 読取**：`chrome.cookies` で `__Secure-` 認証 Cookie を取得
- **サイレント更新**：開いている Gemini タブを自動更新
- **アカウント単位送信 + 混同防止**：アカウント ID 指定で直接送信；未指定時は PSID 自動マッチ
- **クールダウン**：同一アカウントの連続更新を防止
- **固定サイドバー**：右側に常駐、ログを長時間監視可能
- **多言語 UI**：拡張機能 UI とログは Chrome の言語に自動追従（簡体中国語 / 繁体中国語 / 英 / 日 / 韓）、ドキュメント言語と一致
- **ゼロ依存**：Manifest V3 + 素の JavaScript、ビルド不要
- **プライバシー**：API Key と Cookie はローカルのみ、設定した中継先のみに送信。同期記録は Cookie のハッシュ指紋だけを保存し、値そのものは保存しない

## 📦 インストール

> [!TIP]
> Chrome、Edge など Chromium 系ブラウザに対応。

1. 本リポジトリをクローンまたはダウンロード
2. 拡張機能ページを開く：`chrome://extensions` または `edge://extensions`
3. 右上の **デベロッパーモード** を有効化
4. **パッケージ化されていない拡張機能を読み込む** でプロジェクトルート（`manifest.json` があるフォルダ）を選択

> [!IMPORTANT]
> `manifest.json` があるリポジトリルートを読み込んでください。本リポジトリは**拡張機能の実行ファイル、静的 docs**（`docs/`）**と単体テスト**（`tests/`、拡張機能からは読み込まれません。開発者は Node ≥ 22 で `node --test tests/` を実行）のみ — ドキュメント生成スクリプトは含みません。

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
| **更新クールダウン** | 救済時に同一アカウントを再処理しない時間。デフォルト 120 秒（アクティブ同期は固定で最短 60 秒間隔） |

**接続テスト** → **保存**（中継ドメインの権限を許可）。

> [!NOTE]
> **gemini2api 互換**：
> - v1.6.16 以降 `/admin/status` の PSID はマスク表示。**アカウント ID のバインドを推奨**。
> - v1.6.41～v1.6.43 は Google セッションが失効したアカウントも `active` のまま `is_healthy` だけを false にします。v1.3.0 以降の拡張機能は「セッション無効」として救済します。
> - **v1.6.44 以降**、拡張機能が Cookie を送ったアカウントは「ブラウザ維持」（`/admin/status` の `keepalive_mode` が `browser`）になり、サーバー側ではローテーションしません。サーバー側のローテーションに戻したい場合（例：シークレットウィンドウの Cookie に切り替えた）は、該当ブラウザで本拡張機能を無効にしてからパネルで Cookie を手動更新してください（そうしないと次の同期でまたブラウザ維持に戻ります）。

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

- **サイドバー**：上部で **アカウント ID をバインド**；アカウント状態（有効 / 期限切れ / セッション無効）、マスク済み PSID、動作ログ（アクティブ同期の記録を含む）、**今すぐ確認**、**強制更新＆送信**、右上 **中継設定**
- **ローカル Cookie**：`__Secure-1PSID` / `__Secure-1PSIDTS` の表示と中継アカウントとの一致確認
- **バッジ**：青 = 有効数、赤 = 期限切れ・セッション無効（救済対象）の数、`!` = 接続失敗

## 🔐 権限

| 権限 | 用途 |
|------|------|
| `cookies` + `*://*.google.com/*` | Gemini HttpOnly Cookie の読取と変化の監視（アクティブ同期） |
| `tabs` | gemini.google.com タブの検索・更新 |
| `storage` | 設定・ログ・同期記録（ハッシュ指紋のみ）の保存 |
| `alarms` | 定期ポーリング |
| 中継ホスト権限 | 保存時に動的申請 |

> [!NOTE]
> API Key と Cookie はローカルのみ保存し、設定した中継先以外には送信しません。v1.3.0 のアクティブ同期で権限は増えておらず、同期記録は Cookie の SHA-256 切り詰め指紋のみを保存します。

## ❓ FAQ

**Q：「gemini.google.com タブが見つかりません」？**
A：https://gemini.google.com を開いてログインし、タブを開いたままにしてください。

**Q：更新後も Cookie が読めない？**
A：未ログイン、または中継と異なるアカウントでログインしています。再ログインしてください。

**Q：送信後も expired のまま？**
A：PSID が Google 側で失効している可能性があります。再ログインが必要です。

**Q：期限切れでもないのに Cookie を送信しているのは？**
A：v1.3.0 のアクティブ同期です。ブラウザと中継は同じ Google セッションを共有しており、ブラウザが PSIDTS をローテーションすると中継側の古い値はすぐ使えなくなるため、新しい値を転送します（値が変わったときのみ、同一アカウントは最短 60 秒間隔、タブは更新しません）。gemini2api ≥ v1.6.44 なら中継側はそのアカウントのローテーションを止め、互いに押し出し合わなくなります。

**Q：サイドバーの「セッション無効」とは？**
A：中継は `active` と報告しているのに `is_healthy` が false、つまり Google セッションは実際には失効しています（gemini2api v1.6.41～v1.6.43 の報告形式）。拡張機能は「期限切れ」と同様に救済します（タブを更新して新 Cookie を送信）。

**Q：アカウント BAN のリスクは？**
A：Google への追加リクエストはしません（アクティブ同期はブラウザにある Cookie を中継へ渡すだけ、タブ更新は救済時のみ）。低頻度ですが非公式手段です。自己判断で。

**Q：アカウント混同は？**
A：送信前に PSID を照合し不一致なら拒否。**1 ブラウザ 1 アカウント**を守ってください。

**Q：`Cannot load extension with file or directory name _doc_templates`？**
A：**v1.2.2+** に更新。**v1.2.3** 以降、ドキュメント生成ツールはリポジトリから削除済み。

## ⚠ 既知の制限

- **1 ブラウザ = 1 アカウント**
- **2 時間突破は保証しない**（gemini2api v1.6.41～v1.6.43 は中継側もローテーションするため押し出し合う可能性あり。v1.6.44 以降で解消）
- **ブラウザ常駐が必要**（タブを閉じるとキープアライブ停止。アクティブ同期も開いた Gemini タブによる Cookie ローテーションが前提）

## 📄 ライセンス

[PolyForm Noncommercial License 1.0.0](../../LICENSE) — 非商用のみ。

## ⚠ 免責事項

Google とは無関係。学習・研究目的のみ。利用による一切の結果は利用者の責任です。
