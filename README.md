# 🏐 VolleyBoard - バレーボール戦術ホワイトボード

リアルタイム共同編集できるバレーボール専用ホワイトボードです。  
QRコードやURLを共有するだけで、複数人で同時に編集できます。

## 機能

| 機能 | 説明 |
|------|------|
| ✏️ ペン | フリーハンド描画 |
| 🧹 消しゴム | 描画を消去 |
| ➡️ 矢印 | 動きの軌跡・戦術フロー |
| 📝 テキスト | 自由テキスト入力 |
| 🖐️ 移動 | 選手マーカーをドラッグで移動 |
| 🔵 自チーム選手 | 番号付き青マーカー |
| 🔴 相手チーム選手 | 番号付き赤マーカー |
| 📱 QRコード | URLを共有して複数人で参加 |
| ↩️ Undo/Redo | Ctrl+Z / Ctrl+Y |
| 🗑️ 全消去 | ボードを初期化（全ユーザーに反映） |

**選手マーカーの削除**: 右クリック or 消しゴムツールで消去  
**テキスト確定**: Enter キー

---

## セットアップ

### 1. Ably APIキーの取得

1. [ably.com](https://ably.com) で無料アカウントを作成
2. ダッシュボード → Apps → API Keys からキーをコピー
3. `app.js` の先頭にある以下の行を編集:

```javascript
const ABLY_API_KEY = 'YOUR_ABLY_API_KEY_HERE';
//                    ↑ ここに取得したキーを貼り付け
```

**無料プランの制限**: 月100万メッセージ、同時接続200まで（チーム用途には十分）

### 2. ローカルで確認

```bash
npx serve .
```
→ http://localhost:3000 をブラウザで開く（2つのタブで開くと動作確認できます）

### 3. GitHub Pages へのデプロイ

1. GitHubリポジトリを作成
2. `index.html`, `style.css`, `app.js` をプッシュ
3. Settings → Pages → Source: main branch を選択
4. 表示されたURLでアクセス可能

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

> ⚠️ **セキュリティ注意**: APIキーはクライアントのJSに露出します。  
> Ablyダッシュボードで「Capabilities」を `subscribe,publish,presence` に限定することを推奨します。

---

## 使い方

1. ページを開くと自動的に新しいルームが作成されます
2. 右上の 📱 ボタンまたはURLをコピーして共有
3. 参加者はURLまたはQRコードからアクセス → 同じルームに自動参加
4. ルームIDはURLの `?room=XXXXXX` パラメータで管理

## ファイル構成

```
volley/
├── index.html   # メインUI
├── style.css    # ダークテーマスタイル
├── app.js       # アプリロジック + Ably同期
└── README.md    # このファイル
```
