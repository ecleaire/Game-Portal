import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('Drive reconnect validates original folders without creating folders or printing credentials', async () => {
 const dir=await mkdtemp(join(tmpdir(),'portal-reconnect-test-'));
 try {
  const client=join(dir,'client.json'), old=join(dir,'old.env'), output=join(dir,'new.env'), mock=join(dir,'mock.mjs');
  await writeFile(client,JSON.stringify({installed:{client_id:'test-client',client_secret:'test-secret'}}));
  const oldBody='GOOGLE_DRIVE_OAUTH_JSON='+JSON.stringify({client_id:'test-client',refresh_token:'test-old-token'})+'\n'+['PENDING','APPROVED','REJECTED'].map(n=>'GOOGLE_DRIVE_'+n+'_FOLDER_ID=test-folder-'+n).join('\n')+'\n';
  await writeFile(old,oldBody);
  await writeFile(mock,`globalThis.fetch=async(url,options)=>{
   if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'test-access',refresh_token:'test-new-token',scope:'https://www.googleapis.com/auth/drive.file'});
   if(String(url).startsWith('https://www.googleapis.com/drive/v3/files/test-folder-') && !options.method)return Response.json({mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true}});
   throw new Error('Unexpected network or folder creation');
  };`);
  const child=spawn(process.execPath,['--import',pathToFileURL(mock).href,fileURLToPath(new URL('../scripts/setup-drive-oauth.mjs',import.meta.url)),client,output,'--reconnect',old]);
  let logs='';let callback;
  child.stdout.on('data',bytes=>{logs+=bytes;const match=logs.match(/https:\/\/accounts\.google\.com\/[^\r\n]+\r?\n/);if(match&&!callback){const auth=new URL(match[0].trim());const target=new URL(auth.searchParams.get('redirect_uri'));target.searchParams.set('state',auth.searchParams.get('state'));target.searchParams.set('code','test-code');callback=fetch(target);callback.catch(()=>child.kill());}});
  child.stderr.on('data',bytes=>logs+=bytes);
  const timeout=setTimeout(()=>child.kill(),15000);
  const status=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});clearTimeout(timeout);
  await callback;assert.equal(status,0,logs);
  const saved=await readFile(output,'utf8');assert.ok(saved.includes('test-new-token'));assert.ok(saved.includes('test-folder-PENDING'));
  assert.equal(await readFile(old,'utf8'),oldBody);assert.ok(!logs.includes('test-secret'));assert.ok(!logs.includes('test-new-token'));assert.ok(logs.includes('existing private folders'));
 } finally { await rm(dir,{recursive:true,force:true}); }
});
