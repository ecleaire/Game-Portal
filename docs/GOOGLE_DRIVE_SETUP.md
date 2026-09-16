# Google Drive：管理者専用の投稿保管領域

投稿されたZIPは、Google Driveの**非公開 `pending` フォルダー**に保管します。ブラウザーはGoogleの認証情報、folder ID、Drive file ID、共有URLを受け取りません。管理者以外にフォルダーを共有しなければ、投稿者を含む一般ユーザーはDrive上のファイルを閲覧できません。

Driveは投稿ZIPの保管・審査用です。公開ゲームのHTMLホスティングには使いません。

## 所有者が行う設定

1. Google Cloud Consoleで所有者管理のプロジェクトを作成し、**Google Drive API**を有効にします。
2. **サービス アカウント**を1つ作成します。鍵をJSON形式で一度だけ生成し、安全なパスワードマネージャーまたは秘密管理に保管します。鍵ファイルをリポジトリ、Google Drive、GitHub Actions、GitHub Pagesに置かないでください。
3. Google Driveで `Game-Portal/pending`、`Game-Portal/approved`、`Game-Portal/rejected` の3フォルダーを作成します。すべての一般アクセスを「制限付き」のままにし、作成したサービスアカウントのメールアドレスだけを**編集者**として追加します。一般ユーザーや「リンクを知っている全員」には共有しません。
4. 3つのフォルダーのURLからfolder IDを取得します。
5. Supabase Dashboard → Edge Functions → `portal` → Secretsに、次を設定します。値を画面やソースコードへ貼り付けないでください。

   - `GOOGLE_SERVICE_ACCOUNT_JSON`: サービスアカウントJSON全体を1行の値として設定
   - `GOOGLE_DRIVE_PENDING_FOLDER_ID`、`GOOGLE_DRIVE_APPROVED_FOLDER_ID`、`GOOGLE_DRIVE_REJECTED_FOLDER_ID`: 手順4のID

6. Edge Function `portal` を、このリポジトリの `supabase/functions/portal/` で再デプロイします。次のSQL migrationもSupabase SQL Editorで適用します。

   - `supabase/migrations/202609140004_private_game_submissions.sql`

## 保管時の制約

- 投稿者は`uploader`権限、active状態、非BANである必要があります。
- ZIPは最大50MBです。ZIP形式、エントリー数、展開後合計200MB、HTMLエントリーの存在を検査し、パストラバーサル、絶対パス、Windows区切り、symlink、暗号化ZIPを拒否します。ZIPを展開して実行する処理はありません。
- Edge Functionがセッションを確認してからDriveへ送信し、DBにはDrive file IDを非公開値として記録します。
- 投稿者には投稿状態だけを返し、DriveのファイルID・閲覧リンクは返しません。
- 管理者はZIPをダウンロードして隔離環境で確認できます。承認／却下するとファイルを対応する非公開フォルダーへ移動し、監査ログを残します。承認は公開ではありません。

サービスアカウントは`drive.file`スコープで短時間のアクセストークンをEdge Function内で取得します。ブラウザーでGoogleログインやOAuth callbackを実装する必要はありません。
