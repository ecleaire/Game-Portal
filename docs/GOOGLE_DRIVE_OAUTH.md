# 個人のGoogle Drive：所有者OAuthで投稿を保存する

サービスアカウントにはDriveの保存容量がありません。個人のマイドライブへの投稿は、所有者OAuthで保存します。秘密情報はSupabase Edge Function Secretsだけに置き、GitHub Pages・GitHub Actionsへ渡しません。

## 所有者が行う手順

1. Google Cloud Consoleで所有者のプロジェクト（例：`mesmerizing-bee-448514-h2`）を選び、Google Drive APIを有効にします。
2. Google Auth PlatformのBranding・Audienceを設定します。個人GoogleアカウントならExternalを選び、Testingの場合は所有者をTest usersに追加します。
3. Clients → Create client → **Desktop app** を選び、JSONをダウンロードします。Web application用ではありません。鍵作成とGoogleのアクセス許可は所有者が行います。
4. JSONをリポジトリ外（例：`C:\Users\echo0\game-portal-drive-client.json`）に保存します。チャットへ貼り付けないでください。
5. PowerShellでリポジトリに移動し、Node 22以上で次を実行します。出力先もリポジトリ外にします。

```powershell
Set-Location 'C:\Users\echo0\Documents\ChatGPT\GODOT共有\Game-Portal'
node scripts/setup-drive-oauth.mjs 'C:\Users\echo0\game-portal-drive-client.json' 'C:\Users\echo0\.game-portal-drive-secrets.env'
```

`node`が見つからない場合、このPCのCodex同梱Nodeを使えます。

```powershell
& 'C:\Users\echo0\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' scripts/setup-drive-oauth.mjs 'C:\Users\echo0\game-portal-drive-client.json' 'C:\Users\echo0\.game-portal-drive-secrets.env'
```

6. 表示されたGoogle認証URLを、このPCのブラウザーで開き、保存先の所有者アカウントで許可します。スクリプトはPKCE・stateを検証し、127.0.0.1でのみcallbackを受け付けます。認証コード・callback URL・出力ファイルの内容を共有しないでください。
7. スクリプトは`drive.file`スコープだけで、新しい非公開 `Game-Portal submissions (private)` と `pending`・`approved`・`rejected` を作成します。このスコープでは既存の手作りフォルダーへのアクセスは自動的に許可されないため、生成されたIDを使います。一般アクセスを「制限付き」のままにし、一般ユーザーへ共有しません。
8. 出力ファイルの4つの値をSupabase Dashboard → Edge Functions → Secretsへ登録します。

   - `GOOGLE_DRIVE_OAUTH_JSON`（`client_id`・`client_secret`・`refresh_token`を持つJSON）
   - `GOOGLE_DRIVE_PENDING_FOLDER_ID`
   - `GOOGLE_DRIVE_APPROVED_FOLDER_ID`
   - `GOOGLE_DRIVE_REJECTED_FOLDER_ID`

OAuthが設定されている場合は、既存の`GOOGLE_SERVICE_ACCOUNT_JSON`より優先します。認証失効時に別アカウントへ勝手に切り替えません。旧フォルダー・投稿ZIPは削除せず、移行が必要な場合は所有者が個別に確認します。

## デプロイと確認

1. `portal`を最新コードへデプロイします。DashboardのCodeからデプロイする場合も`googleDriveOAuthJson: Deno.env.get('GOOGLE_DRIVE_OAUTH_JSON') ?? ''`を渡します。`supabase/functions/portal/index.ts`を参照してください。今回のOAuth対応に新しいSQLは不要です。
2. 管理画面で**投稿保管を確認**を押します。フォルダーへの接続と保存・移動権限を確認します。成功しても保存容量・実際のZIP保存の成功までは保証しません。
3. `uploader`で小さなWebゲームZIPを投稿し、`pending`になることを確認します。管理者がZIPをダウンロードでき、承認で`approved`へ移ることを確認します。
4. `trusted_uploader`の場合は保存完了で`approved`になります。GitHub Pagesへの公開は別の手順です。

## 継続運用・失敗時

TestingのExternal OAuthでは、Driveスコープのrefresh tokenが通常7日で失効します。継続運用ではAudienceの公開状態をProductionへ変更し、Googleが表示する要件を完了してから認証を取り直します。失効・取り消し時は管理画面に再認証が必要と表示します。[Googleのトークン有効期限](https://developers.google.com/identity/protocols/oauth2#expiration)

出力先の上書きは禁止です。失敗すると空ファイルや途中までの値が残る場合があります。再実行時は新しい出力名を指定してください。フォルダー作成失敗時も取得済みOAuthは出力ファイルに残します。スクリプトは既存データ・認証を削除しません。

ZIPは所有者のDrive容量を消費します。容量不足・API制限・権限の取り消し時は保存できません。所有者以外へ保管フォルダーを共有しない限り、一般ユーザーはDrive上のファイルを見られません。投稿者本人のプレビューはサーバーで認可され、Google認証情報・Drive IDは公開しません。

公式仕様：[デスクトップOAuth・PKCE・loopback](https://developers.google.com/identity/protocols/oauth2/native-app)、[Driveの保存所有権](https://developers.google.com/workspace/drive/api/guides/about-shareddrives)
