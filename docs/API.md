# Portal API (Phase 1/2)

`POST {SUPABASE_URL}/functions/v1/portal`、JSON `{ "action": "…", "data": { … } }`。
任意の公開`apikey`と、ログイン以外では`X-Portal-Session`が必要です。生のトークンはログイン応答にだけ含みます。Supabase JWTではありません。body上限は8192バイト。

| action | data | 認可 / 応答 |
| --- | --- | --- |
| user.login | username, password | 公開 / token, expires_at, user |
| admin.login | username, password | 公開 / token, expires_at, admin |
| logout | なし | 有効セッション / ok |
| user.me | なし | 一般セッション / user |
| user.profile | display_name, avatar_key | 一般セッション / user。表示名は1〜40文字、アイコンは固定候補の識別子のみ |
| user.rename | username | 一般セッション / user |
| user.password | current_password, password | 本人用パスワード照合 / ok, reauthenticate |
| user.submissions | なし | 一般セッション / 自分の投稿一覧（最大100件） |
| user.submission.create | title, engine, version, description, controls, visibility, published_at | 投稿権限 / uploading状態の投稿を作成。下書き・限定公開・公開を選択 |
| user.submission.visibility | submission_id, visibility, published_at | 投稿者本人 / 公開範囲・予約日時を更新。承認済みZIPの変更は伴わない |
| user.submission.update | submission_id, title, engine, description（任意）, version, controls（任意） | 一般セッション / 自分の未完了・審査待ち・却下投稿を更新。却下投稿は再審査待ちへ戻る |
| user.submission.withdraw | submission_id | 一般セッション / 自分の投稿を取り下げ。ZIPは非公開保管を継続 |
| admin.me | なし | 管理セッション / admin |
| admin.users | offset（任意、非負整数） | 管理 / users、最大100件 |
| admin.audit | before_id（任意、非負整数） | 管理 / events、新しい順100件 |
| admin.create | username, password, role（player/uploader） | 管理 / user |
| admin.rename | user_id, username | 管理 / user |
| admin.role | user_id, role（player/uploader） | 管理 / user |
| admin.passwords | user_id | 管理 / passwords（ID/ラベル/作成日時のみ） |
| admin.password.add | user_id, password, label（任意） | 管理 / user |
| admin.password.revoke | user_id, password_id | 管理 / user |
| admin.kick | user_id | 管理 / user |
| admin.ban | user_id, banned_until（ISO8601、nullで永久）, reason（任意） | 管理 / user |
| admin.unban | user_id | 管理 / user |
| admin.disable | user_id | 管理 / user |
| admin.enable | user_id | 管理 / user |
| admin.submissions | offset（任意、非負整数） | 管理 / submissions（Drive IDは返さない） |
| admin.submission.unpublish | submission_id, reason（任意） | 管理 / 承認済みゲームの公開停止と監査ログ |

投稿ZIPのアップロード・審査・ダウンロードは、通常のJSON API actionではありません。Edge Function内でセッションを再検証してから、非公開Driveファイルを操作します。Drive file IDはブラウザーへ返しません。

`POST /catalog`は一覧公開中のゲームだけを返します。`POST /public-game`、`/public-package`、`/public-thumbnail`は`{"slug":"…"}`を受け、承認済みかつ限定公開/公開で、予約時刻を過ぎたゲームだけを返します。投稿者本人の下書きプレビューは`/preview-package`で有効な本人セッションを検証します。`/submission-thumbnail`も本人または管理者セッションを検証します。配信用ZIPはPrivate StorageからEdge Function経由で返し、Driveを公開Webホストにしません。[公開機能の設定](PUBLISHING.md)

失敗応答は`{ "error": "code" }`。401=セッション無効、403=権限不足、404=対象なし、409=ユーザー名重複、429=rate limit、503=バックエンド未設定/一時障害、それ以外の入力/資格情報エラーは400です。データベースの生エラーを返しません。

KICK/BAN等の成功応答はDBトランザクション確定後です。UIで操作ボタンを隠すことを認可として扱わないでください。再試行時、createはusername一意制約で重複を防止しますが、代替パスワード追加は再試行で別行が増え得ます。タイムアウト後は一覧で状態を確認してから再操作してください。
