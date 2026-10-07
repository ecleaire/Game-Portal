# 規約同意・ゲーム報告の実装報告

## 変更ファイル

- 正式規約・プライバシー：`terms/index.html`、`privacy/index.html`
- ページの同意領域・共通資産読込：`index.html`、`game.html`、`login/index.html`、`account/index.html`、`upload/index.html`、`admin/index.html`
- 共通同意・検索・プレイ・ログイン・投稿・報告：`assets/terms.js`、`assets/consent.css`、`assets/reports.js`、`assets/app.js`、`assets/play.js`、`assets/portal.js`
- Edge Function：`supabase/functions/portal/handler.mjs`、`supabase/functions/portal/security.mjs`
- 新規migration：`supabase/migrations/202610080021_terms_acceptance.sql`、`supabase/migrations/202610080022_game_reports.sql`
- テスト：`tests/terms.test.mjs`、`tests/auth.test.mjs`、`tests/edge.test.mjs`、`tests/browser/terms.spec.mjs`、`tests/browser/portal.spec.mjs`
- 文書：`docs/TERMS_SOURCE_2026-10-08.txt`、`docs/TERMS_UPDATES.md`、`docs/SITE_POLICIES.md`、`docs/CODEX_CLOUD.md`、本書

## 実装内容

DBの現行版を `/policy` 経由で取得し、バージョンをフロントエンド定数に重複保持しません。ログインはパスワード・状態/BANを検証した後、明示的同意と現行版を検証し、履歴保存とユーザーsession発行を同一transactionで処理します。同意履歴は user_id / terms_version / accepted_at のみで、同一版は重複せず、ユーザー削除時に削除します。管理者の `/admin/` ログインには同意チェックを追加していません。共通 `/login/` は全員にチェックを表示し、既存の管理者優先振り分けを維持しています。

匿名同意はlocalStorageの `game-portal.terms.acceptance.v1` にversion / acceptedAtのみ保存します。通常ログイン成功時も同じ情報を保存し、パスワードやsession tokenを移しません。検索のカタログ取得と直接URLのゲーム本体取得は同意後に開始します。規約APIの失敗時は閉じたままにし、再試行を表示します。

投稿時は未選択の必須確認欄を表示します。サーバーでも現行の同意履歴・権利確認・versionを検証し、submission_id / terms_version / confirmed_atだけを別表に保存します。

ゲーム報告は理由・1000文字以内の詳細を受け付け、対象ゲーム・日時・状態とともに保存します。IP/UAや報告者アカウントIDは追加保存しません。共有作品は共有権限を検証します。管理者は100件ごとの一覧から対応状態を変更でき、対応操作だけがauditに残ります。報告だけで作品が自動削除されることはありません。

提供DOCXの規約本文は全13条を掲載し、110段落の一致を確認しました。制定日・適用日は2026年10月8日です。規約・プライバシーのドラフト表示とnoindexを削除し、個人情報の登録を求めないことと実際の技術情報の取扱いを区別しています。

## 検証

`npm test` は70件成功、`npm run build` は成功、`npm run test:browser` は25件成功しました。規約原稿110段落との一致、スマートフォン表示、`git diff --check` も確認しました。テストはPGliteとローカルの実Edge handlerを使い、本番Supabase・Google Drive・本番秘密情報は使用していません。

新規検証項目：未同意/false/旧版でのログイン拒否、同意履歴の冪等性・新版追加・削除連動、BAN・不正パスワード時の非記録、privateテーブルへの直接アクセス拒否、報告対象・共有権限・管理権限・audit、明示同意前の検索/ZIP読込停止、規約改定時の再同意、取得失敗時の停止、規約リンクの別タブ表示、端末配色・モバイルレイアウト。

## 本番反映と手動確認

本番migration、Edge Function、Secrets、Pagesは今回未変更です。既存バックエンドのままフロントエンドだけを公開すると検索・プレイ・ユーザーログインが規約確認で停止するため、`main`には先行反映しません。

[TERMS_UPDATES.md](TERMS_UPDATES.md) に初回導入、将来の改定、保存内容、報告運用を記載しています。承認後にmigration 021→022、Edge Function、Pagesの順で切り替えます。既存sessionは維持されますが、新規ログイン・投稿はDB適用時点から新しい同意入力を必要とします。

手動確認が残る点：第9条6項のアカウント削除申請の案内方法、外部サービスの保存リージョン・接続ログ/バックアップの保管条件、報告・監査データの保存運用、適用日と実際の公開日の整合。年齢・保護者本人の身元確認機能は設けず、指定された同意文言で確認します。匿名のlocalStorage同意は画面上の同意制御であり、静的ゲーム資産そのものへの直接HTTPアクセスを防ぐ機能ではありません。
