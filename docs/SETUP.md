# Phase 1・2・非公開投稿保管セットアップ

`CODEX_TASK.md` が要件の正です。実装済み範囲は認証、セッション、アカウント、管理者によるユーザー管理、代替パスワード、KICK/BAN、監査ログ、投稿ZIPの非公開Drive保管です。管理画面での審査、承認／却下、公開自動化は後続作業です。

## 1. 所有者が行う必要がある手順：Supabase

1. Supabase Dashboardでプロジェクトを作成します。DBパスワードはパスワードマネージャーへ保存してください。
2. Project SettingsのAPI設定でプロジェクトURLと公開用anon key（またはpublishable key）を確認します。秘密の **legacy service_role key** はローカルの安全なセットアップ用途だけに使用します。フロントエンドやGitHub Variablesへ入れないでください。この実装のREST呼び出しはlegacy service_role JWTを使用します。
3. このアプリはSupabase Authを使用しません。Authenticationの設定で新規サインアップを無効化してください。ユーザーをSupabase Authへ作成する必要はありません。
4. Data APIの公開スキーマは既定の`public`を維持し、`portal_private`を追加しないでください。テーブルはすべて非公開スキーマに置き、RLSを有効化し、ブラウザー用ロールへの権限を与えていません。
5. Supabase CLIとDockerをインストールします。CLIへ`supabase login`し、リポジトリ直下で次を実行します。`PROJECT_REF`を対象プロジェクトIDに置き換えてください。

```sh
supabase link --project-ref PROJECT_REF
supabase db push --dry-run
supabase db push
```

SQLはmigration番号順に適用します。現在は`202609130001_foundation.sql`、`202609130002_admin_management.sql`、`202609140003_password_minimum_length.sql`、`202609140004_private_game_submissions.sql`、`202609160005_submission_review.sql`です。既存プロジェクトで同名スキーマ/関数がある場合は先に競合を調べます。移行済みSQLの書き換えではなく、新しいmigrationで変更してください。

6. パスワードマネージャー等で32バイト以上の暗号学的乱数を生成し、`SESSION_TOKEN_PEPPER`に使います。例の値を使い回さないでください。ローカルの`.env.edge`を作成し、以下の2項目だけを設定します。

```dotenv
SESSION_TOKEN_PEPPER=
ALLOWED_ORIGINS=https://ecleaire.github.io
```

`ALLOWED_ORIGINS`はスキームとホストだけです。`/Game-Portal/`は付けません。複数はカンマ区切り、ワイルドカードは禁止です。本番ではlocalhostを外してください。

```sh
supabase secrets set --env-file .env.edge
supabase functions deploy portal
```

Supabaseホスト環境は`SUPABASE_URL`と`SUPABASE_SERVICE_ROLE_KEY`をEdge Functionへ自動注入します。`SUPABASE_`接頭辞の値を`secrets set`で上書きする必要はありません。`config.toml`の`verify_jwt = false`は、この独自セッション方式に必要です。関数自身が保護操作すべてでDB上のセッションと権限を検証します。

投稿ZIPを使う場合は、[Google Driveの管理者専用保管領域の設定](GOOGLE_DRIVE_SETUP.md)を先に完了します。`GOOGLE_SERVICE_ACCOUNT_JSON`と`GOOGLE_DRIVE_PENDING_FOLDER_ID`は`.env.edge`ではなくSupabase Edge Function Secretsへ設定してください。これらの値をGitHub Variablesや`assets/config.js`へ入れてはいけません。

## 2. 所有者が行う必要がある手順：初期super admin

Node.js 22以上を使用します。公開HTTP APIに初期セットアップ操作はありません。所有者の端末から、service_role限定RPCを一度だけ呼び出します。

1. `.env.bootstrap`をローカルで作り、端末の自分だけが読めるファイル権限を設定します。共有/同期フォルダーより、端末の非共有ディレクトリに保存することを推奨します。その場合は`--env-file`に絶対パスを指定してください。
2. 次のキーへ実際の値を入力します。値をチャット、Issue、コマンド引数、SQL Editor、READMEへ貼らないでください。

```dotenv
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
INITIAL_ADMIN_USERNAME=
INITIAL_ADMIN_PASSWORD=
```

3. 実行します。

```sh
node --env-file=.env.bootstrap scripts/bootstrap-admin.mjs
```

成功時は作成完了のみを表示します。管理者が1人でも存在すると再実行は拒否されます。同時呼び出しもDBロックで直列化します。成功後、`.env.bootstrap`から初期パスワードを削除し、端末の環境変数にも残さないでください。認証情報の原本はパスワードマネージャーで管理します。

必要ならセットアップ後にSQL Editorで次の**秘密を含まない**SQLを実行し、RPCの実行権限も閉じられます。

```sql
revoke execute on function public.portal_bootstrap(text,text) from service_role;
```

管理者パスワード変更・追加管理者UIは今回の範囲外です。初期パスワードを紛失した場合は、先に `202609170007_admin_password_recovery.sql` を適用し、端末の非共有ディレクトリに次の秘密ファイルを作成して実行します。値をチャット、Issue、コマンド引数、SQL Editor、READMEへ貼らないでください。

```dotenv
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_USERNAME=kanri
ADMIN_RESET_PASSWORD=5文字以上72UTF-8バイト以下の新しいパスワード
```

```sh
node --env-file=/absolute/path/to/.env.admin-reset scripts/reset-admin-password.mjs
```

成功すると対象super adminの全セッションを失効させ、bcryptハッシュだけを更新します。実行直後に秘密ファイルを削除し、bootstrapの存在チェックを削除して復旧しないでください。

## 3. 所有者が行う必要がある手順：GitHub Pages

1. GitHubリポジトリのSettings → Secrets and variables → Actions → **Variables**で、`SUPABASE_URL`、`SUPABASE_ANON_KEY`を設定します。公開用の値だけです。
2. Settings → PagesのSourceをGitHub Actionsにします。
3. 変更をレビューしてmainへマージすると既存のPages workflowが`dist/`を生成・公開します。バックエンドはこのworkflowではデプロイしません。
4. `https://ecleaire.github.io/Game-Portal/admin/`で管理者ログインし、一般ユーザーを作成します。一般ユーザーは`login/`または`account/`へログインします。

公開設定が空でもビルドは成功します。新画面に「未設定」を表示し、既存の一覧・検索・プレイヤー・ゲームは動作します。公開するのはHTML、assets、games、games.json、追加ルートのみです。SQL・scripts・tests・envファイルはPages成果物へ入りません。`assets/config.js`に秘密を手書きしないでください。

GitHub Project Pagesの実際のルートは`/Game-Portal/login/`等です。HTMLリンクは相対パスなのでリポジトリ配下で動作します。独自Supabaseドメインを使う場合は、追加4ページのCSP `connect-src`もそのHTTPS originへ更新してください。

## 4. ローカル開発

```sh
npm ci
npm test
npm run build
npm run dev
```

`http://127.0.0.1:4173/Game-Portal/`を開きます。Nodeの開発サーバーは`dist/`だけを配信するので、ローカル秘密ファイルは公開されません。再ビルド時は生成物の`dist/`だけを削除してください。ビルドは古いファイルが混入しないよう、空でない出力先では停止します。

ローカルSupabaseを使用する場合：

```sh
supabase start
supabase db reset
supabase functions serve portal --env-file .env.edge
```

`db reset`は**ローカル開発DBのデータを消します**。既存データを残す本番プロジェクトには使いません。`.env.edge`の許可originに`http://127.0.0.1:4173`を追加します。ローカルURL/キーは`supabase status`で確認し、端末外へ共有しないでください。初期管理者は同じCLIスクリプトでローカルに作成します。

公開値だけの`.env.public`を用意し、次でビルドします。

```sh
node --env-file=.env.public scripts/build-site.mjs
```

`.env.public`は`SUPABASE_URL`と`SUPABASE_ANON_KEY`のみです。ローカルURLは通常`http://127.0.0.1:54321`です。

## 5. 検証

`npm test`はPGliteのPostgreSQLとpgcryptoで実際のmigration/RPCを実行し、Edge HTTP境界をテストします。Docker・本番キーは不要です。テスト内のパスワードは隔離されたテスト専用の文字列で、本番の初期値ではありません。

`npm run build`後、`npx playwright install chromium` → `npm run test:browser`で実ブラウザーの一覧/ゲーム再生、ユーザー作成、代替ログイン、KICK/BAN、モバイル表示を確認できます。テストは4173/54321ポートを使用するため、通常の開発サーバーとローカルSupabaseを停止してから実行します。任意の`PLAYWRIGHT_EXECUTABLE_PATH`で既存Chromeの絶対パスも指定できます。ブラウザーテストのDBは毎回新規で、本番キーや本番データに接続しません。

本番有効化前にステージングで確認してください：管理者ログイン→ユーザー作成→一般ログイン→代替パスワード追加/削除→本人パスワード変更→KICK→期限BAN/永久BAN→解除→無効化/再有効化。複数タブのセッション、anon keyによるRPC直接実行の拒否も確認します。PGliteテストは単一DB接続なので、Supabase実環境の同時接続・ゲートウェイ・CORS・負荷の検証を代替しません。

## 6. 運用

- セッションは一般8時間、管理者1時間で絶対期限切れ。更新トークンはありません。ログアウト・KICK・BAN・無効化はDB失効です。
- BAN解除やBAN期限到来、再有効化で旧セッションは復活しません。再ログインが必要です。
- 認証情報はページ内メモリーのみ。再読み込み/ページ移動後はログインが必要です。`login/`内でもログイン後はアカウント設定を操作できます。
- 認証失効は次のAPI操作ですぐ反映されます。操作がない表示中の画面は約60秒ごとに確認します。既に表示した情報の消去や公開ゲームの閲覧禁止を保証するものではありません。
- 15分間にログイン種別ごと全体100回、同一正規化ユーザー名10回。本人パスワード照合にも10回の制限があります。成功でもカウントします。小規模向けの保守的な値です。
- `portal_private.sessions`の期限切れ・失効済み行、`login_limits`の古い行は定期的に削除できます。監査ログは削除しません。一般ユーザーの削除UIはありません。

DB所有者による定期メンテナンス例（必要に応じてSupabase Cronへ設定）：

```sql
delete from portal_private.sessions
where expires_at < now() - interval '7 days'
   or revoked_at < now() - interval '7 days';
delete from portal_private.login_limits
where window_start < now() - interval '1 day';
```

公開サイトだけを戻す場合は公開設定を空にして再デプロイできます。ユーザーのいるDBのスキーマを削除してロールバックしないでください。

参考：[Supabase Edge認証](https://supabase.com/docs/guides/functions/auth)、[関数設定](https://supabase.com/docs/guides/functions/function-configuration)、[PostgreSQL pgcrypto](https://www.postgresql.org/docs/16/pgcrypto.html)。
