# Codex CloudでGame Portalを開発する

このリポジトリはLinux上のNode.js 22以上で開発・ビルド・テストできます。Windowsのローカルパスや個人PCの秘密ファイルは必要ありません。

## 所有者が行う設定

現行の[OpenAI公式Cloud環境ガイド](https://learn.chatgpt.com/docs/environments/cloud-environments)に合わせた手順です。従来のCodex CloudのSetup script画面ではなく、現在の環境作成画面を使用してください。

1. Codexの新規タスクで **Work in → Cloud → Select environment → Create environment** を選びます。設定の **Codex Cloud → Environments → Create environment** からも作成できます。
2. GitHub接続で `ecleaire/Game-Portal` を選択します。リポジトリが出ない場合は、そのGitHub接続にこのリポジトリのアクセスを許可してください。
3. **Get started** を押し、下記のセットアップ依頼を貼り付けます。
4. インストール・テスト結果と設定を確認し、アクセス範囲はまず **Only me** にします。秘密情報の入力は不要です。
5. **Publish** を押し、**Environment published** を確認します。**Start a new task** でこの環境を選んで開発を始めます。

セットアップ依頼:

```text
ecleaire/Game-Portalを開発できる環境を準備してください。
AGENTS.md、CODEX_TASK.md、docs/CODEX_START_HERE.md、.env.example、docs/CODEX_CLOUD.mdを読んでください。
Node.js 22以上を使用し、Install scriptは bash scripts/setup-codex-cloud.sh としてください。
npm test → npm run build → npm run test:browser を実行して確認してください。
本番Supabase、Google Drive、管理者パスワード、service role keyは使用しません。
Start skillには、ビルド済みサイトの確認が必要な場合に npm run dev を起動し、http://127.0.0.1:4173/Game-Portal/ の応答を確認する手順を設定してください。
ブラウザーテストは独自に4173と54321のサーバーを起動するので、事前のdevサーバーを停止してから実行してください。
環境はOnly meで準備し、設定とテスト結果を示してください。
```

Cloud環境の実際の作成・Publishと、Cloud上での初回テストは所有者の画面で確認してください。リポジトリに設定ファイルを追加しただけでは、Cloud環境は自動作成されません。

## ネットワーク・インストール

`scripts/setup-codex-cloud.sh` はリポジトリのルートへ移動し、Nodeのバージョン確認、`npm ci`、Playwright ChromiumとLinux依存ライブラリのインストールを行います。依存関係はpackage-lock.jsonで固定されます。セットアップは再実行可能です。テストや本番変更はセットアップスクリプト内では実行しません。

パッケージマネージャーの通信を許可します。Chromium取得時に拒否された場合は、エラーに表示された公式Playwrightダウンロード先（例: `cdn.playwright.dev`、`playwright.download.prss.microsoft.com`）を追加してください。Linux依存ライブラリにはUbuntu/Debianのパッケージ取得権限が必要です。通信制限やOSパッケージの権限エラーを無視してPublishせず、環境セットアップ内で解消してください。

インストール後のテストはローカル通信のみで動作します。実際のSupabaseやGoogle APIへのアクセスは必要ありません。ビルド時の `SUPABASE_URL` と `SUPABASE_ANON_KEY` は未設定で構いません。

## テスト・プレビュー

```sh
npm test
npm run build
npm run test:browser
```

- SQL・認証テスト: PGliteにmigrationを適用して実行します。
- Edge Functionテスト: HTTP境界をテストし、外部サービスはモックを使用します。
- ブラウザーテスト: テスト用DB/APIとローカルサイトを自動起動します。秘密情報不要で、認証、投稿、編集、審査、共有などを検証します。
- プレビュー: ビルド後に `npm run dev`。規約・FAQ・レイアウトを確認できます。規約同意の導入後、バックエンド未設定時は検索・プレイが開始されません。秘密情報なしで同意から検索・プレイまで確認する場合は、テスト用DB/APIを起動する `npm run test:browser` を利用してください。本番サービスへの接続は不要です。

`dist/` が残っている場合、ビルドは古い配信物の混入を防ぐため失敗します。再ビルド前に、このチェックアウト内の生成済み `dist/` だけを削除してください。テスト時に4173/54321が使用中なら、同じ環境のプレビュー/テストサーバーを停止します。

## 本番環境との関係

Cloudは開発用の別環境です。個人PC上の未コミット変更、`.env.bootstrap`、Drive OAuthファイル、元のGodotプロジェクトは自動では移りません。引き継ぎ事項はGitにコミットしたドキュメントへ残します。

本番のservice role key、SESSION_TOKEN_PEPPER、Google OAuth JSON、初期管理者パスワードをCloudへコピーする必要はありません。通常の開発にCloudのSecrets設定も不要です。将来実サービスの結合テストが必要になった場合は別の検証用Supabase・Drive領域を用意し、その用途に必要な権限だけを設定してください。

変更はGitHubへコミット/PRで引き継ぎます。`main`へ反映すると既存のPagesワークフローが配信します。SQL migrationとEdge Functionは別途デプロイが必要です。公開前に `docs/SETUP.md` と `docs/PUBLISHING.md` を確認してください。
