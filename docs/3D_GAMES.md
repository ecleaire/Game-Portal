# 3DゲームのWeb投稿

3D作品も通常のWeb書き出しZIPで投稿できます。Godot 4はCompatibilityレンダラーとWebGL 2.0を使用します。Forward+／Mobile向けの機能はWebでは利用できないため、互換性レンダラーで素材・ライト・見た目を確認してください。Thread Supportはオフ、Extensions Supportもオフにします（現在の隔離プレイヤーではクロスオリジン分離を必要とする書き出しを扱いません）。C#版Godot 4のWeb書き出しは現時点で公式対応していません。

投稿ページに書き出し設定と視点操作の案内を掲載します。プレイ用は50MB、制作プロジェクトは500MBまでです。3D向けのサイズ制限変更、ネイティブ実行ファイルの配信、外部サーバー通信の解放は行いません。

公開・共有・本人プレビュー・管理者審査プレビューの隔離iframeで `allow-pointer-lock` を許可します。ユーザーがゲーム内をクリック／キー入力した際にFPSなどの視点操作でマウスをキャプチャできます。Escで解除できます。スマホの操作は作品側で実装してください。

`mountPrivatePreview` はsandboxの許可を `allow-scripts` と `allow-pointer-lock` のみに限定し、未知の許可は拒否します。`allow-same-origin`、上位ページ遷移、ポップアップ、保存領域、外部通信、認証情報の取得は従来どおり許可しません。

ブラウザーテストではWebGL 2.0の3D描画、クリックからの実際のマウスキャプチャ／解除、親DOM・保存領域へのアクセス拒否を確認します。CIの描画検証だけはChromiumのソフトウェア描画を使います。実際のGodotゲームの動作やスマホのフレームレートは作品・端末にも依存するため、投稿前に対象端末で確認してください。

変更はフロントエンドのみです。追加migration・秘密情報・Edge Function再デプロイは不要です。

`tests/fixtures/godot-3d` に検証用シーンがあります。Compatibility・Thread SupportオフのWebプリセットで書き出してZIPにまとめ、`GODOT_3D_WEB_ZIP` 環境変数にそのZIPの絶対パスを設定して `npm run test:browser` を実行すると、実Godotの起動・クリックでのマウスキャプチャ・Esc解除も検証できます。未指定のCIは実Godotの1件だけスキップし、WebGL 2.0描画と隔離・視点操作のテストを実行します。エンジン／テンプレート／書き出したWASMはリポジトリへ含めません。

参考：[Godot公式Web書き出し](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)。Unityなど他の制作環境は、Web書き出し形式が現在のZIP内ローカル配信・隔離制約に適合するか個別に確認してください。
