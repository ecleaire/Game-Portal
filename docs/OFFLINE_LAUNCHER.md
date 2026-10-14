# Windows ゲームランチャー

設定で指定したフォルダー内のゲームを一覧表示し、クリックして起動するWindows x64向けアプリです。アカウント・ログイン・投稿・審査・Supabase・Google Driveへの接続は使用しません。

## 使い方

1. `GAME-PORTAL-0.1.0-Windows-x64.exe` を起動します。
2. 右上の「設定」→「フォルダーを指定」で、ゲームが入っているオフラインフォルダーを選びます。
3. 一覧から「プレイ」を押します。ゲームをフォルダーへ追加・移動したら「再読み込み」を押します。

対応形式はHTML/HTM、WebゲームのZIP、WindowsのEXEです。フォルダー直下と3階層下までを探します。Web書き出しフォルダーは `index.html` を優先し、なければHTMLが1件だけのフォルダーを1作品として表示します。ゲームのフォルダー内の素材ディレクトリーは再帰検索しません。EXEは実行ファイル名で表示します。

```text
ゲーム保管フォルダー/
  Scratch.html
  Webゲーム.zip
  Godotゲーム/
    index.html
    game.js
    game.wasm
    game.pck
  Windowsゲーム/
    MyGame.exe
    MyGame.pck
```

HTMLとEXEは元の場所から起動し、コピー・移動・削除しません。EXEはそのゲームのフォルダーを作業ディレクトリーとしてWindowsアプリで起動します。BAT、ショートカット、EXE入りZIPの自動実行には対応しません。ネイティブゲームのZIPはWindowsで展開してからフォルダーに置いてください。

WebゲームのZIPは初回起動時に検証してローカルキャッシュへ展開します。50MB、展開後200MB、500ファイルまで。ZIP更新時は再展開します。GodotはWeb書き出し一式、Scratch/TurboWarpは素材を含むHTML/ZIPを用意してください。

フォルダーのパスはアプリ設定に保存し、次回起動時に復元します。Webゲームのセーブ・ブラウザーデータ・ZIPキャッシュは指定フォルダー内の `.gameportal-data` に保存します。Webゲームのファイル名や相対位置を変えると別作品として扱います。EXEゲームのセーブ先はそのゲーム自身の仕様によります。フォルダーを切り替えてもゲームは残ります。管理はWindowsのエクスプローラーから行います。

オフラインで動く作品である必要があります。Webゲームの外部通信は遮断し、Node.js・ランチャーIPC・端末権限は渡しません。EXEは通常のWindowsプログラムとして動作し、Webゲームの隔離対象ではありません。オンライン認証・CDN・外部APIに依存するゲームのオフライン動作は保証しません。USB等を使う場合は起動時に接続してください。キャッシュ・Webセーブ用にフォルダーへの書き込み権限が必要です。

## 開発・ビルド

```sh
npm ci
npm run launcher:dev
npm run launcher:test
npm run launcher:build:win
```

Windows上を基本とします。GitHub Actions **Build Windows offline launcher** はWindows上の実行テスト後、portable EXEを生成しArtifactsへ保存します。出力先は `launcher-release/`。コード署名・公開Releaseへの自動掲載は設定していません。初回の依存インストール・ビルドにはネット接続が必要です。Linux CloudのWeb開発用セットアップではElectron本体の取得を省略します。Pagesの公開ファイルにランチャーは含めません。
