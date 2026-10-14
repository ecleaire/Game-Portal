import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safePath, tagsFrom, gameId, validatePyxapp, embeddedPyxel, loadMetadata, saveMetadata, loadGameSettings, saveGameSettings, scan, readTree, postGame, loadLibraryId, ensureLibraryId } from '../offline-html/library.js';
import { validSave } from '../offline-html/local-state.js';
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

function memoryFolder(hooks = {}) {
  const files = new Map(), folders = new Map(), locks = new Set();
  const root = { name: 'games', kind: 'directory',
    getDirectoryHandle: async (name, options) => {
      if (!folders.has(name) && !options?.create) throw new DOMException('Missing', 'NotFoundError');
      if (!folders.has(name)) { const child = memoryFolder(hooks); child.root.name = name; folders.set(name, child); }
      return folders.get(name).root;
    },
    removeEntry: async name => { files.delete(name); folders.delete(name); },
    getFileHandle: async (name, options) => {
      if (!files.has(name) && !options?.create) throw new DOMException('Missing', 'NotFoundError');
      if (!files.has(name) && options?.create) files.set(name, '');
      return { name, kind: 'file', getFile: async () => new File([files.get(name)], name), createWritable: async options => {
        if (locks.has(name)) throw new DOMException('Locked','NoModificationAllowedError');
        if (options?.mode === 'exclusive') locks.add(name);
        await hooks.open?.(name, options, files);
        let pending; return { write: async value => { await hooks.write?.(name, value); pending = value; },
          close: async () => { await hooks.close?.(name); files.set(name, pending); locks.delete(name); }, abort: async () => { locks.delete(name); } };
      }};
    }, async *values() { for (const name of files.keys()) yield await root.getFileHandle(name); for (const child of folders.values()) yield child.root; }
  };
  return { root, files, folders };
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

test('settings keep recovery history and preserve the committed file when the NAS write fails', async () => {
  let fail = false;
  const {root,files,folders} = memoryFolder({ write: async name => { if(fail && name === 'one.html.gameportal.json') throw new Error('NAS disconnected'); } });
  files.set('one.html','game');
  let [game] = await scan(root,{games:{}});
  const values = {title:'Initial',tags:[],developmentEnvironment:'Godot',thumbnail:null};
  await saveGameSettings(root,game,values); [game] = await scan(root,{games:{}});
  const original=files.get('one.html.gameportal.json'); fail=true;
  await assert.rejects(saveGameSettings(root,game,{...values,title:'Unsaved edit'}),/NAS disconnected/);
  assert.equal(files.get('one.html.gameportal.json'),original);
  const history=folders.get('.gameportal').folders.get('history').folders.get(game.id).files;
  const attempts=[...history.values()].map(text=>JSON.parse(text));
  assert.equal(attempts.length,2);
  const failed=attempts.find(item=>JSON.parse(item.after).title==='Unsaved edit');
  assert.equal(failed.before,original);
});
test('settings recheck after acquiring the exclusive writer and reject simultaneous writers', async () => {
  let mutate=false;
  const {root,files} = memoryFolder({ open: async (name,options,stored) => {
    assert.equal(options.mode,'exclusive');
    if(mutate && name==='one.html.gameportal.json') { mutate=false; const current=JSON.parse(stored.get(name));current.title='External edit';stored.set(name,JSON.stringify(current)); }
  }});
  files.set('one.html','game');let [game]=await scan(root,{games:{}});
  const values={title:'Initial',tags:[],developmentEnvironment:'',thumbnail:null};
  await saveGameSettings(root,game,values);[game]=await scan(root,{games:{}});mutate=true;
  await assert.rejects(saveGameSettings(root,game,{...values,title:'Stale edit'}),/更新/);
  assert.equal(JSON.parse(files.get('one.html.gameportal.json')).title,'External edit');
  [game]=await scan(root,{games:{}});
  const results=await Promise.allSettled([saveGameSettings(root,game,{...values,title:'First'}),saveGameSettings(root,game,{...values,title:'Second'})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
});
test('a corrupt settings file and duplicate IDs cannot break unrelated games', async () => {
  const {root,files}=memoryFolder();files.set('one.html','one');files.set('two.html','two');
  files.set('one.html.gameportal.json','{invalid');
  const list=await scan(root,{games:{}});assert.equal(list.length,2);
  assert.ok(list.find(g=>g.path==='one.html').settingsError);assert.equal(list.find(g=>g.path==='two.html').settingsError,'');
  files.delete('one.html.gameportal.json');const [game]=await scan(root,{games:{}});
  await saveGameSettings(root,game,{title:'First',tags:[],developmentEnvironment:'',thumbnail:null});
  files.set('two.html.gameportal.json',files.get('one.html.gameportal.json'));
  assert.ok((await scan(root,{games:{}})).every(g=>g.identityConflict));
});
test('posting is hidden until complete and interrupted imports remove only their own folder', async () => {
  let root, seenDuringCopy, fail=false;
  const memory=memoryFolder({write:async name=>{if(name==='Sample.html'){seenDuringCopy=await scan(root,{games:{}});if(fail)throw new Error('NAS disconnected');}}});
  root=memory.root;memory.files.set('existing.html','unchanged');
  await postGame(root,[new File(['<h1>game</h1>'],'Sample.html')],{});
  assert.equal(seenDuringCopy.length,1);assert.equal((await scan(root,{games:{}})).length,2);
  const before=[...memory.folders.keys()]; fail=true;
  await assert.rejects(postGame(root,[new File(['<h1>game</h1>'],'Sample.html')],{}),/NAS disconnected/);
  assert.deepEqual([...memory.folders.keys()],before);assert.equal(memory.files.get('existing.html'),'unchanged');
});

test('local save validation counts UTF-8 bytes and rejects non-string or oversized data', () => {
  assert.equal(validSave({level:'日本語'}),true);
  for(const value of [[],{level:1},{level:'あ'.repeat(180000)},Object.fromEntries(Array.from({length:1001},(_,i)=>[String(i),'value']))]) assert.equal(!!validSave(value),false);
});

test('a newly appearing upload marker also hides a folder during enumeration', async () => {
  const {root,files,folders}=memoryFolder();files.set('complete.html','complete');
  const child=await root.getDirectoryHandle('incomplete',{create:true});
  folders.get('incomplete').files.set('.gameportal-uploading','pending');folders.get('incomplete').files.set('index.html','partial');
  const original=child.getFileHandle;let first=true;
  child.getFileHandle=async(name,...args)=>{if(name==='.gameportal-uploading'&&first){first=false;throw new DOMException('Not visible yet','NotFoundError');}return original(name,...args);};
  assert.deepEqual((await scan(root,{games:{}})).map(game=>game.path),['complete.html']);
});

test('a library ID is initialized once, remains read-only for viewers, and separates libraries', async () => {
  const first=memoryFolder(), second=memoryFolder();
  assert.equal(await loadLibraryId(first.root),null); assert.equal(first.folders.size,0);
  const id=await ensureLibraryId(first.root);assert.match(id,/^[a-f0-9]{32}$/);
  assert.equal(await ensureLibraryId(first.root),id);assert.equal(await loadLibraryId(first.root),id);
  assert.notEqual(await ensureLibraryId(second.root),id);
  first.folders.get('.gameportal').files.set('library-id.json','{invalid');
  await assert.rejects(ensureLibraryId(first.root)); assert.equal(first.folders.get('.gameportal').files.get('library-id.json'),'{invalid');
});
