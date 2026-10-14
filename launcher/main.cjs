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
async function state() { return { folder: root || '', games: root ? (await library.listGames(root)).map(({ id, title, kind }) => ({ id, title, kind })) : [] }; }
async function play(id) {
  if (!root) throw new Error('no_library');
  const game = (await library.listGames(root)).find(g => g.id === id);
  if (!game) throw new Error('not_found');
  const key = `${root}:${id}`;
  if (playing.has(key)) { playing.get(key).focus(); return; }
  const savedRoot = root;
  const prepared = await library.prepareGame(savedRoot, game);
  if (game.kind === 'exe') {
    if (process.platform !== 'win32') throw new Error('windows_only');
    await new Promise((resolve, reject) => {
      const child = require('node:child_process').spawn(prepared.filename, [], { cwd: path.dirname(prepared.filename), shell: false, detached: true, stdio: 'ignore' });
      child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
    });
    return;
  }
  const saved = await library.storageFolder(savedRoot, id);
  // Saves and browser data stay beside this game's files in the offline folder.
  const gameSession = session.fromPath(path.join(saved, 'browser-data'));
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
      const name = decodeURIComponent(url.pathname.slice(1)) || prepared.entry;
      const body = await library.readGameFile(savedRoot, prepared, name);
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
  await win.loadURL(origin + '/' + encodeURIComponent(prepared.entry));
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
    const result = await dialog.showOpenDialog(mainWindow, { title: 'ゲームが入っているフォルダーを選択', properties: ['openDirectory'] });
    if (result.canceled) return state();
    const selected = result.filePaths[0];
    const next = await library.openLibrary(selected);
    await fs.writeFile(settingsPath, JSON.stringify({ folder: selected }));
    root = next; return state();
  });
  handle('library:play', play);
  await mainWindow.loadURL(uiURL);
});
app.on('window-all-closed', () => app.quit());
