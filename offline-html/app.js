const $ = selector => document.querySelector(selector);
let root = null, remembered = null, metadata = null, games = [], editing = null, busy = false;
let stopGame = null, pendingSave = null, saveTimer, saveChain = Promise.resolve();
let imageURLs = [], selectedTags = new Set();
const status = message => { $('#status').textContent = message; };
async function cacheHandle(value) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('game-portal-offline-folder-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('settings', value ? 'readwrite' : 'readonly'), store = tx.objectStore('settings');
      const op = value ? store.put(value, 'folder') : store.get('folder'); let result;
      op.onsuccess = () => { result = op.result; }; tx.oncomplete = () => { db.close(); resolve(result); }; tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
async function action(fn) {
  if (busy) return; busy = true;
  document.querySelectorAll('button:not([data-close]):not(#closePlayer)').forEach(b => b.disabled = true);
  status('処理しています…');
  try { await fn(); status(''); }
  catch (e) { status(e.name === 'AbortError' ? '選択をキャンセルしました。' : e.message || '操作できませんでした。'); }
  finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); $('#postButton').disabled = !root; }
}
async function refresh() {
  if (!root) return;
  metadata = await library.loadMetadata(root); games = await library.scan(root, metadata);
  $('#folderName').textContent = root.name; $('#settingFolder').textContent = root.name;
  selectedTags = new Set([...selectedTags].filter(t => games.some(g => g.tags.includes(t))));
  await render();
}
async function connect(handle, request = false) {
  const permission = request ? await handle.requestPermission({ mode: 'readwrite' }) : await handle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') throw new Error('保管フォルダーの読み書きを許可してください。');
  // Read and validate before replacing the current folder or cached handle.
  const next = await library.loadMetadata(handle); await library.scan(handle, next);
  root = handle; remembered = handle; selectedTags.clear();
  await cacheHandle(handle).catch(() => {}); $('#reconnect').hidden = true;
  await refresh(); $('#settings').close();
}
async function render() {
  for (const url of imageURLs) URL.revokeObjectURL(url); imageURLs = [];
  const allTags = [...new Set(games.flatMap(g => g.tags))].sort((a,b) => a.localeCompare(b,'ja'));
  $('#tagFilters').replaceChildren(); $('#knownTags').replaceChildren();
  for (const tag of allTags) {
    const button = document.createElement('button'); button.className = 'tag' + (selectedTags.has(tag) ? ' active' : ''); button.textContent = tag; button.setAttribute('aria-pressed', String(selectedTags.has(tag)));
    button.onclick = () => { selectedTags.has(tag) ? selectedTags.delete(tag) : selectedTags.add(tag); render().catch(e => status(e.message)); }; $('#tagFilters').append(button);
    const option = document.createElement('option'); option.value = tag; $('#knownTags').append(option);
  }
  const keyword = $('#search').value.trim().toLocaleLowerCase();
  const matches = games.filter(g => (g.title + ' ' + g.tags.join(' ')).toLocaleLowerCase().includes(keyword) && [...selectedTags].every(t => g.tags.includes(t)));
  $('#count').textContent = String(matches.length); $('#games').replaceChildren(); $('#empty').hidden = matches.length > 0;
  $('#empty').textContent = !root ? '「設定」から保管フォルダーを指定してください。' : games.length ? '条件に合うゲームがありません。' : 'ゲームがありません。「投稿」からHTML・ZIP・PYXAPPを追加できます。';
  for (const game of matches) {
    const article = document.createElement('article'); article.className = 'card';
    const cover = document.createElement('div'); cover.className = 'cover'; cover.textContent = '▶\uFE0E';
    if (game.thumbnail) try {
      const file = await library.getFile(root, `.gameportal/thumbnails/${game.id}.webp`);
      if (file.size <= 2 * 1024 * 1024) { const url = URL.createObjectURL(file); imageURLs.push(url); const img = document.createElement('img'); img.src = url; img.alt = ''; cover.replaceChildren(img); }
    } catch { /* A missing image does not make the game unavailable. */ }
    const body = document.createElement('div'); body.className = 'cardbody';
    const title = document.createElement('h2'); title.textContent = game.title;
    const type = document.createElement('p'); type.className = 'type'; type.textContent = game.kind === 'pyxapp' ? 'Pyxel' : 'Webゲーム';
    const tags = document.createElement('div'); tags.className = 'tags';
    for (const tag of game.tags) { const span = document.createElement('span'); span.className = 'tag'; span.textContent = tag; tags.append(span); }
    const buttons = document.createElement('div'); buttons.className = 'buttons';
    const play = document.createElement('button'); play.textContent = 'プレイ'; play.onclick = () => action(() => playGame(game));
    const edit = document.createElement('button'); edit.textContent = '編集'; edit.className = 'secondary'; edit.setAttribute('aria-label', game.title + 'を編集'); edit.onclick = () => editGame(game);
    buttons.append(play, edit); body.append(title, type, tags, buttons); article.append(cover, body); $('#games').append(article);
  }
}
function editGame(game) {
  editing = game; $('#editTitle').value = game.title; $('#editTags').value = game.tags.join(', '); $('#editImage').value = ''; $('#clearImage').checked = false; $('#edit').showModal();
}
async function thumbnail(file) {
  if (file.size > 10 * 1024 * 1024 || !['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('画像はPNG・JPEG・WebPの10MB以内で選択してください。');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
    const ctx = canvas.getContext('2d'), scale = Math.max(960 / bitmap.width, 540 / bitmap.height);
    ctx.drawImage(bitmap, (960 - bitmap.width * scale) / 2, (540 - bitmap.height * scale) / 2, bitmap.width * scale, bitmap.height * scale);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('画像を処理できません。')), 'image/webp', .85));
  } finally { bitmap.close(); }
}
async function flushSave() {
  clearTimeout(saveTimer);
  if (pendingSave) { const { folder, id, data } = pendingSave; pendingSave = null; saveChain = saveChain.then(() => library.writeFile(folder, `.gameportal/saves/${id}.json`, JSON.stringify(data))).catch(e => { $('#playerStatus').textContent = 'セーブを保存できません：' + e.message; }); }
  await saveChain;
}
function receiveSave(folder, game, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length > 1000 || Object.values(data).some(v => typeof v !== 'string') || JSON.stringify(data).length > 500000) return;
  pendingSave = { folder, id: game.id, data }; clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 150);
}
async function playGame(game) {
  const folder = root; await flushSave(); if (stopGame) stopGame();
  $('#playerTitle').textContent = game.title; $('#playerStatus').textContent = '読み込んでいます…'; $('#player').showModal();
  try {
    const file = await game.handle.getFile(); let options;
    const embedded = game.kind === 'html' ? library.embeddedPyxel(await file.text()) : null;
    if (game.kind === 'pyxapp' || embedded) {
      if (file.size > 50 * 1024 * 1024) throw new Error('PYXAPPは50MB以内にしてください。');
      const bytes = embedded ? Uint8Array.from(atob(embedded), c=>c.charCodeAt(0)) : new Uint8Array(await file.arrayBuffer()); library.validatePyxapp(bytes); let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      options = { kind: 'pyxapp', app: btoa(binary), runtime: JSON.parse($('#runtime').textContent) };
    } else {
      let files = game.kind === 'zip' ? await preview.unpackPrivateZip(await file.arrayBuffer()) : await library.readTree(game.folder);
      if (game.kind === 'html') files.set('index.html', files.get(game.entry));
      let saved = {};
      try { const save = await library.getFile(folder, `.gameportal/saves/${game.id}.json`); if (save.size <= 500000) saved = JSON.parse(await save.text()); } catch (e) { if (e.name !== 'NotFoundError') throw e; }
      options = { kind: game.kind, files, saved };
    }
    stopGame = player.startPlayer($('#frame'), options, preview, message => {
      if (message?.type === 'ready') $('#playerStatus').textContent = 'ゲームを表示しました。';
      if (message?.type === 'error' || message?.type === 'status') $('#playerStatus').textContent = String(message.message).slice(0, 500);
      if (message?.type === 'save') receiveSave(folder, game, message.data);
    });
  } catch (e) { $('#playerStatus').textContent = e.message; throw e; }
}
$('#settingsButton').onclick = () => $('#settings').showModal();
$('#chooseFolder').onclick = () => action(async () => {
  if (!window.showDirectoryPicker) throw new Error('フォルダーの読み書きに対応したGoogle Chromeを使用してください。');
  const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'game-portal-library' }); await connect(handle);
});
$('#reconnect').onclick = () => action(() => connect(remembered, true));
$('#refresh').onclick = () => action(refresh);
$('#search').oninput = () => render().catch(e => status(e.message));
$('#postButton').onclick = () => $('#post').showModal();
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => button.closest('dialog').close());
for (const id of ['postFiles', 'postDirectory']) $( '#' + id).onchange = event => action(async () => {
  if (!root) throw new Error('保管フォルダーを指定してください。');
  await library.postGame(root, event.target.files, preview); event.target.value = ''; $('#post').close(); await refresh();
});
$('#editForm').onsubmit = event => { event.preventDefault(); if (!event.target.reportValidity()) return; action(async () => {
  const current = await library.loadMetadata(root);
  if (current.revision !== metadata.revision) throw new Error('管理情報が更新されています。「再読み込み」してください。');
  let hasImage = editing.thumbnail && !$('#clearImage').checked;
  const file = $('#editImage').files[0];
  if (file) { await library.writeFile(root, `.gameportal/thumbnails/${editing.id}.webp`, await thumbnail(file)); hasImage = true; }
  current.games[editing.path] = { title: $('#editTitle').value.trim(), tags: library.tagsFrom($('#editTags').value), thumbnail: hasImage };
  await library.saveMetadata(root, current); $('#edit').close(); await refresh();
}); };
$('#closePlayer').onclick = async () => { await flushSave(); if (stopGame) stopGame(); stopGame = null; $('#player').close(); };
$('#player').addEventListener('cancel', event => { event.preventDefault(); $('#closePlayer').click(); });
$('#fullscreen').onclick = () => $('#frame').requestFullscreen().catch(e => { $('#playerStatus').textContent = e.message; });
if (!window.showDirectoryPicker) status('このブラウザーはフォルダーへの保存に対応していません。PC版Google Chromeを使用してください。');
else cacheHandle().then(async handle => {
  if (!handle) return; remembered = handle; $('#settingFolder').textContent = handle.name;
  if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') await action(() => connect(handle));
  else { $('#reconnect').hidden = false; status('設定の「再接続する」で保管フォルダーへのアクセスを許可してください。'); }
}).catch(() => {});
