import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { unpackPrivateZip } from '../assets/private-preview.js';

const idPattern = /^[a-f0-9-]{36}$/;
const marker = 'game-portal-offline-library-v1';
export function safeResource(resource) {
  if (typeof resource !== 'string' || !resource || resource.length > 1000) throw new Error('invalid_path');
  const parts = resource.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[\\:\x00-\x1f<>"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))) throw new Error('invalid_path');
  return parts.join('/');
}
export async function openLibrary(folder) {
  if (!path.isAbsolute(folder) || /^\\\\/.test(folder)) throw new Error('local_folder_required');
  const parent = await fs.realpath(folder);
  const root = path.join(parent, 'GAMEPORTAL-library');
  await fs.mkdir(root, { recursive: true });
  if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('invalid_library');
  const markerPath = path.join(root, '.gameportal-library');
  try { await fs.writeFile(markerPath, marker, { flag: 'wx' }); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
  if (await fs.readFile(markerPath, 'utf8') !== marker) throw new Error('invalid_library');
  return root;
}
async function gameDirectory(root, id) {
  if (!idPattern.test(id)) throw new Error('invalid_game');
  if (await fs.readFile(path.join(root, '.gameportal-library'), 'utf8') !== marker) throw new Error('invalid_library');
  const dir = path.join(root, id);
  if ((await fs.lstat(dir)).isSymbolicLink()) throw new Error('invalid_game');
  return dir;
}
export async function listGames(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const games = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !idPattern.test(entry.name)) continue;
    try {
      const dir = await gameDirectory(root, entry.name);
      const data = JSON.parse(await fs.readFile(path.join(dir, 'game.json'), 'utf8'));
      if (data.id !== entry.name || typeof data.title !== 'string' || typeof data.createdAt !== 'string') continue;
      games.push({ id: data.id, title: data.title.slice(0, 120), createdAt: data.createdAt });
    } catch { /* Incomplete or unrelated folders are never offered as games. */ }
  }
  return games.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function importGame(root, filename) {
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.size > 50 * 1024 * 1024) throw new Error('game_too_large');
  const bytes = await fs.readFile(filename);
  const ext = path.extname(filename).toLowerCase();
  let files;
  if (ext === '.zip') files = await unpackPrivateZip(bytes);
  else if (ext === '.html' || ext === '.htm') files = new Map([['index.html', bytes]]);
  else throw new Error('unsupported_game');
  const names = new Set();
  for (const name of files.keys()) {
    safeResource(name);
    const normalized = name.toLowerCase();
    if (names.has(normalized)) throw new Error('duplicate_path');
    names.add(normalized);
  }
  const id = randomUUID();
  const dir = path.join(root, id);
  const game = { id, title: path.basename(filename, ext).slice(0, 120), createdAt: new Date().toISOString() };
  // The manifest is written last so failed imports cannot appear in the library.
  await fs.mkdir(dir);
  try {
    for (const [name, contents] of files) {
      const target = path.join(dir, 'content', safeResource(name));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, contents, { flag: 'wx' });
    }
    await fs.writeFile(path.join(dir, 'game.json'), JSON.stringify(game), { flag: 'wx' });
    return game;
  } catch (error) { await fs.rm(dir, { recursive: true, force: true }); throw error; }
}
export async function readGameFile(root, id, resource) {
  const dir = await gameDirectory(root, id);
  const content = path.join(dir, 'content');
  const target = await fs.realpath(path.join(content, safeResource(resource)));
  const relative = path.relative(content, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('invalid_path');
  if (!(await fs.stat(target)).isFile()) throw new Error('invalid_path');
  return fs.readFile(target);
}
export async function removeGame(root, id) {
  const dir = await gameDirectory(root, id);
  await fs.rm(dir, { recursive: true });
}
