# 投稿・公開機能の有効化

`CODEX_TASK.md`を要件の正とします。公開フロントエンドはGitHub Pages、投稿ZIPの非公開原本はGoogle Driveです。公開向けの配信用コピーは**非公開Supabase Storage**に置きます。Google Driveを一般閲覧者のWebホストとして使いません。HTML/JSはGitHub Pagesに展開せず、ブラウザーがZIPを読み、`allow-scripts`だけの隔離iframeで実行します。

## 所有者が行う必要がある手順（既存サイトの更新順）

1. Supabase SQL Editorで、未適用のmigrationを番号順に適用します。今回の追加は[`202609290012_publication_controls.sql`](../supabase/migrations/202609290012_publication_controls.sql)です。既存のmigrationを再実行しないでください。`supabase db push`を使う場合は`--dry-run`で対象を確認します。
2. 同じSQL Editorで[`publication_buckets.sql`](../supabase/storage/publication_buckets.sql)を実行します。`portal-packages`と`portal-thumbnails`が **Private** であることをStorage画面で確認します。一般ユーザーにStorageの直接読み取りポリシーを追加しないでください。Freeプランのファイル上限は50MBです。投稿が失敗する場合はStorage Settingsのグローバル上限も確認します。[Supabase Storageの制限](https://supabase.com/docs/guides/storage/uploads/file-limits)
3. Edge Function `portal`を、このリポジトリの最新コードへデプロイします。CLIなら`supabase functions deploy portal`です。Dashboardでコードを編集する場合は`handler.mjs`、`drive.mjs`、`security.mjs`と`assets/private-preview.js`への依存関係をすべて最新にします。`Verify JWT with legacy secret`はOFFのままです。service_role key、Google OAuth認証情報はSupabase Secretsだけに置き、GitHub PagesやGitHub Variablesへ移しません。
4. Edge Functionで投稿、審査、公開一覧の動作を確認してからGitHub Pagesの新フロントエンドを公開します。反対の順序だと旧バックエンドに新しい投稿画面が接続して失敗します。
5. 更新前から`approved`だったゲームは配信用コピーがありません。管理画面の「配信用ファイルを準備」を押します。公開範囲が「公開」なら一覧へ、「限定公開」なら共有URLだけに表示されます。公開日時が未来なら時刻到来までサーバーがアクセスを拒否します。

## 投稿と管理

- **下書き**: ZIPを非公開で保存し、本人だけがアカウント画面からプレイできます。管理者の審査一覧に表示しません。
- **限定公開**: 一般投稿者は審査待ちになります。承認後、予測困難なゲームURLを知る人だけが開けます。ホームの一覧には載せません。URLは共有先へ転送できます。
- **公開**: 承認後にホームの一覧とゲームページへ表示します。`公開日時`が空なら即時、未来ならその時刻にサーバーの時刻判定で自動的に閲覧可能になります。定期ジョブは不要です。
- **信頼済み投稿者**: 下書き以外は審査を省略します。指定した公開範囲・公開日時の条件は同じです。
- **公開停止**: 管理者が承認済みゲームを停止すると、新しい閲覧・ZIP取得要求は拒否されます。既にブラウザーへ読み込まれたゲームを遠隔終了することはできません。投稿者も公開範囲を下書きへ戻せます。
- **既存ゲーム**: `games.json`のゲームは従来どおり動作します。投稿ゲームの一覧取得に一時障害が起きても、既存ゲームの一覧は表示します。

## Godot 4.7.2のWeb書き出し

1. プロジェクト → エクスポート → **Web**プリセットを追加します。テンプレート不足ならGodotに表示される案内からインストールします。
2. `Thread Support`をオフにします。Webでスレッドを使う場合はcross-origin isolationが必要ですが、このZIPプレビュー/配信方式では対応していません。`Extensions Support`も不要ならオフにします。[Godot公式Web書き出し文書](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)
3. **「プロジェクトをエクスポート」**で空フォルダーにWeb一式を書き出します。出力HTMLは`index.html`でも`jump.html`でも構いません。同名の`.js`、`.wasm`、`.pck`等を後から改名しないでください。Godotは書き出し時の名前の組み合わせを使います。
4. 生成されたファイルをすべてZIPにするか、投稿画面へ複数まとめてドロップします。ZIP内に1つの親フォルダーがあっても認識します。**「PCK/ZIPのエクスポート」だけ**はWeb書き出しではありません。

実ファイル`test1.zip`（`test1/jump.html`、`jump.js`、`jump.wasm`、`jump.pck`）でZIP判定と展開を検証しました。ブラウザー実行はGodotの個別機能や外部通信に依存するため、投稿後に本人用プレビューで実際のゲーム操作まで確認してください。

## セキュリティと運用

ZIPは50MB以下、展開後合計200MB以下です。パストラバーサル、symlink、暗号化ZIPを拒否します。公開用Storage bucketはPrivateで、URLだけから直接取得できません。Edge Functionは公開条件を確認してからZIPを配信します。限定公開URLは閲覧権限を持つリンクとして扱い、公開SNS等へ載せないでください。

公開ZIPをブラウザー側で展開するため、端末メモリーを使います。Godotのスレッド/GDExtension/PWA Service Worker等、追加の権限やヘッダーが必要な書き出しはサポート対象外です。投稿者は隔離プレビューで動作確認してください。
