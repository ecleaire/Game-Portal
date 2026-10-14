import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safePath, tagsFrom, gameId, validatePyxapp, embeddedPyxel, loadMetadata, saveMetadata, loadGameSettings, saveGameSettings, scan, readTree } from '../offline-html/library.js';
import { packageWebFiles } from '../assets/zip-upload.js';

test('portable paths reject traversal, alternate streams and Windows aliases', () => {
  for(const path of ['../secret','/secret','x/../secret','C:/secret','x\\y','a:stream','con.txt','x/COM1','x.','x ','a//b','a/\u0000b']) assert.throws(()=>safePath(path));
  assert.deepEqual(safePath('日本語ゲーム/assets/my-file.png'),['日本語ゲーム','assets','my-file.png']);
});
test('relative game IDs survive root relocation and tags are bounded and deduplicated', async () => {
  assert.equal(await gameId('game/main.html'),await gameId('game/main.html'));
  assert.notEqual(await gameId('game/main.html'),await gameId('other/main.html'));
  assert.deepEqual(tagsFrom(' action, パズル、action\nお気に入り '),['action','パズル','お気に入り']);
  assert.equal(tagsFrom(Array.from({length:20},(_,i)=>String(i)).join(',')).length,12);
  assert.equal(tagsFrom('a'.repeat(100))[0].length,32);
});
test('PYXAPP requires valid bounded ZIP directory and Pyxel startup marker', async () => {
  const app=await packageWebFiles([new File(['main.py'],'app/.pyxapp_startup_script'),new File(['import pyxel'],'app/main.py')]);
  const buffer=await app.arrayBuffer(); assert.doesNotThrow(()=>validatePyxapp(buffer));
  assert.throws(()=>validatePyxapp(new Uint8Array(20)));
  const noMarker=await packageWebFiles([new File(['x'],'app/main.py')]);const noMarkerBytes=await noMarker.arrayBuffer();assert.throws(()=>validatePyxapp(noMarkerBytes));
  const encrypted=new Uint8Array(buffer.slice(0)), view=new DataView(encrypted.buffer);
  for(let at=0;at<encrypted.length-46;at++)if(view.getUint32(at,true)===0x02014b50){view.setUint16(at+8,1,true);break;}
  assert.throws(()=>validatePyxapp(encrypted));
  assert.equal(embeddedPyxel('<script src="https://cdn.example/pyxel.js"></script><script>launchPyxel({base64:"YWJjZA=="})</script>'),'YWJjZA==');
  assert.equal(embeddedPyxel('<script>evil({base64:"YWJjZA=="})</script>'),null);
});
test('metadata version and stale revision errors preserve existing files', async () => {
  let text=JSON.stringify({schema:1,revision:'new',games:{}}), writes=0;
  const root={getDirectoryHandle:async()=>root,getFileHandle:async()=>({getFile:async()=>new File([text],'library.json'),createWritable:async()=>({write:async v=>{writes++;text=v;},close:async()=>{},abort:async()=>{}})})};
  await assert.rejects(saveMetadata(root,{schema:1,revision:'old',games:{}}),/更新/);assert.equal(writes,0);
  text=JSON.stringify({schema:2,revision:'new',games:{}});await assert.rejects(loadMetadata(root));assert.equal(writes,0);
  text='{invalid';await assert.rejects(loadMetadata(root));assert.equal(writes,0);
});

function memoryFolder() {
  const files = new Map();
  const root = { name: 'games', kind: 'directory', getDirectoryHandle: async () => root,
    getFileHandle: async (name, options) => {
      if (!files.has(name) && !options?.create) throw new DOMException('Missing', 'NotFoundError');
      return { name, kind: 'file', getFile: async () => new File([files.get(name)], name), createWritable: async () => {
        let pending; return { write: async value => { pending = value; }, close: async () => files.set(name, pending), abort: async () => {} };
      }};
    }, async *values() { for (const name of files.keys()) yield await root.getFileHandle(name); }
  };
  return { root, files };
}
test('per-game files preserve settings, thumbnails and identity without changing other games', async () => {
  const { root, files } = memoryFolder(); files.set('one.html', '<h1>one</h1>'); files.set('two.html', '<h1>two</h1>');
  const metadata = { games: {} }, games = await scan(root, metadata);
  const image = 'data:image/webp;base64,YWJjZA==';
  await saveGameSettings(root, games[0], { title: 'Edited', tags: ['日本語'], developmentEnvironment: 'Godot 4.5', thumbnail: image });
  assert.equal(files.has('two.html.gameportal.json'), false);
  const [first] = (await scan(root, metadata)).filter(g => g.title === 'Edited');
  assert.equal(first.thumbnail, image); assert.equal(first.developmentEnvironment, 'Godot 4.5'); assert.equal(first.id, games[0].id);
  assert.equal((await readTree(root)).has('one.html.gameportal.json'), false);
  await assert.rejects(saveGameSettings(root, games[0], { title: 'Stale', tags: [], developmentEnvironment: '', thumbnail: null }), /更新/);
  const settings = await loadGameSettings(root, 'one.html');
  files.set('one.html.gameportal.json', JSON.stringify({ ...settings.data, title: 'Hand edited' }));
  await assert.rejects(saveGameSettings(root, first, { title: 'Stale', tags: [], developmentEnvironment: '', thumbnail: null }), /更新/);
  assert.equal((await loadGameSettings(root, 'one.html')).data.title, 'Hand edited');
  files.set('one.html.gameportal.json', JSON.stringify({ ...settings.data, schema: 2 }));
  await assert.rejects(loadGameSettings(root, 'one.html'), /形式/);
});
test('legacy metadata remains available until a game is edited into its own settings file', async () => {
  const { root, files } = memoryFolder(); files.set('old.html', 'game');
  const old = { games: { 'old.html': { title: 'Old title', tags: ['old'], thumbnail: true } } };
  const [game] = await scan(root, old); assert.equal(game.title, 'Old title'); assert.equal(game.thumbnail, true);
  await saveGameSettings(root, game, { title: 'New title', tags: game.tags, developmentEnvironment: 'Scratch', thumbnail: null });
  assert.equal((await scan(root, old))[0].title, 'New title'); assert.equal(old.games['old.html'].title, 'Old title');
});

test('offline tag suggestions retain the public portal categories without network dependencies', async () => {
  const presets = JSON.parse(await readFile(new URL('../offline-html/tag-presets.json', import.meta.url)));
  assert.equal(presets.tags.length, 77);
  assert.deepEqual([...new Set(presets.tags.map(t => t.category))], ['ジャンル','プレイ形式','画面・視点','操作','ゲームの特徴','雰囲気・デザイン','開発環境','対応環境']);
  for (const tag of presets.tags) { assert.equal(typeof tag.name,'string'); assert.ok(tag.name.length <= 32); }
});
