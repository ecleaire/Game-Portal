# GAME PORTAL オフラインHTML版 引き継ぎ

更新日：2026年10月14日。現在の開発対象は、**PC版Chromeで動く、アカウント不要のオフラインゲームランチャー**です。次の担当者は本書と [利用・運用手順](OFFLINE_HTML.md) を読んでから再開してください。

## 1. 現在地と公開先

| 項目 | 現在の状態 |
| --- | --- |
| リポジトリ | `ecleaire/Game-Portal` |
| 作業ブランチ | `codex/offline-html-launcher` |
| PR | [#6](https://github.com/ecleaire/Game-Portal/pull/6)、OPEN・Draft、mainへ未マージ |
| 検証・配布済みの実装コミット | `5b82292af42ab8665beebfd1fd0a3bbfcd88299a` |
| 配布バージョン | `0.3.0`（配布ブランチのsource.jsonに記録） |
| 配布用ブランチ | `downloads/offline-html` |
| 配布コミット | `c34f836eef631cce38c56efd48ba62dda2842a84` |
| 確認時点のmain | `11edd67ae67f7260a69e08de8902184197f7645b` |

**検証済みの配布ZIP：**

https://raw.githubusercontent.com/ecleaire/Game-Portal/c34f836eef631cce38c56efd48ba62dda2842a84/GAME-PORTAL-HTML.zip

ZIPサイズ：12,715,717 bytes。SHA-256：

```text
6ce0f5ab933b84fb533537f2590188c9f28890933edebc3f40925c254383fa22
```

この文書を追加するコミットは上記の実装コミットより後になります。実装・配布の検証基準は上記の5b82292です。

既存のオンラインサイト https://ecleaire.github.io/Game-Portal/ は同じリポジトリの別の利用形態です。今回のHTMLランチャーは、配布ZIPを展開してローカルで開くものです。ZIPの公開と、mainへのマージ・Pages配信・Supabaseのデプロイはそれぞれ別の操作です。

## 2. ユーザーの確定方針

- Windows / macOSのPC版Google Chromeを推奨するHTMLアプリ。
- 閲覧・ゲームの投稿・プレイ・登録後の編集をHTML画面から行う。
- アカウント、ログイン、Supabase、Google Drive、CDN接続をランチャーの実行に必要としない。
- ゲームはユーザーが指定したローカルフォルダー、またはOSから参照可能なNAS共有フォルダーへ保存する。
- ゲームごとの設定をファイルに残し、別PCでもゲーム名・タグ・画像・開発環境を引き継げるようにする。
- タグの参考先としてユーザーが指定した「GODOTPORTAL」は、上記の既存GAME PORTALの `#games`。別サイトを探す必要はない。
- デスクトップEXE案より後に、HTML版を採用した。現在の作業をElectron版へ戻さない。

ルートのCODEX_TASK.md等には既存オンラインシステムの仕様がある。本タスクでは、現在のユーザー方針とオフライン版の範囲を優先し、オンライン側の認証・投稿・管理画面・配信方式は維持する。

## 3. 実装済み

### 利用・編集

- 「設定」から保管フォルダーを指定。**起動ごとに選び直す。**
- 初期状態は閲覧用。初回は、編集する人が一人で「ゲームの追加・編集を有効にする」をオンにしてライブラリIDを作成する。初期設定後は閲覧者もプレイできる。
- HTML/HTM、WebゲームZIP、Web書き出しフォルダー、Pyxel `.pyxapp` を投稿・起動できる。
- 対応形式のPyxel書き出しHTMLも認識する。
- 各カードの「編集」でゲーム名、画像、タグ、開発環境を変更する。
- 既存サイトの公開タグ77件・8分類をHTMLへ同梱。カテゴリから選択・解除でき、独自タグも入力できる。最大12タグ、1タグ32文字。
- ゲーム名・タグ・開発環境で検索。複数タグはAND条件。
- Pyxel 2.9.9、Pyodide 314.0.4、Python標準ライブラリー等19ファイルをHTMLへ同梱。初回の開発用取得以外はインターネット不要。

### 共有時の保護

- セーブは各PC・ChromeプロファイルのIndexedDBへ保存する。NASへ新しい共有セーブを書き込まない。
- Web Locksで、同じChromeプロファイル内の同一ライブラリ・同一ゲームの同時起動を防ぐ。
- セーブの個別書き出し・確認つき読み込み。別ゲームの書き出しデータは拒否する。
- ローカル保存に失敗したら未保存内容を保持し、プレイヤーの終了を止める。再試行・書き出しができる。
- 設定保存は元の内容との比較、排他書き込みの要求、書き込み直前の再確認、履歴保存、保存後の読み戻しを行う。
- 投稿中はマーカーで一覧から隠し、コピーと設定保存の完了後に表示。失敗時はその投稿用フォルダーだけを削除しようとする。
- 壊れたゲーム設定や重複作品IDは該当カードで案内し、その作品を停止。他の正常な作品は利用できる。
- 作品はopaque sandboxのiframeで動かし、フォルダーハンドルを渡さない。ゲームからの外部HTTP通信は許可しない。
- iframeの再起動はnonce付きready通知で同期する。セーブ読み込みによる連続再起動も検証済み。

## 4. 保存方式

```text
保管フォルダー/
  game-UUID/
    index.html
    index.html.gameportal.json
  Sample.pyxapp
  Sample.pyxapp.gameportal.json
  .gameportal/
    library-id.json
    history/作品ID/保存試行UUID.json
    library.json       旧版由来の場合のみ
    thumbnails/        旧版由来の場合のみ
    saves/             旧版の共有セーブ。新版は書き換えない
```

- `library-id.json` は `{ "schema": 1, "id": "32文字の16進数" }`。ライブラリの識別に使用する。勝手に再生成・削除しない。
- ゲーム設定は `<起動ファイル名>.gameportal.json`。`schema`、`id`、`title`、`tags`、`developmentEnvironment`、`thumbnail`、`updatedAt` を保存する。
- `thumbnail` はWebPのdata URL、またはnull。画像は同じJSONに埋め込む。
- 設定の読み書き上限は2MiB。表示名・開発環境はそれぞれ120文字まで。
- 履歴は `gamePath`、`before`、`after`、`savedAt` を持つ。before/afterは設定JSONの文字列で、初回のbeforeはnull。履歴は保存試行であり、保存完了の証明ではない。
- 投稿中のマーカーは投稿用フォルダー直下の `.gameportal-uploading`。強制終了等で残れば一覧から隠す。
- 旧 `library.json` と画像は読み取り互換があり、編集保存時に対象ゲームを新形式へ引き継ぐ。元のファイルは自動削除しない。

ブラウザー側：

- IndexedDB名：`game-portal-offline-folder-v1`、DB version 3。
- `settings`：前回のフォルダー名だけを保存。フォルダーハンドル・絶対パスは保存しない。
- `saves`：キーは `[libraryId, gameId]`。文字列値のみ、1000キー・UTF-8で500,000 bytesまで。
- localStorageの `game-portal.offline-editing`：追加・編集モードのオン・オフ。
- ライブラリIDごとコピーすると同じ論理ライブラリになる。同じPC・Chromeプロファイルではセーブも共有する。独立したライブラリを作る場合は新しい空フォルダーを初期設定して投稿する。

## 5. 主なファイル

| ファイル | 役割 |
| --- | --- |
| `offline-html/index.html` | UIのHTMLテンプレート |
| `offline-html/style.css` | オフライン版のスタイル |
| `offline-html/app.js` | 画面操作・編集・フォルダー選択・プレイ・セーブ処理 |
| `offline-html/library.js` | ファイル読み書き、走査、投稿、設定・履歴、ライブラリID |
| `offline-html/local-state.js` | Chrome内の保存、個別セーブ、起動ロック |
| `offline-html/player.js` | HTML/Pyxelのsandbox起動、保存ブリッジ、ready同期 |
| `offline-html/tag-presets.json` | 公開タグ77件のスナップショット |
| `offline-html/runtime-lock.json` | ランタイム19ファイルのURL・サイズ・SHA-256 |
| `scripts/build-offline-html.mjs` | ランタイムの検証と単体HTML・ZIP生成 |
| `tests/offline-html.test.mjs` | パス・設定・破損・競合・障害等の単体テスト |
| `tests/offline-html/browser.mjs` | 投稿・編集・保存・実プレイ等のブラウザーテスト |
| `.github/workflows/offline-html.yml` | Windows/macOSの配布ビルドとブラウザーテスト |
| `docs/OFFLINE_HTML.md` | 利用者・運用者向け手順 |

ビルドは既存の `assets/private-preview.js` と `assets/zip-upload.js` も利用する。共有ファイルを変更するときは、オンライン版への影響も確認する。

## 6. 開発・検証の再開

Node.js 22以上を使用する。直近のCloud環境はNode.js 24.19.0。

```sh
npm ci
npm run offline:prepare
npm test
npm run offline:build
npm run offline:test
```

`offline:prepare` は初回のみ公式ランタイムを取得し、固定SHA-256を検証する。通常の `offline:build` はネット取得しない。キャッシュがある場合は再利用する。

現在のCloudチェックアウトでは次の設定で成功した。パスや実行ファイルは次の環境で存在を確認すること。

```sh
OFFLINE_RUNTIME_CACHE=/workspace/.cache/offline-html-runtime npm run offline:build
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium npm run offline:test
```

標準キャッシュは `.tools/offline-runtime`。Node.js 24でCloudのプロキシを使用して取得する場合は `NODE_USE_ENV_PROXY=1` を使用し、既存のプロキシ・CA設定を維持する。

出力はgitignore対象の `offline-release/`：単体 `GAME-PORTAL.html`、README、ライセンス、`GAME-PORTAL-HTML.zip`。生成物だけを手編集しない。

**直近の検証結果：**

- `npm test`：122件成功、失敗0。
- オフライン版の関連単体：14件成功。
- 配布ビルド：固定ランタイム19ファイルを検証して成功。
- ローカル実ブラウザー：閲覧専用、投稿・再編集、旧情報移行、タグ選択、設定競合、セーブ移行・連続再起動・保存失敗時の再試行、別タブの起動制御、独立ライブラリでのセーブ分離、HTML/ZIP/PYXAPP実行、実Pyxelゲームループ、初回HTML読込後のHTTP通信ゼロを確認。
- [Windows/macOS CI](https://github.com/ecleaire/Game-Portal/actions/runs/38582622890)：両方成功。file://起動も検証。
- Cloudの管理Chromeはfile://を管理者ポリシーで拒否するため、ローカルでは同じHTMLをlocalhostで検証した。ポリシーを回避しない。
- 配布ZIPは匿名ダウンロード、SHA-256照合、ZIPのCRC整合性を確認済み。

ドキュメントのみの変更でアプリの全テストを再実行する必要はない。上記は配布済み実装の結果であり、将来変更後の保証ではない。

## 7. 配布の更新

1. 作業ブランチで変更・検証し、ソースをコミットしてpushする。既存PR #6へ継続する。
2. `offline:build` で配布物を生成する。
3. `downloads/offline-html` を親にした新しいコミットで配布物を更新する。作業ブランチと配布ブランチを混同しない。既存履歴を維持してfast-forwardでpushし、force pushしない。
4. 配布ブランチには `GAME-PORTAL-HTML.zip`、`README.txt`、`THIRD-PARTY-LICENSES.txt`、`SHA256SUMS.txt`、`source.json` を置く。source.jsonにはrepository、検証したsource_commit、versionを記録する。
5. 配布コミットを固定したraw.githubusercontent.comのURLから匿名でZIPを取得し、ローカルのSHA-256、公開したSHA256SUMS、ZIP整合性を照合する。
6. PRの説明と公開リンクを更新する。

前回は作業チェックアウトを切り替えず、Gitの `hash-object`、`mktree`、`commit-tree` で配布ブランチの次のコミットを作成した。`/tmp` の補助スクリプトが次の環境でも残るとは考えないこと。

過去にActionsのアーティファクトURLを匿名ダウンロード用として案内し、404になった。配布先は上記raw URLとする。ブランチ名のraw URLには古いZIPがキャッシュされる場合があるため、**案内時には検証済みの配布コミット固定URLを使う**。CloudでGitHub Releaseのアップロード先がネットワークポリシーにより拒否された経緯もある。拒否を回避せず、現行の配布方式を利用する。

## 8. 制限・未検証事項

- 実NASのSMB接続、OS・NASの読み書き権限、複数の物理PCでの切断・復旧は未検証。
- `createWritable({ mode: 'exclusive' })` やWeb Locksは、別PC間での厳密な同時編集防止を保証しない。同じゲームの設定は同時編集しない。厳密な制御にはNAS上の管理サーバー等が必要。
- 追加・編集モードは操作ミス防止のUI。認証・権限制御ではない。NASの読み取り専用権限も併用する。
- 初期設定は一人で行う。library-id.jsonと作品IDは保存領域の識別に使うため、勝手に再生成しない。
- フォルダー情報をブラウザーに保存・復元する試行では、Windows/macOS CIで別タブのハンドル読み戻しが停止した。現在は固定ライブラリIDと、起動ごとのフォルダー再選択で解消している。ハンドル永続化を安易に戻さない。
- 設定履歴は自動削除しない。履歴からの復元UIもまだなく、手動復旧となる。
- ローカルセーブはChromeのデータ削除・プロファイル変更等で参照できなくなる可能性がある。書き出しを併用する。
- 旧共有セーブは自動移行せず、該当ゲームの「セーブ読み込み」で必要な人が取り込む。
- セーブの対象はHTML/ZIPゲームのlocalStorage相当。ゲーム独自のIndexedDB・Cookie・Pyxel独自ファイルは対象外。
- ZIPは50MB以内、展開後またはフォルダー作品は200MB・500ファイル以内。
- EXE、外部サーバー必須のゲーム、スレッド必須のGodot Web書き出し、モバイルChrome・Safari・Firefoxは対象外。

## 9. 次の改善候補（未実装・優先順位は未確定）

直前にユーザーへ提案した内容。ユーザーはまだ実装対象を選択していないため、引き継ぎ作成をこれらの実装指示と解釈しない。

1. 設定履歴を画面から確認し、以前の名前・画像・タグ等へ戻す復元UI。
2. 全ゲームのセーブの一括バックアップ・復元。
3. ライブラリ点検：欠落ファイル、破損設定、重複ID、投稿途中の残骸を一覧化。
4. NAS上の追加・変更を検出して更新通知。編集中の内容は勝手に置き換えない。
5. 説明文・操作方法・ゲームのバージョン・開発者名の追加。
6. お気に入り、最近遊んだゲーム、名前・登録日による並べ替え。利用者ごとの情報はPC側に保存する。

まず復元UI・セーブ一括バックアップ・ライブラリ点検を優先する案を提示済み。現時点では提案のみ。

## 10. 次のチャットに渡す再開用の文面

```text
リポジトリ ecleaire/Game-Portal のオフラインHTMLランチャー開発を引き継いでください。
作業ブランチは codex/offline-html-launcher、既存Draft PRは #6 です。
AGENTS.md、docs/OFFLINE_HTML_HANDOFF.md、docs/OFFLINE_HTML.md を読んでください。
現在はPC版Chrome、完全オフライン、アカウントなし、ローカル/NASフォルダー保管です。
ゲームごとのJSON設定、タグ77件、Pyxel対応、PC別セーブ、NAS共有時の保護を実装・配布済みです。
フォルダーは起動ごとに選び直し、識別はNAS内の固定ライブラリIDで行います。
オンライン版のSupabase・Google Drive・認証・Pages配信を不要に変更しないでください。
直近の改善候補は引き継ぎ文書の第9節にありますが、実装範囲は次の依頼に合わせてください。
```
