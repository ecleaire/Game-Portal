import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openLibrary, listGames, prepareGame, readGameFile, safeResource } from '../launcher/library.mjs';
import { archive } from './launcher/zip-fixture.mjs';
async function fixture(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'portal-launcher-')); t.after(() => fs.rm(folder, { recursive: true, force: true, maxRetries: 10 })); return fs.realpath(folder);
}
test('selected folder discovers existing HTML, Web export folders, ZIP and EXE without copying', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'Scratch.html'), '<h1>game</h1>');
  await fs.writeFile(path.join(root, 'Native.exe'), 'fixture-only');
  const godot = path.join(root, 'Godot'); await fs.mkdir(godot); await fs.mkdir(path.join(godot, 'assets'));
  await fs.writeFile(path.join(godot, 'jump.html'), '<script src="jump.js"></script>'); await fs.writeFile(path.join(godot, 'jump.js'), 'game');
  await fs.writeFile(path.join(root, 'Packed.zip'), archive([['web/index.html', 'packed'], ['web/data.json', '{"level":1}']]));
  const games = await listGames(await openLibrary(root));
  assert.deepEqual(games.map(g => g.kind).sort(), ['exe', 'html', 'html', 'zip']);
  assert.equal(games.find(g => g.title === 'Godot').relative, path.join('Godot', 'jump.html'));
  const prepared = await prepareGame(root, games.find(g => g.title === 'Godot'));
  assert.equal((await readGameFile(root, prepared, 'jump.js')).toString(), 'game');
  assert.deepEqual(await prepareGame(root, games.find(g => g.kind === 'exe')), { filename: path.join(root, 'Native.exe') });
  assert.ok(!(await fs.readdir(root)).includes('GAMEPORTAL-library'));
  const ids = games.map(g => g.id); assert.deepEqual((await listGames(root)).map(g => g.id), ids);
  await fs.writeFile(path.join(root, 'Added.html'), 'new'); assert.equal((await listGames(root)).length, 5);
});
test('ZIP plays from a local cache, invalidates changed archives, and never modifies the ZIP', async t => {
  const root = await fixture(t), filename = path.join(root, 'Packed.zip');
  const zip = archive([['game/jump.html', 'first'], ['game/data.json', '{}']]); await fs.writeFile(filename, zip);
  let game = (await listGames(root))[0], prepared = await prepareGame(root, game);
  assert.equal((await readGameFile(root, prepared, 'index.html')).toString(), 'first');
  assert.deepEqual(await fs.readFile(filename), zip);
  assert.equal((await listGames(root)).length, 1);
  const saved = await prepareGame(root, game); assert.equal(saved.base, prepared.base);
  await fs.writeFile(filename, archive([['index.html', 'second']]));
  prepared = await prepareGame(root, game); assert.equal((await readGameFile(root, prepared, 'index.html')).toString(), 'second');
});
test('path traversal, Windows aliases, symlink escapes and invalid ZIPs are rejected', async t => {
  const root = await fixture(t);
  for (const entries of [[['index.html', 'x'], ['../escape', 'x']], [['index.html', 'x'], ['a.js', 'a'], ['A.js', 'b']], [['index.html', 'x'], ['CON.txt', 'x']]]) {
    await fs.writeFile(path.join(root, 'bad.zip'), archive(entries)); await assert.rejects(prepareGame(root, (await listGames(root))[0]));
  }
  for (const name of ['../x', '/x', 'C:/x', 'x\\y', 'a/../x', 'con', 'a.', 'a ', 'x:ads']) assert.throws(() => safeResource(name));
  await fs.writeFile(path.join(root, 'index.html'), 'game');
  const prepared = await prepareGame(root, (await listGames(root)).find(g => g.kind === 'html'));
  await assert.rejects(readGameFile(root, prepared, '../outside.html'));
  if (process.platform !== 'win32') {
    const outside = await fixture(t); await fs.writeFile(path.join(outside, 'secret'), 'no');
    await fs.symlink(path.join(outside, 'secret'), path.join(root, 'outside.html')); await assert.rejects(readGameFile(root, prepared, 'outside.html'));
    assert.equal((await listGames(root)).filter(g => g.kind === 'html').length, 1);
  }
});
