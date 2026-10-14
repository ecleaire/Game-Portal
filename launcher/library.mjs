import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { unpackPrivateZip } from '../assets/private-preview.js';

export function safeResource(resource) {
  if (typeof resource !== 'string' || !resource || resource.length > 1000) throw new Error('invalid_path');
  const parts = resource.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[\\:\x00-\x1f<>"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))) throw new Error('invalid_path');
  return parts.join('/');
}
export async function openLibrary(folder) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder) || /^\\\\/.test(folder)) throw new Error('local_folder_required');
  const root = await fs.realpath(folder);
  if (!(await fs.stat(root)).isDirectory()) throw new Error('invalid_folder');
  return root;
}
function gameId(relative) {
  const h = createHash('sha256').update(relative).digest('hex').slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export async function listGames(root) {
  const games = []; let visited = 0;
  const add = (relative, title, kind) => games.push({ id: gameId(relative), title, relative, kind });
  async function walk(relative = '', depth = 0) {
    const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
    visited += entries.length;
    if (visited > 10000 || games.length > 1000) throw new Error('folder_too_large');
    const files = entries.filter(e => e.isFile() && !e.name.startsWith('.'));
    const html = files.filter(e => /\.html?$/i.test(e.name));
    const entry = html.find(e => /^index\.html?$/i.test(e.name)) || (html.length === 1 ? html[0] : null);
    if (depth > 0 && entry) add(path.join(relative, entry.name), path.basename(relative), 'html');
    for (const f of files) {
      const ext = path.extname(f.name).toLowerCase();
      if ((depth === 0 || !entry) && ['.html', '.htm'].includes(ext)) add(path.join(relative, f.name), path.basename(f.name, ext), 'html');
      if (['.zip', '.exe'].includes(ext)) add(path.join(relative, f.name), path.basename(f.name, ext), ext.slice(1));
    }
    if (depth < 3 && !(depth > 0 && (entry || files.some(e => /\.exe$/i.test(e.name))))) {
      for (const e of entries) if (e.isDirectory() && !e.name.startsWith('.')) await walk(path.join(relative, e.name), depth + 1);
    }
  }
  await walk(); return games.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
}
async function inside(root, filename) {
  const resolved = await fs.realpath(filename), relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('invalid_path');
  return resolved;
}
export async function storageFolder(root, id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('invalid_game');
  let current = root;
  for (const part of ['.gameportal-data', id]) {
    current = path.join(current, part); await fs.mkdir(current, { recursive: true });
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('invalid_path');
  }
  return current;
}
export async function prepareGame(root, game) {
  const filename = await inside(root, path.join(root, game.relative));
  if (game.kind === 'exe') return { filename };
  if (game.kind === 'html') return { base: path.dirname(filename), entry: path.basename(filename) };
  if (game.kind !== 'zip') throw new Error('unsupported_game');
  if ((await fs.stat(filename)).size > 50 * 1024 * 1024) throw new Error('game_too_large');
  const bytes = await fs.readFile(filename), hash = createHash('sha256').update(bytes).digest('hex');
  const saved = await storageFolder(root, game.id), content = path.join(saved, 'content');
  try {
    if (await fs.readFile(path.join(saved, 'archive-hash'), 'utf8') === hash) {
      await inside(root, path.join(content, 'index.html')); return { base: content, entry: 'index.html' };
    }
  } catch { /* Unpack on first launch or when the archive changes. */ }
  const files = await unpackPrivateZip(bytes), names = new Set();
  for (const name of files.keys()) {
    safeResource(name); if (names.has(name.toLowerCase())) throw new Error('duplicate_path'); names.add(name.toLowerCase());
  }
  const staging = path.join(saved, 'extract-' + randomUUID()); await fs.mkdir(staging);
  try {
    for (const [name, data] of files) {
      const target = path.join(staging, safeResource(name)); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, data, { flag: 'wx' });
    }
    if (await fs.lstat(content).then(s => s.isSymbolicLink(), () => false)) throw new Error('invalid_path');
    await fs.rm(content, { recursive: true, force: true }); await fs.rename(staging, content);
    await fs.writeFile(path.join(saved, 'archive-hash'), hash);
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
  return { base: content, entry: 'index.html' };
}
export async function readGameFile(root, prepared, resource) {
  const target = await inside(root, path.join(prepared.base, safeResource(resource)));
  const relative = path.relative(prepared.base, target);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !(await fs.stat(target)).isFile()) throw new Error('invalid_path');
  return fs.readFile(target);
}
