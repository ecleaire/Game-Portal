const MAX_FILES = 500, MAX_BYTES = 200 * 1024 * 1024;
export function safePath(value) {
  if (typeof value !== 'string' || !value || value.length > 1000 || value.split('/').some(p => !p || p === '.' || p === '..' || /[\\:\x00-\x1f<>"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p))) throw new Error('安全に扱えないファイル名です。');
  return value.split('/');
}
export async function getFile(root, path) {
  const parts = safePath(path); let folder = root;
  for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part);
  return (await folder.getFileHandle(parts.at(-1))).getFile();
}
export async function writeFile(root, path, content) {
  const parts = safePath(path); let folder = root;
  for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part, { create: true });
  const handle = await folder.getFileHandle(parts.at(-1), { create: true });
  const writer = await handle.createWritable({ mode: 'exclusive' });
  try { await writer.write(content); await writer.close(); }
  catch (error) { await writer.abort().catch(() => {}); throw error; }
}
export async function loadMetadata(root) {
  try {
    const file = await getFile(root, '.gameportal/library.json');
    if (file.size > 2 * 1024 * 1024) throw new Error('管理情報のサイズが大きすぎます。');
    const data = JSON.parse(await file.text());
    if (data.schema !== 1 || !data.games || Array.isArray(data.games) || typeof data.games !== 'object') throw new Error('管理情報の形式を確認してください。');
    return data;
  } catch (e) { if (e.name === 'NotFoundError') return { schema: 1, revision: null, games: {} }; throw e; }
}
export async function saveMetadata(root, data) {
  const current = await loadMetadata(root);
  if (current.revision !== data.revision) throw new Error('別の画面で管理情報が更新されています。「再読み込み」してから編集してください。');
  const next = { ...data, revision: crypto.randomUUID() };
  await writeFile(root, '.gameportal/library.json', JSON.stringify(next, null, 2));
  data.revision = next.revision;
}
export function tagsFrom(text) {
  return [...new Set(String(text).split(/[,、\n]/).map(s => s.trim()).filter(Boolean))].slice(0, 12).map(s => s.slice(0, 32));
}
export async function loadGameSettings(root, path) {
  safePath(path);
  try {
    const file = await getFile(root, path + '.gameportal.json');
    if (file.size > 2 * 1024 * 1024) throw new Error('ゲーム設定のサイズが大きすぎます。');
    const text = await file.text(), data = JSON.parse(text);
    if (data.schema !== 1 || typeof data.id !== 'string' || !/^[a-f0-9]{32}$/.test(data.id) ||
      typeof data.title !== 'string' || !data.title.trim() || data.title.length > 120 ||
      !Array.isArray(data.tags) || data.tags.length > 12 || data.tags.some(t => typeof t !== 'string' || t.length > 32) ||
      typeof data.developmentEnvironment !== 'string' || data.developmentEnvironment.length > 120 ||
      (data.thumbnail !== null && (typeof data.thumbnail !== 'string' || !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(data.thumbnail)))) {
      throw new Error('ゲーム設定の形式を確認してください：' + path + '.gameportal.json');
    }
    return { data, text };
  } catch (error) { if (error.name === 'NotFoundError') return { data: null, text: null }; throw error; }
}
export async function saveGameSettings(root, game, values) {
  const current = await loadGameSettings(root, game.path);
  if (current.text !== game.settingsText) throw new Error('このゲームの設定が更新されています。「再読み込み」してから編集してください。');
  const next = { ...current.data, schema: 1, id: game.id, title: values.title.trim(),
    tags: tagsFrom(values.tags.join(',')), developmentEnvironment: values.developmentEnvironment.trim(),
    thumbnail: values.thumbnail, updatedAt: new Date().toISOString() };
  if (!next.title || next.title.length > 120 || next.developmentEnvironment.length > 120 ||
    (next.thumbnail !== null && (typeof next.thumbnail !== 'string' || !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(next.thumbnail)))) throw new Error('ゲーム設定の入力内容を確認してください。');
  const text = JSON.stringify(next, null, 2) + '\n';
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) throw new Error('ゲーム設定のサイズが大きすぎます。');
  const parts = safePath(game.path + '.gameportal.json'); let folder = root;
  for (const part of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(part);
  const handle = await folder.getFileHandle(parts.at(-1), { create: true });
  let writer;
  try { writer = await handle.createWritable({ mode: 'exclusive' }); }
  catch (error) { if (error.name === 'NoModificationAllowedError') throw new Error('このゲームの設定は別の画面で保存中です。少し待って再読み込みしてください。'); throw error; }
  try {
    const live = await handle.getFile(), actual = await live.text();
    if ((current.text === null ? actual !== '' : actual !== current.text)) throw new Error('このゲームの設定が更新されています。「再読み込み」してから編集してください。');
    const history = { schema: 1, gamePath: game.path, before: current.text, after: text, savedAt: new Date().toISOString() };
    await writeFile(root, `.gameportal/history/${game.id}/${crypto.randomUUID()}.json`, JSON.stringify(history, null, 2));
    await writer.write(text); await writer.close();
  } catch (error) { await writer.abort().catch(() => {}); throw error; }
  if (await (await handle.getFile()).text() !== text) throw new Error('保存後に設定の変更を検出しました。再読み込みしてください。編集内容は .gameportal/history に残っています。');
}
export function validatePyxapp(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22 || bytes.length > 50 * 1024 * 1024) throw new Error('PYXAPPは50MB以内にしてください。');
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) if (view.getUint32(at,true) === 0x06054b50) { end = at; break; }
  if (end < 0 || view.getUint16(end+4,true) || view.getUint16(end+6,true)) throw new Error('PyxelでpackageしたPYXAPPを選択してください。');
  const count = view.getUint16(end+10,true), size = view.getUint32(end+12,true), start = view.getUint32(end+16,true);
  if (!count || count > MAX_FILES || start + size > end) throw new Error('PYXAPPの構造・ファイル数を確認してください。');
  let at = start, total = 0, startup = false; const names = new Set();
  for (let i = 0; i < count; i++) {
    if (at+46 > end || view.getUint32(at,true)!==0x02014b50) throw new Error('PYXAPPが壊れています。');
    const length=view.getUint16(at+28,true), extra=view.getUint16(at+30,true), comment=view.getUint16(at+32,true);
    const method=view.getUint16(at+10,true), flags=view.getUint16(at+8,true);
    if (at+46+length+extra+comment>end || (flags&1) || ![0,8].includes(method)) throw new Error('対応していないPYXAPPです。');
    const name=new TextDecoder().decode(bytes.subarray(at+46,at+46+length)); safePath(name.replace(/\/$/,''));
    const normalized=name.toLowerCase(); if(names.has(normalized))throw new Error('PYXAPP内のファイル名が重複しています。'); names.add(normalized);
    total+=view.getUint32(at+24,true); if(total>MAX_BYTES)throw new Error('PYXAPPの展開後サイズは200MB以内にしてください。');
    if(name.endsWith('/.pyxapp_startup_script'))startup=true;
    at+=46+length+extra+comment;
  }
  if (!startup || at !== start+size) throw new Error('PYXAPPの起動情報がありません。Pyxelでpackageしてください。');
}
export function embeddedPyxel(html) {
  if (!/pyxel\.js/i.test(html) || !/launchPyxel|pyxel-play/i.test(html)) return null;
  const match = html.match(/base64\s*[:=]\s*(["'])([A-Za-z0-9+/=]+)\1/);
  return match ? match[2] : null;
}
export async function gameId(path) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path)))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
export async function scan(root, metadata) {
  const games = []; let visited = 0;
  async function add(path, title, kind, handle, folder, entry) {
    let settings, settingsError = '';
    try { settings = await loadGameSettings(root, path); }
    catch (error) { settings = { data: null, text: null }; settingsError = error.message; }
    const saved = settings.data || (Object.hasOwn(metadata.games, path) ? metadata.games[path] : {});
    games.push({ id: settings.data?.id || await gameId(path), settingsText: settings.text, settingsError, path, kind, handle, folder, entry, title: typeof saved?.title === 'string' && saved.title.trim() ? saved.title.slice(0, 120) : title,
      tags: Array.isArray(saved?.tags) ? tagsFrom(saved.tags.filter(t => typeof t === 'string').join(',')) : [],
      developmentEnvironment: settings.data?.developmentEnvironment || (kind === 'pyxapp' ? 'Pyxel' : ''),
      thumbnail: settings.data ? saved.thumbnail : saved?.thumbnail === true });
  }
  async function walk(folder, prefix = '', depth = 0) {
    try { await folder.getFileHandle('.gameportal-uploading'); return; } catch (error) { if (error.name !== 'NotFoundError') throw error; }
    const entries = []; for await (const entry of folder.values()) { if (entry.name === '.gameportal-uploading') return; if (++visited > 10000) throw new Error('ファイルが多すぎます。ゲーム専用のフォルダーを選択してください。'); if (!entry.name.startsWith('.')) entries.push(entry); }
    const html = entries.filter(e => e.kind === 'file' && /\.html?$/i.test(e.name));
    const entry = html.find(e => /^index\.html?$/i.test(e.name)) || (html.length === 1 ? html[0] : null);
    if (depth > 0 && entry) { await add(prefix + entry.name, folder.name, 'html', entry, folder, entry.name); return; }
    for (const file of entries.filter(e => e.kind === 'file')) {
      const ext = file.name.split('.').at(-1).toLowerCase();
      if (['html', 'htm', 'zip', 'pyxapp'].includes(ext) && !/^GAME-PORTAL\.html$/i.test(file.name)) await add(prefix + file.name, file.name.replace(/\.[^.]+$/, ''), ext === 'htm' ? 'html' : ext, file, folder, file.name);
    }
    if (depth < 3) for (const dir of entries.filter(e => e.kind === 'directory')) await walk(dir, prefix + dir.name + '/', depth + 1);
  }
  await walk(root);
  const ids = new Map(); for (const game of games) ids.set(game.id, (ids.get(game.id) || 0) + 1);
  for (const game of games) if (ids.get(game.id) > 1) { game.identityConflict = true; game.settingsError = '同じ作品IDのゲームが複数あります。別作品として追加する場合は「投稿」を使用してください。'; }
  return games.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
}
export async function readTree(folder) {
  const files = new Map(); let bytes = 0;
  async function walk(dir, prefix = '') {
    for await (const entry of dir.values()) {
      if (entry.name.startsWith('.')) continue;
      const path = prefix + entry.name; safePath(path);
      if (entry.kind === 'directory') await walk(entry, path + '/');
      else {
        if (/\.(zip|pyxapp|exe)$/i.test(path) || /\.gameportal\.json$/i.test(path) || /^GAME-PORTAL\.html$/i.test(entry.name)) continue;
        const file = await entry.getFile(); bytes += file.size;
        if (files.size >= MAX_FILES || bytes > MAX_BYTES) throw new Error('ゲームは500ファイル・展開後200MB以内にしてください。');
        files.set(path, new Uint8Array(await file.arrayBuffer()));
      }
    }
  }
  await walk(folder); return files;
}
export async function postGame(root, files, packageTools) {
  files = [...files];
  if (!files.length || files.length > MAX_FILES || files.reduce((n, f) => n + f.size, 0) > MAX_BYTES) throw new Error('投稿は500ファイル・200MB以内にしてください。');
  const single = files.length === 1 && !files[0].webkitRelativePath;
  if (single && !/\.(html?|zip|pyxapp)$/i.test(files[0].name)) throw new Error('HTML・ZIP・PYXAPPを選択してください。');
  const paths = files.map(f => f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(1).join('/') : f.name);
  paths.forEach(safePath);
  if (!single && !packageTools.webArchiveLayout(paths)) throw new Error('index.html、またはHTMLが1件のWeb書き出しフォルダーを選んでください。');
  if (single && /\.zip$/i.test(files[0].name)) await packageTools.unpackPrivateZip(await files[0].arrayBuffer());
  if (single && /\.pyxapp$/i.test(files[0].name)) validatePyxapp(await files[0].arrayBuffer());
  const title = (single ? files[0].name.replace(/\.[^.]+$/, '') : files[0].webkitRelativePath.split('/')[0]).slice(0, 120);
  const name = 'game-' + crypto.randomUUID();
  const dir = await root.getDirectoryHandle(name, { create: true });
  try {
    await writeFile(dir, '.gameportal-uploading', '投稿準備中');
    for (let i = 0; i < files.length; i++) await writeFile(dir, paths[i], files[i]);
    const layout = single ? null : packageTools.webArchiveLayout(paths);
    const entry = single ? paths[0] : layout.root + layout.entry;
    const relative = name + '/' + entry;
    await saveGameSettings(root, { path: relative, id: crypto.randomUUID().replaceAll('-', ''), settingsText: null },
      { title, tags: [], thumbnail: null, developmentEnvironment: /\.pyxapp$/i.test(entry) ? 'Pyxel' : '' });
    await dir.removeEntry('.gameportal-uploading');
    return relative;
  } catch (e) { await root.removeEntry(name, { recursive: true }).catch(() => {}); throw e; }
}
