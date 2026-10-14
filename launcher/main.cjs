const { app, BrowserWindow, dialog, ipcMain, protocol, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([{ scheme: 'gameportal', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
let mainWindow, library, root, settingsPath;
const playing = new Map();
const uiURL = pathToFileURL(path.join(__dirname, 'index.html')).href;
const mime = { html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', wasm: 'application/wasm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', woff: 'font/woff', woff2: 'font/woff2', mp4: 'video/mp4' };
function trusted(event) {
  if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || event.senderFrame.url !== uiURL) throw new Error('forbidden');
}
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    trusted(event);
    try { return { ok: true, value: await fn(...args) }; }
    catch (error) { console.error('Launcher operation:', name, error.code || error.message); return { ok: false, error: '操作できませんでした。保存先の接続・空き容量とゲームファイルを確認してください。' }; }
  });
}
async function state() { return { folder: root ? path.dirname(root) : '', games: root ? await library.listGames(root) : [] }; }
async function play(id) {
  if (!root) throw new Error('no_library');
  const game = (await library.listGames(root)).find(g => g.id === id);
  if (!game) throw new Error('not_found');
  const key = `${root}:${id}`;
  if (playing.has(key)) { playing.get(key).focus(); return; }
  const savedRoot = root;
  // Saves and browser data stay beside this game's files in the offline folder.
  const gameSession = session.fromPath(path.join(savedRoot, id, 'browser-data'));
  const origin = `gameportal://${id}`;
  gameSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  gameSession.setPermissionCheckHandler(() => false);
  gameSession.on('will-download', event => event.preventDefault());
  gameSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    callback({ cancel: !((url.protocol === 'gameportal:' && url.hostname === id) || ['blob:', 'data:'].includes(url.protocol)) });
  });
  await gameSession.protocol.handle('gameportal', async request => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== id || !['GET', 'HEAD'].includes(request.method)) return new Response('', { status: 403 });
      const name = decodeURIComponent(url.pathname.slice(1)) || 'index.html';
      const body = await library.readGameFile(savedRoot, id, name);
      return new Response(request.method === 'HEAD' ? null : body, { headers: {
        'Content-Type': mime[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream',
        'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data:; style-src 'self' 'unsafe-inline'; connect-src 'self' blob: data:; object-src 'none'; frame-src 'none'; base-uri 'self'; form-action 'none'",
      } });
    } catch { return new Response('File not found', { status: 404 }); }
  });
  const win = new BrowserWindow({ title: game.title, width: 1100, height: 760, backgroundColor: '#111827', webPreferences: { session: gameSession, sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true, webviewTag: false, navigateOnDragDrop: false } });
  playing.set(key, win);
  win.removeMenu(); win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, target) => { if (!target.startsWith(origin + '/')) event.preventDefault(); });
  win.webContents.on('will-redirect', (event, target) => { if (!target.startsWith(origin + '/')) event.preventDefault(); });
  win.on('close', () => gameSession.flushStorageData());
  win.on('closed', () => { playing.delete(key); gameSession.protocol.unhandle('gameportal'); });
  await win.loadURL(origin + '/index.html');
}
app.whenReady().then(async () => {
  library = await import('./library.mjs');
  settingsPath = path.join(app.getPath('userData'), 'launcher-settings.json');
  try { root = await library.openLibrary(JSON.parse(await fs.readFile(settingsPath, 'utf8')).folder); }
  catch { root = null; }
  mainWindow = new BrowserWindow({ title: 'GAME PORTAL — オフラインランチャー', width: 1160, height: 800, minWidth: 620, minHeight: 480, backgroundColor: '#102022', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, navigateOnDragDrop: false } });
  mainWindow.removeMenu();
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  mainWindow.webContents.session.on('will-download', event => event.preventDefault());
  mainWindow.webContents.session.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !details.url.startsWith(pathToFileURL(__dirname + path.sep).href) }));
  handle('library:state', state);
  handle('library:folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'ゲームを保管するオフラインフォルダーを選択', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return state();
    const selected = result.filePaths[0];
    const next = await library.openLibrary(selected);
    await fs.writeFile(settingsPath, JSON.stringify({ folder: selected }));
    root = next; return state();
  });
  handle('library:import', async () => {
    if (!root) throw new Error('no_library');
    const result = await dialog.showOpenDialog(mainWindow, { title: 'ゲームを取り込む', properties: ['openFile'], filters: [{ name: 'Webゲーム（ZIP / HTML）', extensions: ['zip', 'html', 'htm'] }] });
    if (!result.canceled) await library.importGame(root, result.filePaths[0]);
    return state();
  });
  handle('library:play', play);
  handle('library:remove', async id => {
    const game = (await library.listGames(root)).find(g => g.id === id);
    if (!game) throw new Error('not_found');
    if (playing.has(`${root}:${id}`)) throw new Error('game_running');
    const result = await dialog.showMessageBox(mainWindow, { type: 'warning', title: 'ゲームを削除', message: `「${game.title}」をこのフォルダーから削除しますか？`, detail: '取り込む前の元ファイルは削除しません。この操作は元に戻せません。', buttons: ['キャンセル', '削除する'], defaultId: 0, cancelId: 0, noLink: true });
    if (result.response === 1) await library.removeGame(root, id);
    return state();
  });
  await mainWindow.loadURL(uiURL);
});
app.on('window-all-closed', () => app.quit());
