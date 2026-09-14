# Game Portal

Godot / Scratch のWebゲームをまとめて遊べるゲームポータルです。

## 公開URL

https://ecleaire.github.io/Game-Portal/

## ゲーム追加

- Godot: Web Exportしたファイルを `games/<game-id>/` に配置
- Scratch: TurboWarp PackagerでHTML化して `games/<game-id>/` に配置
- `games.json` にタイトル、エンジン、説明、パスなどを追加

## 認証・管理機能（Phase 1 / 2）

一般ユーザーと管理者のログインを分離し、メール不要・管理者のみのユーザー作成に対応しました。本人用パスワードと複数の管理者追加パスワード、ユーザー名/権限変更、KICK、期限付き/永久BAN、BAN解除、無効化/再有効化、監査ログを利用できます。

- [Supabase・初期管理者・ローカル開発・公開手順](docs/SETUP.md)
- [認証/セッション設計とセキュリティ上の制約](docs/SECURITY.md)
- [API仕様](docs/API.md)
- [Google Driveの所有者設定とPhase 3への引き継ぎ](docs/GOOGLE_DRIVE_SETUP.md)

`npm ci` → `npm test` → `npm run build` → `npm run dev`でローカル確認できます（Node.js 22以上）。公開値が未設定でも既存ゲームは動作します。GitHub Pagesは`dist/`の公開ファイルだけを配信します。

追加URLは`login/`、`account/`、`admin/`、`upload/`です。ログインはページ内だけで保持し、再読み込み時は再ログインが必要です。ゲーム投稿・Drive連携・審査・自動公開はPhase 3以降で、現在は投稿を受け付けません。未信頼ゲームの公開前に、ゲームと管理画面のorigin分離が必要です。
