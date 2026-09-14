# Google Drive：Phase 3向け所有者設定

Phase 1/2はGoogle資格情報を必要としません。現時点ではDrive API呼び出し、ZIPアップロード、承認・公開機能は実装していません。認証・認可基盤の検証を終えてから以下を実施してください。Driveは投稿ZIPの保管/アーカイブ専用で、HTMLの公開ホスティングには使いません。

## 所有者が行う必要がある手順

1. Google Cloud Consoleで所有者管理のプロジェクトを作成/選択し、APIs & Services → LibraryでGoogle Drive APIを有効にします。
2. Google Auth PlatformでBranding/Audience/Data Accessを設定します。外部アプリのテストモードでは所有者をテストユーザーへ追加します。テストモードのrefresh tokenには短い有効期限がある場合があるので、本番公開前にGoogle側の公開状態・必要な審査を確認します。
3. 将来実装する**サーバー側の**OAuth callbackのHTTPS URLを決め、そのURLに完全一致するredirect URIをOAuth Web application clientへ登録します。GitHub PagesのJavaScriptへclient secretを埋め込まないでください。まだcallbackは存在しないため、現在のPages URLを仮のcallbackとして運用しません。
4. 所有者が安全なローカル/サーバー側のOAuth設定ツールで認可し、offline accessによるrefresh tokenを取得します。最小権限`https://www.googleapis.com/auth/drive.file`を第一候補とします。認可ツールにはstate検証・PKCE・コードの一度限りの交換を実装します。アクセストークンやrefresh tokenを画面/ログ/共有URLへ出しません。
5. 同じアプリの資格情報で`Game-Portal`と`pending`/`approved`/`rejected`（任意で`thumbnails`）を作成し、返されたfolder IDを保存します。`drive.file`は任意の既存フォルダーへ自由にアクセスする権限ではないため、所有者が手作業で作ったフォルダーにアクセスできるとは仮定しません。
6. server-onlyの`GOOGLE_DRIVE_FOLDER_ID`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_REFRESH_TOKEN`をSupabase secretsへ設定します。`.env.example`はキー名の参照です。Phase 3実装まで設定を急ぐ必要はありません。

## 次の実装で守るインターフェース

- ブラウザー → 独自セッションを検証するバックエンド → Drive。ブラウザーへGoogle tokenを渡しません。
- 認可時点のactive/non-bannedと`uploader`権限を確認し、DBに投稿メタデータとDrive file/folder IDを保存します。ファイル名を識別子にしません。
- 保存先はpending、審査結果でapproved/rejected。Drive共有設定は非公開を維持します。
- ZIP上限、拡張子/MIME、エントリーHTML、展開後サイズ、エントリー数、zip-slip・絶対パス・symlink・zip bombへの対策を実装してからアップロードを有効化します。
- Phase 3では承認後に`approved`で止める方式も可。公開時は別originに安全に配置し、GitHub Pages向けメタデータを生成します。`games.json`の現行公開一覧はそれまで維持します。

参考：[Drive API認証スコープ](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)、[OAuth Web server flow](https://developers.google.com/identity/protocols/oauth2/web-server)。
