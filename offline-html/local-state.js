// Folder handles and saves belong to this Chrome profile, never to the NAS.
let database;
function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('game-portal-offline-folder-v1', 2);
    request.onupgradeneeded = () => {
      for (const name of ['settings', 'libraries', 'saves']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('以前のランチャーを閉じてから再読み込みしてください。'));
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); database = null; }; resolve(db); };
  }).catch(error => { database = null; throw error; });
  return database;
}
async function access(name, mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode); let result;
    const request = operation(tx.objectStore(name)); request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => resolve(result); tx.onabort = () => reject(tx.error || new Error('このPCへ保存できませんでした。')); tx.onerror = () => {};
  });
}
export async function cacheHandle(value) {
  return access('settings', value ? 'readwrite' : 'readonly', store => value ? store.put(value, 'folder') : store.get('folder'));
}
export async function localLibraryId(handle) {
  const find = async () => {
    // Deserialize handles individually: bulk handle cloning can fail across renderers.
    const keys = await access('libraries', 'readonly', store => store.getAllKeys());
    for (const key of keys) {
      const item = await access('libraries', 'readonly', store => store.get(key));
      if (item && await handle.isSameEntry(item.handle)) return item.id;
    }
    const id = crypto.randomUUID(); await access('libraries', 'readwrite', store => store.put({ id, handle }, id)); return id;
  };
  return navigator.locks.request('game-portal-library-registry', find);
}
export function validSave(data) {
  return data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length <= 1000 &&
    Object.values(data).every(v => typeof v === 'string') && new TextEncoder().encode(JSON.stringify(data)).length <= 500000;
}
export async function loadLocalSave(libraryId, gameId) {
  const value = await access('saves', 'readonly', store => store.get([libraryId, gameId]));
  if (value === undefined) return {};
  if (!validSave(value)) throw new Error('このPCのセーブ形式を確認してください。');
  return value;
}
export async function writeLocalSave(libraryId, gameId, data) {
  if (!validSave(data)) throw new Error('セーブのサイズ・形式を確認してください。');
  await access('saves', 'readwrite', store => store.put(data, [libraryId, gameId]));
}
export async function acquirePlaySession(libraryId, gameId) {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  return new Promise((resolve, reject) => {
    navigator.locks.request(`game-portal-play-${libraryId}-${gameId}`, { ifAvailable: true }, async lock => {
      if (!lock) { reject(new Error('このゲームは別のタブで起動中です。終了してから開いてください。')); return; }
      resolve(release); await held;
    }).catch(reject);
  });
}
