# Google Drive：管理者専用の投稿保管領域

投稿されたZIPは、Google Driveの**非公開 `pending` フォルダー**に保管します。ブラウザーはGoogleの認証情報、folder ID、Drive file ID、共有URLを受け取りません。管理者以外にフォルダーを共有しなければ、投稿者を含む一般ユーザーはDrive上のファイルを閲覧できません。

Driveは投稿ZIPの保管・審査用です。公開ゲームのHTMLホスティングには使いません。

## 所有者が行う設定

**個人のマイドライブの場合は、[所有者OAuthの設定手順](GOOGLE_DRIVE_OAUTH.md)を使ってください。以下はGoogle Workspaceの共有ドライブ専用です。** サービスアカウントにはDriveの保存容量がなく、ファイルを所有できません。個人フォルダーへの編集者共有だけでは投稿できません。[Google公式仕様](https://developers.google.com/workspace/drive/api/guides/about-shareddrives)

1. Google Cloud Consoleで所有者管理のプロジェクトを作成し、**Google Drive API**を有効にします。
2. **サービス アカウント**を1つ作成します。鍵をJSON形式で一度だけ生成し、安全なパスワードマネージャーまたは秘密管理に保管します。鍵ファイルをリポジトリ、Google Drive、GitHub Actions、GitHub Pagesに置かないでください。
3. Google Workspaceの専用**共有ドライブ**内に `Game-Portal/pending`、`Game-Portal/approved`、`Game-Portal/rejected` を作成します。マイドライブの共有フォルダーとは異なります。メンバーは管理者だけに限定し、サービスアカウントにファイル追加・移動ができる権限（例：Content manager）を与えます。一般ユーザーや「リンクを知っている全員」には共有しません。
4. 3つのフォルダーのURLからfolder IDを取得します。
5. Supabase Dashboard → Edge Functions → `portal` → Secretsに、次を設定します。値を画面やソースコードへ貼り付けないでください。

   - `GOOGLE_SERVICE_ACCOUNT_JSON`: サービスアカウントJSON全体を1行の値として設定
   - `GOOGLE_DRIVE_PENDING_FOLDER_ID`、`GOOGLE_DRIVE_APPROVED_FOLDER_ID`、`GOOGLE_DRIVE_REJECTED_FOLDER_ID`: 手順4のID

6. Edge Function `portal` を、このリポジトリの `supabase/functions/portal/` で再デプロイします。既存プロジェクトでは、未適用の次のSQL migrationを番号順にSupabase SQL Editorで適用します。

   - `supabase/migrations/202609140004_private_game_submissions.sql`
   - `supabase/migrations/202609160005_submission_review.sql`
   - `supabase/migrations/202609170006_rebind_portal_api_admin_actions.sql`
   - `supabase/migrations/202609170008_account_profile.sql`
   - `supabase/migrations/202609170009_user_submission_management.sql`
   - `supabase/migrations/202609170010_private_game_preview.sql`
   - `supabase/migrations/202609260011_trusted_submitters_and_review_admins.sql`

7. 管理画面で**投稿保管を確認**を押します。3フォルダーへの接続、保存権限、pendingからの移動権限、共有ドライブ所属を確認します。成功しても保存容量や実際のZIP保存の成功は保証しません。小さなゲームZIPを投稿し、審査待ち・ダウンロード・承認まで確認してください。3フォルダーは同じ共有ドライブに置く必要があります。

## 保管時の制約

- 投稿者は`uploader`権限、active状態、非BANである必要があります。
- ZIPは最大50MBです。ZIP形式、エントリー数、展開後合計200MB、ZIP直下の`index.html`を検査し、パストラバーサル、絶対パス、Windows区切り、symlink、暗号化ZIPを拒否します。「PCK/ZIP」だけのGodot書き出しはWebゲームではないため拒否します。ZIPをサーバーで展開して実行する処理はありません。
- Edge Functionがセッションを確認してからDriveへ送信し、DBにはDrive file IDを非公開値として記録します。
- 投稿者には投稿状態だけを返し、DriveのファイルID・閲覧リンクは返しません。
- 投稿者本人の「非公開でプレイ」は、本人の有効なセッションを再確認してZIPをブラウザーへ返し、ブラウザー内で展開します。ゲームは`allow-scripts`のみを許可した隔離iframe内で動き、ポータルのログイン情報へアクセスできません。ZIPにはルートの`index.html`が必要です。大きなZIPは端末のメモリーを使います。Supabase Edge FunctionsはHTMLを`text/plain`へ書き換えるため、Edge FunctionのURLをゲームのWebホスティングとして直接埋め込まないでください。
- 管理者はZIPをダウンロードして隔離環境で確認できます。承認／却下するとファイルを対応する非公開フォルダーへ移動し、監査ログを残します。承認は公開ではありません。

サービスアカウントは`drive.file`スコープで短時間のアクセストークンをEdge Function内で取得します。ブラウザーでGoogleログインやOAuth callbackを実装する必要はありません。
