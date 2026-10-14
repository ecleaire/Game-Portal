import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { deflateRawSync } from 'node:zlib';
import { openLibrary, listGames, importGame, readGameFile, removeGame, safeResource } from '../launcher/library.mjs';

function archive(entries) {
  const locals = [], central = []; let offset = 0;
  for (const [name, text] of entries) {
    const n = Buffer.from(name), bytes = Buffer.from(text), data = deflateRawSync(bytes);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20, 4); l.writeUInt16LE(8, 8); l.writeUInt32LE(data.length, 18); l.writeUInt32LE(bytes.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(bytes.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(l, n, data); central.push(c, n); offset += l.length + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
test('offline folder persists imported HTML and ZIP assets across library reopen', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'portal-launcher-')); t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const root = await openLibrary(folder);
  const html = path.join(folder, 'テストゲーム.html'); await fs.writeFile(html, '<h1>offline</h1>');
  const game = await importGame(root, html);
  assert.equal(game.title, 'テストゲーム');
  assert.equal((await readGameFile(root, game.id, 'index.html')).toString(), '<h1>offline</h1>');
  const zip = path.join(folder, 'Godot.zip'); await fs.writeFile(zip, archive([['export/jump.html', '<script src="jump.js"></script>'], ['export/jump.js', 'window.loaded=true'], ['export/audio/a.ogg', 'sound']]));
  const packaged = await importGame(root, zip);
  assert.equal((await readGameFile(root, packaged.id, 'jump.js')).toString(), 'window.loaded=true');
  assert.equal((await readGameFile(root, packaged.id, 'index.html')).toString(), '<script src="jump.js"></script>');
  assert.equal((await readGameFile(root, packaged.id, 'audio/a.ogg')).toString(), 'sound');
  assert.equal((await listGames(await openLibrary(folder))).length, 2);
  await removeGame(root, game.id); assert.equal((await listGames(root)).length, 1);
  assert.equal((await fs.readFile(html)).toString(), '<h1>offline</h1>');
});
test('imports reject Windows filename collisions, traversal, invalid archives and symlink escapes', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'portal-launcher-')); t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const root = await openLibrary(folder);
  for (const entries of [[['index.html', 'x'], ['../escape', 'x']], [['index.html', 'x'], ['a.js', 'a'], ['A.js', 'b']], [['index.html', 'x'], ['CON.txt', 'x']]]) {
    const zip = path.join(folder, 'bad.zip'); await fs.writeFile(zip, archive(entries));
    await assert.rejects(importGame(root, zip)); assert.deepEqual(await listGames(root), []);
  }
  for (const name of ['../x', '/x', 'C:/x', 'x\\y', 'a/../x', 'con', 'a.', 'a ', 'x:ads']) assert.throws(() => safeResource(name));
  const html = path.join(folder, 'test.html'); await fs.writeFile(html, 'ok');
  const game = await importGame(root, html);
  await assert.rejects(readGameFile(root, game.id, '../game.json'));
  await assert.rejects(removeGame(root, '../'));
  if (process.platform !== 'win32') {
    await fs.symlink(html, path.join(root, game.id, 'content', 'external.html'));
    await assert.rejects(readGameFile(root, game.id, 'external.html'));
  }
});
test('switching offline folders preserves the original library and unrelated files', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'portal-launcher-')); t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const other = path.join(folder, 'other'); await fs.mkdir(other);
  const source = path.join(folder, 'source.html'); await fs.writeFile(source, 'game');
  const first = await openLibrary(folder); await importGame(first, source);
  const second = await openLibrary(other); assert.deepEqual(await listGames(second), []);
  assert.equal((await listGames(await openLibrary(folder))).length, 1);
  await fs.writeFile(path.join(second, '.gameportal-library'), 'another app');
  await assert.rejects(openLibrary(other));
});
