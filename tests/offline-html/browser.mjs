import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { packageWebFiles } from '../../assets/zip-upload.js';

const temp = await mkdtemp(join(tmpdir(), 'portal-html-'));
const main = resolve('offline-release/GAME-PORTAL.html'), html = await readFile(main);
const server = createServer((req,res) => { res.setHeader('Content-Type','text/html'); res.end(html); });
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined, headless:true });
const context = await browser.newContext({ viewport:{width:1200,height:850} });
let peer;
const peerTrace = [];
const page = await context.newPage(); const errors = [], requests = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', message => { if(message.type()==='error') console.log('Console:',message.text().slice(0,600)); });
context.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
try {
  // This instance's managed Chrome may forbid file: navigation administratively.
  // CI verifies this on standard Chromium; a local policy denial is reported.
  const filePage = await context.newPage();
  try {
    await filePage.goto(pathToFileURL(main).href);
    assert.equal(await filePage.evaluate(()=>isSecureContext && typeof showDirectoryPicker==='function'),true);
    await expect(filePage.getByRole('heading',{name:/ゲーム/})).toBeVisible(); await expect(filePage.locator('html')).toHaveAttribute('data-ready','true');
    console.log('file:// startup and folder picker availability passed.');
  } catch(e) {
    if (!String(e.message).includes('ERR_BLOCKED_BY_ADMINISTRATOR')) throw e;
    console.log('file:// startup NOT RUN: managed browser administrator policy blocks file URLs.');
  } finally { await filePage.close(); }
  await page.goto(origin); await expect(page.getByRole('heading',{name:/ゲーム/})).toBeVisible(); await expect(page.locator('html')).toHaveAttribute('data-ready','true');
  peer = await context.newPage(); await peer.goto(origin); await expect(peer.getByRole('heading',{name:/ゲーム/})).toBeVisible(); peer.on('pageerror',error=>errors.push(error.message)); await expect(peer.locator('html')).toHaveAttribute('data-ready','true');
  await page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    window.testRoot = await opfs.getDirectoryHandle('games',{create:true});
    window.showDirectoryPicker = async options => { window.testPickerOptions = options; return window.testRoot; };
  });
  await page.getByRole('button',{name:'設定',exact:true}).click();
  await page.getByRole('button',{name:'フォルダーを指定',exact:true}).click();
  await expect(page.locator('#folderName')).toHaveText('games');
  assert.equal(await page.evaluate(()=>window.testPickerOptions.mode),'read');
  await expect(page.locator('#postButton')).toBeDisabled();
  await page.getByRole('button',{name:'設定',exact:true}).click(); await page.locator('#enableEditing').check(); await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await context.setOffline(true); const before = requests.length;
  const gameFile = join(temp,'Sample.html');
  await writeFile(gameFile,'<h1>HTML offline</h1><script>document.body.dataset.previous=localStorage.getItem("level")||"none";localStorage.setItem("level","saved");document.body.dataset.parent=(()=>{try{return parent.document.title}catch{return "blocked"}})();fetch("https://example.com/forbidden").then(()=>document.body.dataset.network="allowed",()=>document.body.dataset.network="blocked");</script>');
  await writeFile(gameFile,(await readFile(gameFile,'utf8')).replace('<script>','<script>document.body.dataset.compiler=Function("return 7")();'));
  async function post(filename) { await page.getByRole('button',{name:'＋ 投稿',exact:true}).click(); await page.locator('#postFiles').setInputFiles(filename); await expect(page.locator('#post')).not.toBeVisible(); }
  const card = title => page.locator('.card').filter({has:page.getByRole('heading',{name:title,exact:true})});
  await post(gameFile); await expect(card('Sample')).toBeVisible();
  await card('Sample').getByRole('button',{name:'編集'}).click();
  await expect(page.locator('#tagCategories summary')).toHaveText(['ジャンル','プレイ形式','画面・視点','操作','ゲームの特徴','雰囲気・デザイン','開発環境','対応環境']);
  const actionTag = page.locator('#tagChoices').getByRole('button',{name:'アクション',exact:true});
  await actionTag.click(); await expect(page.locator('#editTags')).toHaveValue('アクション'); await expect(actionTag).toHaveAttribute('aria-pressed','true');
  await actionTag.click(); await expect(page.locator('#editTags')).toHaveValue('');
  await page.locator('#editEnvironment').fill('Godot 4.5'); await page.locator('#editTitle').fill('My portable game'); await page.locator('#editTags').fill('アクション, お気に入り');
  const cover = await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=36;const ctx=c.getContext('2d');ctx.fillStyle='#67ddc4';ctx.fillRect(0,0,64,36);return c.toDataURL().split(',')[1];});
  await page.locator('#editImage').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from(cover,'base64')});
  await page.getByRole('button',{name:'保存',exact:true}).click(); await expect(card('My portable game')).toBeVisible();
  await expect(card('My portable game').locator('img')).toHaveCount(1);
  const readSettings = () => page.evaluate(async () => {
    for await (const dir of window.testRoot.values()) if (dir.kind === 'directory' && dir.name.startsWith('game-')) {
      for await (const entry of dir.values()) if (entry.name === 'Sample.html.gameportal.json') return { path: dir.name + '/' + entry.name, data: JSON.parse(await (await entry.getFile()).text()) };
    }
  });
  const initialSettings = await readSettings();
  assert.equal(initialSettings.data.title, 'My portable game');
  assert.equal(initialSettings.data.developmentEnvironment, 'Godot 4.5');
  assert.deepEqual(initialSettings.data.tags, ['アクション', 'お気に入り']);
  assert.match(initialSettings.data.thumbnail, /^data:image\/webp;base64,/);
  await card('My portable game').getByRole('button',{name:'編集'}).click();
  await expect(page.locator('#editEnvironment')).toHaveValue('Godot 4.5');
  await expect(page.locator('#tagChoices').getByRole('button',{name:'お気に入り',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.locator('#editEnvironment').fill('Godot 4.6');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.locator('#edit')).not.toBeVisible();
  const updatedSettings = await readSettings();
  assert.equal(updatedSettings.path, initialSettings.path);
  assert.equal(updatedSettings.data.developmentEnvironment, 'Godot 4.6');
  assert.equal(updatedSettings.data.thumbnail, initialSettings.data.thumbnail);
  assert.equal(updatedSettings.data.id, initialSettings.data.id);
  await page.locator('#search').fill('Godot 4.6'); await expect(page.locator('.card')).toHaveCount(1); await page.locator('#search').fill('');

  await page.evaluate(()=>{const s=document.querySelector('#search');for(const value of ['','My','missing']){s.value=value;s.dispatchEvent(new Event('input'));}});
  await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));await expect(page.locator('.card')).toHaveCount(0);await page.locator('#search').fill('');
  await page.locator('#search').fill('missing'); await expect(page.locator('.card')).toHaveCount(0); await page.locator('#search').fill('お気に入り'); await expect(page.locator('.card')).toHaveCount(1); await page.locator('#search').fill('');
  await page.locator('#tagFilters').getByRole('button',{name:'アクション',exact:true}).click(); await expect(page.locator('.card')).toHaveCount(1);
  await page.locator('#tagFilters').getByRole('button',{name:'アクション',exact:true}).click();
  await card('My portable game').getByRole('button',{name:'プレイ'}).click();
  const frame = page.frameLocator('#frame'); await expect(frame.getByRole('heading',{name:'HTML offline'})).toBeVisible();
  await expect(frame.locator('body')).toHaveAttribute('data-previous','none'); await expect(frame.locator('body')).toHaveAttribute('data-parent','blocked'); await expect(frame.locator('body')).toHaveAttribute('data-network','blocked');
  await expect(frame.locator('body')).toHaveAttribute('data-compiler','7');
  await page.getByRole('button',{name:'終了',exact:true}).click();
  await card('My portable game').getByRole('button',{name:'プレイ'}).click();
  await expect(frame.locator('body')).toHaveAttribute('data-previous','saved');
  assert.equal(await frame.locator('body').evaluate(()=>{try{localStorage.setItem('large','あ'.repeat(180000));return 'allowed';}catch(error){return error.name;}}),'QuotaExceededError');
  const exported = page.waitForEvent('download'); await page.getByRole('button',{name:'セーブ書き出し',exact:true}).click();
  const download = await exported; const exportName=join(temp,'save.json'); await download.saveAs(exportName);
  const exportedData=JSON.parse(await readFile(exportName,'utf8')); assert.equal(exportedData.data.level,'saved');
  assert.equal(exportedData.gameId,initialSettings.data.id);
  // A second tab must not overwrite saves from an active session.
  peer.on('crash',()=>peerTrace.push('renderer crashed')); peer.on('close',()=>peerTrace.push('page closed'));
  await peer.evaluate(async()=>{const opfs=await navigator.storage.getDirectory();const dir=await opfs.getDirectoryHandle('games');window.showDirectoryPicker=async()=>dir;});
  await peer.getByRole('button',{name:'設定',exact:true}).click();await peer.getByRole('button',{name:'フォルダーを指定',exact:true}).click();
  await expect(peer.locator('#folderName')).toHaveText('games');
  await expect(peer.locator('#postButton')).toBeDisabled();
  const peerCard=peer.locator('.card').filter({has:peer.getByRole('heading',{name:'My portable game',exact:true})});
  await expect(peerCard.getByRole('button',{name:'My portable gameを編集',exact:true})).toBeDisabled();
  await peerCard.getByRole('button',{name:'プレイ',exact:true}).click(); await expect(peer.locator('#status')).toContainText('別のタブで起動中');
  await expect(peer.locator('#player')).not.toBeVisible();
  await page.getByRole('button',{name:'終了',exact:true}).click();
  await peerCard.getByRole('button',{name:'プレイ',exact:true}).click(); await expect(peer.frameLocator('#frame').locator('body')).toHaveAttribute('data-previous','saved');
  await peer.getByRole('button',{name:'終了',exact:true}).click(); await peer.close();
  assert.equal(await page.evaluate(async()=>{const dir=await window.testRoot.getDirectoryHandle('.gameportal');try{await dir.getDirectoryHandle('saves');return true;}catch(e){if(e.name==='NotFoundError')return false;throw e;}}),false,'Playing must never create shared NAS saves');
  const zip = await packageWebFiles([new File(['<h1>ZIP offline</h1><script>fetch("data.json").then(r=>r.json()).then(d=>document.body.dataset.loaded=d.value)</script>'],'index.html'),new File(['{"value":"local"}'],'data.json')]);
  const zipName=join(temp,'Package.zip'); await writeFile(zipName,Buffer.from(await zip.arrayBuffer())); await post(zipName);
  assert.deepEqual(await readSettings(), updatedSettings);
  await card('Package').getByRole('button',{name:'プレイ'}).click(); await expect(frame.getByRole('heading',{name:'ZIP offline'})).toBeVisible(); await expect(frame.locator('body')).toHaveAttribute('data-loaded','local'); await page.getByRole('button',{name:'終了',exact:true}).click();
  // Move all bytes (not browser handles or cached state) into a fresh folder.
  await page.evaluate(async () => {
    const opfs=await navigator.storage.getDirectory(), target=await opfs.getDirectoryHandle('copied-library',{create:true});
    async function copy(from,to) { for await(const entry of from.values()) if(entry.kind==='directory')await copy(entry,await to.getDirectoryHandle(entry.name,{create:true}));else{const w=await(await to.getFileHandle(entry.name,{create:true})).createWritable();await w.write(await entry.getFile());await w.close();} }
    await copy(window.testRoot,target); await (await target.getDirectoryHandle('.gameportal')).removeEntry('library-id.json'); window.testRoot=target; window.showDirectoryPicker=async()=>target;
  });
  await page.getByRole('button',{name:'設定',exact:true}).click(); await page.getByRole('button',{name:'フォルダーを指定',exact:true}).click();
  await expect(page.locator('#folderName')).toHaveText('copied-library'); await expect(card('My portable game').locator('.type')).toHaveText('Godot 4.6'); await expect(card('My portable game').locator('img')).toHaveCount(1);
  await card('My portable game').getByRole('button',{name:'プレイ'}).click(); await expect(frame.locator('body')).toHaveAttribute('data-previous','none'); await page.getByRole('button',{name:'終了',exact:true}).click();
  // Imported legacy/exported saves stay on this PC; wrong-game files are refused.
  await card('My portable game').getByRole('button',{name:'プレイ'}).click();
  await expect(frame.locator('body')).toHaveAttribute('data-previous','saved');
  await page.locator('#importSave').setInputFiles({name:'wrong.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...exportedData,gameId:'0'.repeat(32)}))});
  await expect(page.locator('#status')).toContainText('別のゲーム');
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#importSave').setInputFiles({name:'save.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...exportedData,data:{level:'imported'}}))});
  await expect(frame.locator('body')).toHaveAttribute('data-previous','imported');
  for (const value of ['restart-1','restart-2']) { page.once('dialog',dialog=>dialog.accept()); await page.locator('#importSave').setInputFiles({name:'save.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...exportedData,data:{level:value}}))}); await expect(frame.locator('body')).toHaveAttribute('data-previous',value); }
  // Quota/write failure keeps the pending snapshot and does not close the player.
  await page.evaluate(()=>{window.originalSavePut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='saves')throw new DOMException('Test full disk','QuotaExceededError');return window.originalSavePut.apply(this,args);};});
  await frame.locator('body').evaluate(()=>localStorage.setItem('level','unsaved'));
  await expect(page.locator('#playerStatus')).toContainText('セーブできません');
  await page.getByRole('button',{name:'終了',exact:true}).click(); await expect(page.locator('#player')).toBeVisible();
  await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalSavePut;});
  await page.getByRole('button',{name:'終了',exact:true}).click(); await expect(page.locator('#player')).not.toBeVisible();
  await card('My portable game').getByRole('button',{name:'プレイ'}).click();await expect(frame.locator('body')).toHaveAttribute('data-previous','unsaved');await page.getByRole('button',{name:'終了',exact:true}).click();
  const source='import pyxel\nfrom js import document\npyxel.init(32,32,title="Offline Pyxel")\ndocument.body.dataset.pyxel="running"\ndef update():\n    pass\ndef draw():\n    pyxel.cls(3)\npyxel.run(update,draw)\n';
  const app = await packageWebFiles([new File(['main.py'],'test/.pyxapp_startup_script'),new File([source],'test/main.py')]);
  const appName=join(temp,'Tiny.pyxapp'); await writeFile(appName,Buffer.from(await app.arrayBuffer())); await post(appName);
  await card('Tiny').getByRole('button',{name:'プレイ'}).click();
  await expect(frame.locator('#pyxel-prompt')).toBeVisible({timeout:90000});
  await frame.locator('#canvas').click(); await expect(frame.locator('body')).toHaveAttribute('data-pyxel','running',{timeout:30000});
  await expect.poll(()=>frame.locator('body').evaluate(()=>window.pyxelContext.pyodide.runPython('import pyxel; pyxel.frame_count'))).toBeGreaterThan(0);
  await page.getByRole('button',{name:'終了',exact:true}).click();
  // Existing installations keep their title/tags/cover when first saved to a sidecar.
  await page.evaluate(async image => {
    async function write(dir, name, bytes) { const writer = await (await dir.getFileHandle(name,{create:true})).createWritable(); await writer.write(bytes); await writer.close(); }
    await write(window.testRoot,'Legacy.html','<h1>Legacy</h1>');
    const admin = await window.testRoot.getDirectoryHandle('.gameportal',{create:true});
    const thumbs = await admin.getDirectoryHandle('thumbnails',{create:true});
    const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode('Legacy.html'));
    const id = [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
    await write(thumbs,id+'.webp',Uint8Array.from(atob(image.split(',')[1]),c=>c.charCodeAt(0)));
    await write(admin,'library.json',JSON.stringify({schema:1,revision:'legacy',games:{'Legacy.html':{title:'Legacy saved name',tags:['legacy'],thumbnail:true}}}));
  },initialSettings.data.thumbnail);
  await page.getByRole('button',{name:'再読み込み',exact:true}).click();
  await expect(card('Legacy saved name').locator('img')).toHaveCount(1);
  await card('Legacy saved name').getByRole('button',{name:'編集'}).click();
  await page.locator('#editEnvironment').fill('Scratch');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.locator('#edit')).not.toBeVisible();
  const legacy = await page.evaluate(async()=>JSON.parse(await(await(await window.testRoot.getFileHandle('Legacy.html.gameportal.json')).getFile()).text()));
  assert.equal(legacy.title,'Legacy saved name'); assert.deepEqual(legacy.tags,['legacy']); assert.equal(legacy.thumbnail,initialSettings.data.thumbnail);
  await card('Legacy saved name').getByRole('button',{name:'編集'}).click();
  await page.evaluate(async()=>{const handle=await window.testRoot.getFileHandle('Legacy.html.gameportal.json');const data=JSON.parse(await(await handle.getFile()).text());data.title='Updated elsewhere';const w=await handle.createWritable();await w.write(JSON.stringify(data));await w.close();});
  await page.locator('#editTitle').fill('Stale overwrite'); await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.locator('#status')).toContainText('更新されています');
  await page.getByRole('button',{name:'キャンセル',exact:true}).click();
  await page.getByRole('button',{name:'再読み込み',exact:true}).click(); await expect(card('Updated elsewhere')).toBeVisible();
  assert.equal(requests.length,before,'No HTTP requests may start after loading the single HTML');
  assert.deepEqual(errors,[]);
  await page.screenshot({path:join(temp,'offline-html.png'),fullPage:true});
  console.log('Offline HTML passed: read-only browsing, local saves, cross-tab play lock, save import/export and failed-save retry, real browser folder writes, posting HTML/ZIP/PYXAPP, metadata and thumbnail, tags/search, isolated play, save persistence, portable folder copy, real Pyxel canvas, no runtime HTTP.');
} catch(e) {
  const child=page.frames().find(f=>f!==page.mainFrame());
  if(child)console.error('Frame diagnosis:',await child.evaluate(()=>({body:document.body?.innerHTML.slice(0,1500),links:[...document.querySelectorAll('link')].map(x=>x.href),runtime:!!window.pyxelContext,resources:performance.getEntriesByType('resource').slice(-10).map(x=>x.name)})).catch(()=>null));
  console.error('Browser status:',await page.locator('#status').textContent().catch(()=>''),'Player:',await page.locator('#playerStatus').textContent().catch(()=>''));console.error('Browser errors:',errors);
  const peerState=peer&&!peer.isClosed()?await peer.evaluate(()=>({status:document.querySelector('#status')?.textContent,folder:document.querySelector('#folderName')?.textContent,cards:[...document.querySelectorAll('.card h2')].map(n=>n.textContent),settings:document.querySelector('#settings')?.open})).catch(()=>null):null;
  console.error('Peer state:',peerState);
  if(process.env.GITHUB_ACTIONS)console.log('::error title=Offline HTML::'+(String(e.stack||e)+'\nPeer state: '+JSON.stringify(peerState)+'\nPeer trace: '+JSON.stringify(peerTrace)).replaceAll('%','%25').replaceAll('\n','%0A').replaceAll('\r','%0D'));
  throw e;
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); await rm(temp,{recursive:true,force:true,maxRetries:10}); }
