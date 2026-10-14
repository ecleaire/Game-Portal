const $ = selector => document.querySelector(selector);
let root = null, remembered = null, metadata = null, games = [], editing = null, busy = false, localLibrary = null;
let stopGame = null, pendingSave = null, saveTimer, flushing = null, activePlay = null;
let editingEnabled = false;
try { editingEnabled = localStorage.getItem('game-portal.offline-editing') === 'true'; } catch { /* A new session starts read-only. */ }
let imageURLs = [], selectedTags = new Set(), renderRevision = 0;
const status = message => { $('#status').textContent = message; document.querySelectorAll('[data-dialog-status]').forEach(node => { node.textContent = node.closest('dialog').open ? message : ''; }); };
const cacheHandle = localState.cacheHandle;
function writeControls() {
  $('#postButton').disabled = !root || !editingEnabled;
  $('#enableEditing').checked = editingEnabled;
  $('#accessMode').textContent = editingEnabled ? '追加・編集が有効です。共有フォルダーは同時編集を避けてください。' : '閲覧・プレイのみ。ゲームと設定を書き換えません。';
  document.querySelectorAll('[data-unavailable]').forEach(button => { button.disabled = true; });
  document.querySelectorAll('[data-edit]').forEach(button => { button.disabled = !editingEnabled || button.dataset.invalid === 'true'; });
}
async function action(fn) {
  if (busy) return; busy = true;
  document.querySelectorAll('button:not([data-close]):not(#closePlayer)').forEach(b => b.disabled = true);
  status('処理しています…');
  try { await fn(); status(''); }
  catch (e) { status(e.name === 'AbortError' ? '選択をキャンセルしました。' : e.message || '操作できませんでした。'); }
  finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); writeControls(); }
}
async function refresh() {
  if (!root) return;
  metadata = await library.loadMetadata(root); games = await library.scan(root, metadata);
  $('#folderName').textContent = root.name; $('#settingFolder').textContent = root.name;
  selectedTags = new Set([...selectedTags].filter(t => games.some(g => g.tags.includes(t))));
  await render();
}
async function connect(handle, request = false) {
  const mode = editingEnabled ? 'readwrite' : 'read';
  const permission = request ? await handle.requestPermission({ mode }) : await handle.queryPermission({ mode });
  if (permission !== 'granted') throw new Error('保管フォルダーへのアクセスを許可してください。');
  // Read and validate before replacing the current folder or cached handle.
  const next = await library.loadMetadata(handle), nextGames = await library.scan(handle, next);
  if (!await flushSave()) throw new Error('このPCへのセーブを完了してからフォルダーを切り替えてください。');
  const nextLocalLibrary = await localState.localLibraryId(handle);
  root = handle; localLibrary = nextLocalLibrary; remembered = handle; selectedTags.clear();
  await cacheHandle(handle).catch(() => {}); $('#reconnect').hidden = true;
  metadata = next; games = nextGames; $('#folderName').textContent = handle.name; $('#settingFolder').textContent = handle.name;
  await render(); $('#settings').close();
}
async function render() {
  const revision = ++renderRevision, folder = root;
  for (const url of imageURLs) URL.revokeObjectURL(url); imageURLs = [];
  const allTags = [...new Set(games.flatMap(g => g.tags))].sort((a,b) => a.localeCompare(b,'ja'));
  $('#tagFilters').replaceChildren(); $('#knownTags').replaceChildren();
  for (const tag of allTags) {
    const button = document.createElement('button'); button.className = 'tag' + (selectedTags.has(tag) ? ' active' : ''); button.textContent = tag; button.setAttribute('aria-pressed', String(selectedTags.has(tag)));
    button.onclick = () => { selectedTags.has(tag) ? selectedTags.delete(tag) : selectedTags.add(tag); render().catch(e => status(e.message)); }; $('#tagFilters').append(button);
    const option = document.createElement('option'); option.value = tag; $('#knownTags').append(option);
  }
  const keyword = $('#search').value.trim().toLocaleLowerCase();
  const matches = games.filter(g => (g.title + ' ' + g.developmentEnvironment + ' ' + g.tags.join(' ')).toLocaleLowerCase().includes(keyword) && [...selectedTags].every(t => g.tags.includes(t)));
  $('#count').textContent = String(matches.length); $('#games').replaceChildren(); $('#empty').hidden = matches.length > 0;
  $('#empty').textContent = !root ? '「設定」から保管フォルダーを指定してください。' : games.length ? '条件に合うゲームがありません。' : 'ゲームがありません。「投稿」からHTML・ZIP・PYXAPPを追加できます。';
  for (const game of matches) {
    const article = document.createElement('article'); article.className = 'card';
    const cover = document.createElement('div'); cover.className = 'cover'; cover.textContent = '▶\uFE0E';
    if (typeof game.thumbnail === 'string') { const img = document.createElement('img'); img.src = game.thumbnail; img.alt = ''; cover.replaceChildren(img); }
    else if (game.thumbnail) try {
      const file = await library.getFile(folder, `.gameportal/thumbnails/${game.id}.webp`);
      if (revision !== renderRevision) return;
      if (file.size <= 2 * 1024 * 1024) { const url = URL.createObjectURL(file); imageURLs.push(url); const img = document.createElement('img'); img.src = url; img.alt = ''; cover.replaceChildren(img); }
    } catch { /* A missing image does not make the game unavailable. */ }
    if (revision !== renderRevision) return;
    const body = document.createElement('div'); body.className = 'cardbody';
    const title = document.createElement('h2'); title.textContent = game.title;
    const type = document.createElement('p'); type.className = 'type'; type.textContent = game.developmentEnvironment || (game.kind === 'pyxapp' ? 'Pyxel' : 'Webゲーム');
    const tags = document.createElement('div'); tags.className = 'tags';
    for (const tag of game.tags) { const span = document.createElement('span'); span.className = 'tag'; span.textContent = tag; tags.append(span); }
    const buttons = document.createElement('div'); buttons.className = 'buttons';
    const play = document.createElement('button'); play.textContent = 'プレイ'; play.onclick = () => action(() => playGame(game));
    const edit = document.createElement('button'); edit.textContent = '編集'; edit.className = 'secondary'; edit.setAttribute('aria-label', game.title + 'を編集'); edit.dataset.edit = ''; edit.dataset.invalid = String(!!game.settingsError); edit.disabled = !editingEnabled || !!game.settingsError; edit.onclick = () => editGame(game);
    play.disabled = !!game.settingsError; if (game.settingsError) play.dataset.unavailable = 'true';
    buttons.append(play, edit); body.append(title, type, tags);
    if (game.settingsError) { const warning = document.createElement('p'); warning.className = 'hint'; warning.textContent = '設定の確認が必要です：' + game.settingsError; body.append(warning); }
    body.append(buttons); article.append(cover, body); $('#games').append(article);
  }
}
function editGame(game) {
  if (!editingEnabled || game.settingsError) return;
  editing = game; $('#editEnvironment').value = game.developmentEnvironment; $('#editSettingsPath').textContent = game.path + '.gameportal.json'; $('#editTitle').value = game.title; $('#editTags').value = game.tags.join(', '); $('#editImage').value = ''; $('#clearImage').checked = false; renderTagChoices(); $('#edit').showModal();
}
let tagControls = [];
function updateTagChoices() {
  const picked = new Set(library.tagsFrom($('#editTags').value));
  $('#tagCount').textContent = `選択中 ${picked.size} / 12（自由入力もできます）`;
  for (const [button, name] of tagControls) {
    const active = picked.has(name); button.setAttribute('aria-pressed', String(active));
    button.classList.toggle('active', active); button.disabled = !active && picked.size >= 12;
  }
}
function renderTagChoices() {
  const box = $('#tagCategories'); box.replaceChildren(); tagControls = [];
  const presets = [...tagPresets], known = new Set(presets.map(t => t.name));
  for (const name of new Set([...games.flatMap(g => g.tags), ...library.tagsFrom($('#editTags').value)])) {
    if (!known.has(name)) presets.push({ name, category: 'マイタグ' });
  }
  const selected = new Set(library.tagsFrom($('#editTags').value));
  for (const category of new Set(presets.map(t => t.category))) {
    const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = category;
    const choices = presets.filter(t => t.category === category); details.open = choices.some(t => selected.has(t.name)) || (!selected.size && category === 'ジャンル');
    const chips = document.createElement('div'); chips.className = 'tags';
    for (const { name } of choices) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'tag'; button.textContent = name;
      button.onclick = () => {
        const picked = new Set(library.tagsFrom($('#editTags').value));
        if (picked.has(name)) picked.delete(name); else if (picked.size < 12) picked.add(name);
        $('#editTags').value = [...picked].join(', '); updateTagChoices();
      };
      tagControls.push([button, name]); chips.append(button);
    }
    details.append(summary, chips); box.append(details);
  }
  updateTagChoices();
}
$('#editTags').addEventListener('input', updateTagChoices);
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
  if (flushing) { const success = await flushing; return success && pendingSave ? flushSave() : success; }
  flushing = (async () => {
    while (pendingSave) {
      const pending = pendingSave; pendingSave = null;
      try { await localState.writeLocalSave(pending.libraryId, pending.id, pending.data); }
      catch (error) {
        if (!pendingSave) pendingSave = pending;
        $('#playerStatus').textContent = 'このPCへセーブできません。画面を閉じずに保存先の空き容量を確認し、終了を再試行してください：' + error.message;
        return false;
      }
    }
    return true;
  })();
  try { return await flushing; } finally { flushing = null; }
}
function receiveSave(session, data) {
  if (activePlay !== session || !localState.validSave(data)) return;
  session.latest = data;
  pendingSave = { libraryId: session.libraryId, id: session.game.id, data }; clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 150);
}
function stopPlayer() {
  try { if (stopGame) stopGame(); } finally { stopGame = null; if (activePlay) activePlay.release(); activePlay = null; }
}
async function playGame(game) {
  if (game.settingsError) throw new Error(game.settingsError);
  if (!await flushSave()) return; stopPlayer();
  const session = { libraryId: localLibrary, game, release: await localState.acquirePlaySession(localLibrary, game.id) };
  activePlay = session;
  $('#playerTitle').textContent = game.title; $('#playerStatus').textContent = '読み込んでいます…'; $('#player').showModal();
  try {
    const file = await game.handle.getFile(); let options;
    const embedded = game.kind === 'html' ? library.embeddedPyxel(await file.text()) : null;
    $('#saveTools').hidden = game.kind === 'pyxapp' || !!embedded;
    if (game.kind === 'pyxapp' || embedded) {
      if (file.size > 50 * 1024 * 1024) throw new Error('PYXAPPは50MB以内にしてください。');
      const bytes = embedded ? Uint8Array.from(atob(embedded), c=>c.charCodeAt(0)) : new Uint8Array(await file.arrayBuffer()); library.validatePyxapp(bytes); let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      options = { kind: 'pyxapp', app: btoa(binary), runtime: JSON.parse($('#runtime').textContent) };
    } else {
      let files = game.kind === 'zip' ? await preview.unpackPrivateZip(await file.arrayBuffer()) : await library.readTree(game.folder);
      if (game.kind === 'html') files.set('index.html', files.get(game.entry));
      const saved = await localState.loadLocalSave(session.libraryId, game.id);
      options = { kind: game.kind, files, saved };
    }
    if (activePlay !== session) return;
    stopGame = player.startPlayer($('#frame'), options, preview, message => {
      if (activePlay !== session) return;
      if (message?.type === 'ready') $('#playerStatus').textContent = 'ゲームを表示しました。';
      if (message?.type === 'error' || message?.type === 'status') $('#playerStatus').textContent = String(message.message).slice(0, 500);
      if (message?.type === 'save') receiveSave(session, message.data);
    });
  } catch (e) { if (activePlay === session) { stopPlayer(); $('#playerStatus').textContent = e.message; } throw e; }
}
$('#settingsButton').onclick = () => $('#settings').showModal();
$('#chooseFolder').onclick = () => action(async () => {
  if (!window.showDirectoryPicker) throw new Error('フォルダーの読み書きに対応したGoogle Chromeを使用してください。');
  const handle = await window.showDirectoryPicker({ mode: editingEnabled ? 'readwrite' : 'read', id: 'game-portal-library' }); await connect(handle);
});
$('#reconnect').onclick = () => action(() => connect(remembered, true));
$('#refresh').onclick = () => action(refresh);
$('#search').oninput = () => render().catch(e => status(e.message));
$('#postButton').onclick = () => { if (editingEnabled && root) $('#post').showModal(); };
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => button.closest('dialog').close());
for (const id of ['postFiles', 'postDirectory']) $( '#' + id).onchange = event => action(async () => {
  if (!root || !editingEnabled) throw new Error('設定で追加・編集を有効にしてください。');
  const selected = [...event.target.files]; event.target.value = '';
  await library.postGame(root, selected, preview); $('#post').close(); await refresh();
});
$('#editForm').onsubmit = event => { event.preventDefault(); if (!event.target.reportValidity()) return; action(async () => {
  if (!editingEnabled) throw new Error('設定で追加・編集を有効にしてください。');
  let image = $('#clearImage').checked ? null : editing.thumbnail;
  const file = $('#editImage').files[0];
  const asDataURL = blob => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
  if (file) image = await asDataURL(await thumbnail(file));
  else if (image === true) image = await asDataURL(await library.getFile(root, `.gameportal/thumbnails/${editing.id}.webp`));
  await library.saveGameSettings(root, editing, { title: $('#editTitle').value, tags: library.tagsFrom($('#editTags').value), developmentEnvironment: $('#editEnvironment').value, thumbnail: image || null }); $('#edit').close(); await refresh();
}); };
$('#closePlayer').onclick = async () => { if (!await flushSave()) return; stopPlayer(); $('#player').close(); };
$('#player').addEventListener('cancel', event => { event.preventDefault(); $('#closePlayer').click(); });
$('#fullscreen').onclick = () => $('#frame').requestFullscreen().catch(e => { $('#playerStatus').textContent = e.message; });
if (!window.showDirectoryPicker) status('このブラウザーはフォルダーへの保存に対応していません。PC版Google Chromeを使用してください。');
else cacheHandle().then(async handle => {
  if (!handle) return; remembered = handle; $('#settingFolder').textContent = handle.name;
  if (await handle.queryPermission({ mode: editingEnabled ? 'readwrite' : 'read' }) === 'granted') await action(() => connect(handle));
  else { $('#reconnect').hidden = false; status('設定の「再接続する」で保管フォルダーへのアクセスを許可してください。'); }
}).catch(() => {});

$('#enableEditing').onchange = () => action(async () => {
  const requested = $('#enableEditing').checked;
  if (requested && root && await root.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('追加・編集には保管フォルダーの書き込み許可が必要です。');
  editingEnabled = requested;
  try { localStorage.setItem('game-portal.offline-editing', String(editingEnabled)); } catch { /* The setting applies for this session. */ }
  writeControls();
});
window.addEventListener('beforeunload', event => { if (pendingSave || flushing) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
writeControls();

$('#exportSave').onclick = () => action(async () => {
  const session = activePlay; if (!session) throw new Error('ゲームを起動してから操作してください。');
  const data = session.latest || await localState.loadLocalSave(session.libraryId, session.game.id);
  const blob = new Blob([JSON.stringify({ schema: 1, gameId: session.game.id, data }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = 'game-save-' + session.game.id + '.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('#importSaveButton').onclick = () => $('#importSave').click();
$('#importSave').onchange = event => action(async () => {
  const session = activePlay, file = event.target.files[0]; event.target.value = '';
  if (!session || !file) return;
  if (file.size > 600000) throw new Error('セーブは600KB以内のJSONを選択してください。');
  const parsed = JSON.parse(await file.text()); let data = parsed;
  if (parsed?.schema === 1) {
    if (parsed.gameId !== session.game.id) throw new Error('別のゲームのセーブです。');
    data = parsed.data;
  }
  if (!localState.validSave(data)) throw new Error('セーブの形式を確認してください。');
  if (!confirm('このPCの現在のセーブを、選択したファイルで置き換えてゲームを再起動しますか？')) return;
  if (!await flushSave() || activePlay !== session) return;
  stopPlayer(); await localState.writeLocalSave(session.libraryId, session.game.id, data); await playGame(session.game);
});
