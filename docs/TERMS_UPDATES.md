# 規約同意・報告機能の導入と規約改定

## 初回導入（本番は所有者の承認・作業が必要）

この変更はフロントエンドだけを先に公開しないでください。`main`へのpushはPagesを自動更新します。本番migration・Edge Functionは今回の実装作業では適用しません。

1. ステージングで既存migrationと `202610080021_terms_acceptance.sql`、`202610080022_game_reports.sql` を順に適用し、既存データ・独自認証との互換性を確認します。既存migrationは変更しません。
2. 所有者が本番への適用を明示的に承認した後、本番の適用対象を `supabase db push --dry-run` などで確認し、上記2件を適用します。過去の同意履歴は自動生成せず、既存sessionを一括失効させません。migration適用後は旧フロントエンドのユーザーログイン・新規投稿が同意不足で拒否されるため、短い切替時間を確保してください。管理者ログインは利用できます。
3. 同じチェックアウトから `supabase functions deploy portal` を実行します。`handler.mjs` / `security.mjs` を含むEdge Function全体を更新します。独自セッション方式のため既存のVerify JWT設定を維持します。新しい秘密情報は不要です。
4. POST `/functions/v1/portal/policy` がDBの現行version・effective_atを返すことを確認します。`terms_required` / `terms_outdated` を返すユーザーログインでセッションが発行されないこと、管理者認証が通常どおり動くことを確認します。
5. フロントエンドをレビューしてから `main`へ反映しPagesを公開します。検索・公開/限定公開/アカウント共有の直接URLで同意前にゲームファイルを取得しないことを確認します。初版の制定日・適用日は指定どおり2026年10月8日です。それ以前に公開する場合は適用日との関係を運営者が確認してください。
6. テスト用の報告を送り、管理画面で状態を変更できることを確認します。報告で作品を自動非公開にする処理はありません。必要な対応は既存の公開停止・削除操作を使用します。

旧フロントエンドだけへ戻しても同意必須のDBとは互換になりません。障害時は管理者ログインを維持し、同意ゲートを迂回する静的版や古い規約への自動同意で復旧しないでください。

## 保存内容

- `portal_private.policy_versions`: termsのversion、適用日、is_current。現行版は部分unique indexで1件に制限します。切替は同一transactionで行い、現行版がない場合APIはunavailableです。適用日は表示情報で、is_currentを運営者が切り替えた時点から再同意が必要になります。
- `portal_private.terms_acceptances`: user_id / terms_version / accepted_atだけ。同一ユーザー・versionは一意。認証・BAN確認の後、同じtransaction内で履歴を記録してsessionを発行します。ユーザー削除時はcascade削除します。
- `portal_private.submission_confirmations`: submission_id / terms_version / confirmed_at。新規投稿には現在のユーザー同意記録と権利確認が必要です。投稿削除時にcascade削除します。既存sessionに同意記録がない場合、新規投稿前に再ログインしてください。
- 匿名同意: localStorageの `game-portal.terms.acceptance.v1` にversion / acceptedAtだけを保存します。ログイン成功時も同じ記録を保存します。session tokenは従来のsessionStorageのみです。
- 保存できないブラウザーでは現在のページ内で同意して使えますが、ページ移動・再読込時は再同意が必要です。localStorageの同意は匿名UIの制御用で、本人認証やサーバー上の同意証跡ではありません。静的ゲーム資産のURLへの直接取得をサーバーで防ぐアクセス制御ではありません。
- 規約情報の取得失敗・バックエンド未設定の場合は検索/プレイを開始せず再試行を表示します。規約本文・FAQ・プライバシーは静的ページとして読めます。規約versionの古い静的フォールバックは使用しません。

## 将来の改定

1. 規約全文を作成し、適用日・変更内容の周知方法を決めます。第12条に従い周知し、必要に応じて公開前に法務確認を行います。
2. `/terms/` の全文と日付・アンカーを更新し、必要に応じてprivacy/FAQも整合させます。過去の原稿をGit履歴に保持します。
3. **新しい**ordered migrationを追加します。既存migrationや過去の同意行を更新・削除しません。

```sql
begin;
update portal_private.policy_versions set is_current=false where policy_key='terms' and is_current;
insert into portal_private.policy_versions(policy_key,version,effective_at,is_current)
values('terms','2027-04-01','2027-04-01',true);
commit;
```

4. DBの現行versionを取得するため、JSのversion定数変更は不要です。ただし本文更新も同じリリースとして必要です。古いversionがlocalStorageにある匿名利用者は次回の検索・プレイ開始時に再同意し、アカウント利用者は次回ログイン時に新しい履歴を作成します。既存sessionは通常の有効期限まで維持します。
5. `npm test` → `npm run build` → `npm run test:browser` を実行します。再ビルド時はチェックアウト内の生成物distだけを安全に削除します。
6. ステージング確認後、承認された本番migration・Edge Function・Pagesを整合する順序で展開します。本文とAPIのversionを手動でも確認してください。

## 報告の運用

`game_reports`はID・対象ゲームID・submission ID（該当する場合）・理由・詳細（1000文字まで）・日時・状態のみを保存します。IP / User-Agent / 報告者アカウントIDは保存しません。自由記述に個人情報が含まれた場合の取扱いは運営者が判断し、不要な個人情報を残さない運用にしてください。

公開/限定公開のslugはサーバーが現在の閲覧可否を確認します。共有作品は既存ユーザーsessionで共有権限を確認します。下書きや存在しないゲームの報告は受け付けません。既存静的ゲームは `legacy_report_targets` に登録されたIDのみ報告可能です。`games.json` に静的作品を追加・削除するときは新migrationでこの登録も更新してください。

IPに依存せず、全体100件/15分・対象ゲーム20件/15分のDBレート制限を設けています。小規模運用の最低限の制限で、匿名利用者個別の公平な制限や大量投稿の完全な防止を保証するものではありません。自動削除・自動非公開はしません。

管理画面の「ゲームの報告」で未確認/確認済み/対応済み/対応不要を閲覧・変更できます。100件単位でページ送りできます。auditには対応操作のreport IDとstatusだけを記録し、詳細本文を複製しません。個別回答・通知機能、一般問い合わせフォームはありません。

## 運営者が確認する点

- 第9条6項のアカウント削除申請について、アカウント発行時の連絡方法など実際に利用者へ案内する方法を決めてください。この実装では架空の問い合わせ先や削除申請フォームを追加していません。
- 外部サービスの保存リージョン、接続ログ/バックアップの保管条件、監査・報告データの保存/見直しの運用を確認してください。実装から判別できない固定保存期間は本文に捏造していません。
- 生年月日入力や保護者本人の認証は追加せず、チェック文言による確認です。
