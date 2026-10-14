# 完全オフライン HTML版 GAME PORTAL

PC版Google Chrome（Windows / macOS）推奨です。配布ZIPを展開し、`GAME-PORTAL.html` をChromeで開きます。画面・Pyxel・Pyodide・Python標準ライブラリーはHTMLに同梱しています。使用中のCDN・Supabase・Google Drive接続、アカウント登録は不要です。

## 使用手順

1. 「設定」→「フォルダーを指定」で、ゲーム専用のローカルフォルダーを選び、読み書きを許可します。
2. 既存のHTML・WebゲームZIP・Pyxel PYXAPPが一覧に表示されます。「投稿」ではファイル、またはWeb書き出しフォルダー一式を保管フォルダーへコピーします。投稿元のファイルは変更しません。
3. 各ゲームの「編集」で表示名・タグ（カンマ区切り）・サムネイル・開発環境（自由入力）を変更し、「保存」を押します。次回起動時も保存内容が反映されます。ゲーム名・タグ・開発環境で検索し、複数タグを選択すると、選択タグをすべて持つ作品に絞り込みます。
4. 「プレイ」で起動します。Pyxelは準備後にゲーム画面をクリックして開始します。音声もこの操作で有効になります。
5. フォルダーへ直接ゲームを追加・移動した場合は「再読み込み」。アクセス許可が切れたときは、設定の「再接続する」またはフォルダー指定を使用します。

対応形式はHTML/HTM、HTMLを含むZIP、Pyxelの `.pyxapp`。EXE、ネイティブ用ZIP、Pythonの任意パッケージを後からネット取得する作品には対応しません。Pyxel 2.9.9 / Pyodide 314.0.4を同梱します。別バージョン固有の機能を使う作品は互換性を確認してください。

GodotはWeb書き出しの全ファイルをZIPまたはフォルダーで投稿してください。Scratch/TurboWarpは素材を含むHTMLまたはZIPを使用します。ZIPは50MB、展開後200MB・500ファイルまで。HTMLフォルダーも200MB・500ファイルまで。Webゲームの外部HTTP通信・ダウンロード・親画面へのアクセスは許可しません。スレッド必須のGodot書き出しや、外部サーバー必須の作品は動作しません。

## 別PCへの持ち運び

`GAME-PORTAL.html` と保管フォルダー全体をコピーします。初回にChromeから保管フォルダーを選び直してください。PC固有の絶対パスは管理ファイルへ保存しません。Chromeのアクセス許可は別PCには引き継げません。フォルダーを指定し直してもゲーム・タグ・画像は保持されます。

```text
GAME-PORTAL.html
ゲーム保管フォルダー/
  MyGame.html
  MyGame.html.gameportal.json    このゲームの設定
  game.pyxapp
  game.pyxapp.gameportal.json    このゲームの設定
  .gameportal/
    saves/              ### ゲームごとの設定ファイル

投稿時に、起動ファイルの隣へ `<起動ファイル名>.gameportal.json` を作成します。フォルダー作品なら `index.html.gameportal.json`、ZIPなら `作品.zip.gameportal.json` です。既存フォルダーのゲームは、初めて「編集」→「保存」した時点で作成します。画面の保存先表示で実際のファイル名を確認できます。サムネイルはWebPへ変換し、同じJSON内に埋め込むため画像ファイルを別途持ち運ぶ必要はありません。

```json
{
  "schema": 1,
  "id": "0123456789abcdef0123456789abcdef",
  "title": "ゲームの名前",
  "tags": ["アクション", "お気に入り"],
  "developmentEnvironment": "Godot 4.5",
  "thumbnail": null,
  "updatedAt": "2026-10-14T00:00:00.000Z"
}
```

通常はHTML画面から編集してください。JSONを直接編集した場合は画面で「再読み込み」を押してください。`schema` と `id` は変更しないでください。他の画面や手作業で更新された設定は、再読み込み前の編集内容で上書きしません。旧版の `.gameportal/library.json` と画像は読み取り互換を維持し、編集保存時に対象ゲームだけ新形式へ引き継ぎます。旧ファイルは自動削除しません。

HTMLゲームのlocalStorage相当のセーブ
```

HTMLゲームのlocalStorageは作品ごとのJSONへ保存します（約500KBまで）。IndexedDBやCookieを使うゲームの保存は対象外です。Pyxelの独自セーブファイル保存は、この版では自動同期しません。設定ファイルを作成したゲームは、ゲームと隣の設定ファイルを一緒にフォルダーごと移動すると同じIDを維持します。ファイル自体を改名する場合は、設定ファイル名も `<新しいゲームファイル名>.gameportal.json` に合わせてください。セーブも移す場合は `.gameportal/saves/` を含めてコピーしてください。改名・移動前にバックアップしてください。複数PC・複数タブで同じ保管フォルダーを同時編集しないでください。将来版の管理情報や壊れたJSONを自動上書きしません。

ランチャーHTMLはゲーム保管フォルダーの外に置いてください。保管フォルダーの名前・一覧情報はゲーム内へ渡さず、選択した作品の実行データのみを隔離iframeへ渡します。Chromeのフォルダー許可画面は手動で操作が必要です。モバイルChrome・Safari・Firefoxでは書き込み可能なフォルダー選択に対応しないため、この版の対象外です。HTMLファイルのダブルクリック起動を基本とし、必要な機能がブラウザー設定で無効になっている場合はChrome設定を確認してください。

## 開発・配布ビルド

```sh
npm ci
npm run offline:prepare
npm run offline:build
npm run offline:test
```

`offline:prepare` は固定バージョンの公式配布物を取得し、`offline-html/runtime-lock.json` のSHA-256を検証します。初回ビルド準備のみネット接続が必要です。Node.js 22以上を使用し、Node.js 24でプロキシを使う環境では `NODE_USE_ENV_PROXY=1` を設定してください。取得済みデータは `.tools/offline-runtime`、変更したキャッシュは `OFFLINE_RUNTIME_CACHE` で指定します。`offline:build` はネット取得を行いません。出力は `offline-release/GAME-PORTAL-HTML.zip` と単体HTMLです。ランタイムのライセンス表示も配布ZIPへ含めます。Pagesの本番サイトとデータベースは変更しません。
