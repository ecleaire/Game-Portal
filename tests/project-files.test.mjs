import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHandler } from '../supabase/functions/portal/handler.mjs';
import { digest, token } from '../supabase/functions/portal/security.mjs';
import { packageWebFiles } from '../assets/zip-upload.js';
import { checkProjectFile, validateProjectArchive } from '../assets/project-files.js';
let db, handler, author, other, superAdmin, manager, visitor, group;
const password='project-test-password', pepper='project-test-only-pepper-long-enough';
const drive = new Map();
async function api(action,body={},who=superAdmin,fresh=null) {
 return (await db.query('select public.portal_api($1,$2::jsonb,$3,$4) result',[action,JSON.stringify(body),who?.hash??null,fresh])).rows[0].result;
}
async function login(username,admin=false) {
 const raw=token(),hash=await digest(raw,pepper);
 const result=await api(admin?'admin.login':'user.login',{username,password,terms_accepted:true,terms_version:'2026-10-08'},null,hash);
 assert.ok(!result.error,JSON.stringify(result));return {raw,hash,id:(result.user??result.admin).id};
}
async function make(visibility='public') {
 const result=await api('user.submission.create',{title:'Project test',version:'1',engine:'godot',visibility,rights_confirmed:'yes',terms_version:'2026-10-08',...(visibility==='group'?{management_group_id:group.id,group_ids:[group.id]}:{})},author);
 assert.ok(result.submission,JSON.stringify(result));return result.submission;
}
async function source(name='source.zip') {
 const zip=await packageWebFiles([new File(['config_version=5'], 'project.godot')]);
 return new File([await zip.arrayBuffer()],name);
}
async function upload(game,who=author,file,revision=crypto.randomUUID()) {
 const body=new FormData();body.set('submission_id',game.id);body.set('revision',revision);body.set('project',file??await source());
 return handler(new Request('https://project-test.supabase.co/functions/v1/portal/project-upload',{method:'POST',headers:{'X-Portal-Session':who.raw},body}));
}
async function download(game,who) {
 return handler(new Request('https://project-test.supabase.co/functions/v1/portal/project-download',{method:'POST',headers:who?{'X-Portal-Session':who.raw,'Content-Type':'application/json'}:{'Content-Type':'application/json'},body:JSON.stringify({submission_id:game.id})}));
}
before(async()=>{
 db=new PGlite({extensions:{pgcrypto}});await db.exec('create role anon;create role authenticated;create role service_role;');
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of (await readdir(dir)).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 await db.query('select public.portal_bootstrap($1,$2)',['project_root',password]);superAdmin=await login('project_root',true);
 for(const username of ['project_author','project_other'])assert.ok(!(await api('admin.create',{username,password,role:'uploader'})).error);
 author=await login('project_author');other=await login('project_other');
 for(const username of ['project_manager','project_visitor'])assert.ok(!(await api('admin.admin.create',{username,password,role:'admin'})).error);
 manager=await login('project_manager',true);visitor=await login('project_visitor',true);
 group=(await api('admin.group.create',{name:'Source group'})).group;
 await db.query('update portal_private.groups set restrict_sharing=false where id=$1',[group.id]);
 await api('admin.group.member',{group_id:group.id,user_id:author.id,operation:'add'});
 await api('admin.group.manager',{group_id:group.id,admin_id:manager.id,operation:'add'});
 handler=createHandler({url:'https://project-test.supabase.co',serviceKey:'test-only',pepper,allowedOrigins:'https://ecleaire.github.io',googleDriveOAuthJson:'{"client_id":"test","client_secret":"test","refresh_token":"test"}',googlePendingFolderId:'test-pending',fetcher:async(url,options)=>{
  if(url.includes('/rest/v1/rpc/')) { const p=JSON.parse(options.body),name=url.split('/').pop();
   const result=name==='portal_project_file'?(await db.query('select public.portal_project_file($1,$2::jsonb,$3) result',[p.p_action,JSON.stringify(p.p_body),p.p_token_hash])).rows[0].result:
    (await db.query('select public.portal_api($1,$2::jsonb,$3,$4) result',[p.p_action,JSON.stringify(p.p_body),p.p_token_hash,p.p_new_token_hash])).rows[0].result;
   return Response.json(result);
  }
  if(url.includes('oauth2.googleapis.com'))return Response.json({access_token:'test-only'});
  if(url.includes('/upload/drive/')) { const bytes=Buffer.from(options.body),marker=Buffer.from('Content-Type: application/zip\r\n\r\n'),boundary=options.headers['Content-Type'].split('boundary=')[1];
   const id=crypto.randomUUID();drive.set(id,bytes.subarray(bytes.indexOf(marker)+marker.length,bytes.lastIndexOf(Buffer.from(`\r\n--${boundary}--`))));return Response.json({id}); }
  const id=new URL(url).pathname.split('/').pop();
  if(options.method==='DELETE'){drive.delete(id);return new Response(null,{status:204});}
  return drive.has(id)?new Response(drive.get(id)):new Response(null,{status:404});
 }});
});
after(async()=>await db?.close());
test('source archive validation accepts Godot and SB3, rejects web-only, dangerous and malformed archives',async()=>{
 assert.ok(await checkProjectFile(await source(),'godot'));
 const sb3=await packageWebFiles([new File(['{"targets":[]}'],'project.json')]);
 assert.ok(await checkProjectFile(new File([await sb3.arrayBuffer()],'game.sb3'),'scratch'));
 await assert.rejects(checkProjectFile(sb3,'godot'),/invalid_project/);
 await assert.rejects(checkProjectFile(new File(['not zip'],'game.sb3'),'scratch'),/invalid_project/);
 const bytes=new Uint8Array(await (await source()).arrayBuffer());bytes[30]=47;
 assert.throws(()=>validateProjectArchive(bytes,'source.zip','godot'),/invalid_project/);
 await assert.rejects(checkProjectFile({size:52428801},'godot'),/invalid_project/);
});
test('new works require source on server and upload stores it separately without leaking Drive IDs',async()=>{
 const game=await make();assert.equal(game.project_required,true);
 assert.equal((await api('user.submission.prepare',{submission_id:game.id},author)).error,'project_required');
 assert.equal((await api('user.submission.complete',{submission_id:game.id},author)).error,'project_required');
 const response=await upload(game);assert.equal(response.status,200);const result=await response.json();
 assert.equal(result.submission.project_file.name,'source.zip');assert.ok(!JSON.stringify(result).includes('project_drive_id'));
 assert.ok(!(await api('user.submission.prepare',{submission_id:game.id},author)).error);
 const got=await download(game,author);assert.equal(got.status,200);assert.deepEqual(new Uint8Array(await got.arrayBuffer()),new Uint8Array(await (await source()).arrayBuffer()));
 assert.equal((await download(game,other)).status,404);assert.equal((await download(game,null)).status,401);
});
test('only assigned reviewers may download non-draft sources, participation does not grant access',async()=>{
 const game=await make('group');assert.equal((await upload(game)).status,200);
 assert.equal((await download(game,manager)).status,200);assert.equal((await download(game,superAdmin)).status,200);assert.equal((await download(game,visitor)).status,404);
 const draft=await make('draft');assert.equal((await upload(draft)).status,200);assert.equal((await download(draft,superAdmin)).status,404);
 assert.equal((await upload(game,manager)).status,403);
 await api('admin.group.manager',{group_id:group.id,admin_id:manager.id,operation:'remove'});
 assert.equal((await download(game,manager)).status,404);
});
test('replacement requires renewed review, CAS detects conflicts and deletion tracks all source revisions',async()=>{
 const game=await make();await upload(game);
 await db.query("update portal_private.game_submissions set status='approved',package_storage_key='test.zip' where id=$1",[game.id]);
 const response=await upload(game);assert.equal(response.status,200);assert.equal((await response.json()).submission.status,'pending');
 const invalid=(await db.query("select public.portal_project_file('complete',$1::jsonb,$2) result",[JSON.stringify({submission_id:game.id,revision:crypto.randomUUID(),previous_revision:'',file_id:'another-file',name:'new.zip',size:'10'}),author.hash])).rows[0].result;
 assert.equal(invalid.error,'conflict');
 assert.equal((await db.query("select count(*)::int n from portal_private.game_files where game_id=$1 and bucket='drive'",[game.id])).rows[0].n,2);
 await api('user.submission.delete',{submission_id:game.id,title:game.title,confirmation:'delete'},author);
 assert.equal((await db.query("select count(*)::int n from portal_private.deleted_game_files where game_id=$1 and bucket='drive'",[game.id])).rows[0].n,2);
 for(const role of ['anon','authenticated','service_role']) {await db.exec(`set role ${role}`);try {await assert.rejects(db.query('select project_drive_id from portal_private.game_submissions'),/permission denied/);if(role!=='service_role')await assert.rejects(db.query("select public.portal_project_file('prepare','{}',null)"),/permission denied/);}finally{await db.exec('reset role');}}
});
test('KICK and BAN revoke source access; legacy works remain compatible without required sources',async()=>{
 const game=await make();await upload(game);await api('admin.kick',{user_id:author.id});
 assert.equal((await download(game,author)).status,401);author=await login('project_author');
 await api('admin.ban',{user_id:author.id,reason:'Test',banned_until:''});assert.equal((await download(game,author)).status,401);
 await api('admin.unban',{user_id:author.id});author=await login('project_author');
 const legacy=await make();await db.query('update portal_private.game_submissions set project_required=false where id=$1',[legacy.id]);
 assert.ok(!(await api('user.submission.prepare',{submission_id:legacy.id},author)).error);
});
