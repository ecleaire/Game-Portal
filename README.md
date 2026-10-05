# Game Portal

Godot / Scratch のWebゲームをまとめて遊べるゲームポータルです。

## 公開URL

https://ecleaire.github.io/Game-Portal/

## ゲーム追加

- Godot: Web Exportしたファイルを `games/<game-id>/` に配置
- Scratch: TurboWarp PackagerでHTML化して `games/<game-id>/` に配置
- `games.json` にタイトル、エンジン、説明、パスなどを追加

## 認証・管理・非公開投稿保管（Phase 1 / 2 とPhase 3の保管部分）

一般ユーザーと管理者のログインを分離し、メール不要・管理者のみのユーザー作成に対応しました。本人用パスワードと複数の管理者追加パスワード、ユーザー名/権限変更、KICK、期限付き/永久BAN、BAN解除、無効化/再有効化、監査ログを利用できます。

- [Supabase・初期管理者・ローカル開発・公開手順](docs/SETUP.md)
- [認証/セッション設計とセキュリティ上の制約](docs/SECURITY.md)
- [API仕様](docs/API.md)
- [ゲームタグの設定・管理・検索・権限制御](docs/TAGS.md)
- [投稿後のサムネイル追加・変更](docs/THUMBNAILS.md)
- [Google Driveの所有者設定とPhase 3への引き継ぎ](docs/GOOGLE_DRIVE_SETUP.md)

`uploader`権限のユーザーは`/upload/`から最大50MBのWebゲームZIP、またはWeb書き出しの複数ファイルを投稿できます。ゲームZIPは管理者だけが扱うGoogle Driveへ保管し、配信用コピーは非公開Supabase Storageへ保存します。投稿者にはDriveのURLやIDを返しません。所有者の設定は[Google Driveの管理者専用保管領域の設定](docs/GOOGLE_DRIVE_SETUP.md)と[公開機能の有効化](docs/PUBLISHING.md)を参照してください。

初めて使う場合はホームの「ゲームを探す」から公開作品を遊べます。投稿可能ユーザーは「ゲームを投稿」で作品情報・公開設定・ファイルを1ページで入力し、完了画面から作品の管理・プレビューへ進めます。後から編集する場合は「アカウント」→「投稿したゲーム」→「管理・編集する」を選びます。基本情報、公開範囲、公開日時を変更できます。承認済み作品の基本情報を保存すると公開ページにも反映されます。審査対象のゲームファイルはこの編集操作では変更されません。

Godotでは**Web**プリセットから「プロジェクトをエクスポート」し、生成されたHTML、同名の`.js`、`.wasm`、`.pck`などをまとめてください。HTML名は`index.html`に限らず`jump.html`などでも構いません。ZIP内に1つの親フォルダーがあっても受け付けます。「PCK/ZIPのエクスポート」だけではブラウザーで遊べません。Godot 4.7.2では`Thread Support`をオフにしてください。投稿後は完了画面が表示され、アカウント画面から本人だけのプレビューができます。失敗して`uploading`に残った既存投稿は、アカウント画面でZIPを再送できます。[Godot公式のWeb書き出し手順](https://docs.godotengine.org/ja/4.x/tutorials/export/exporting_for_web.html)も参照してください。

`npm ci` → `npm test` → `npm run build` → `npm run dev`でローカル確認できます（Node.js 22以上）。公開値が未設定でも既存ゲームは動作します。GitHub Pagesは`dist/`の公開ファイルだけを配信します。

追加URLは`login/`、`account/`、`admin/`、`upload/`です。ログイン状態はブラウザの同じタブ内でページを切り替えても維持されます。タブを閉じると消去され、各操作時にサーバーで有効性を確認するため、KICK・BAN・失効も直ちに反映されます。投稿者は**下書き・限定公開・公開**と公開日時を選べます。下書きは審査不要で本人のみ閲覧できます。限定公開は承認後に共有URLから、公開は承認後に一覧からも閲覧できます。未来の公開日時はサーバーで判定するため、予約時刻まで表示・配信されません。管理者は審査と公開停止ができます。ゲームはZIPのまま非公開Storageへ保存し、ブラウザー内の隔離iframeで実行します。設定順と制約は[公開機能の有効化](docs/PUBLISHING.md)を参照してください。

投稿済みゲームのファイル変更は[ファイル差し替え](docs/PACKAGE_REPLACEMENT.md)を参照してください。

[アカウント指定の共有・管理者管理・完全削除](docs/SHARING_AND_ACCOUNT_MANAGEMENT.md)
