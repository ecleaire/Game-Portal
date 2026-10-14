import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safePath, tagsFrom, gameId, validatePyxapp, embeddedPyxel, loadMetadata, saveMetadata } from '../offline-html/library.js';
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
