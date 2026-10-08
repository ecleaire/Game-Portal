import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { token, digest } from '../supabase/functions/portal/security.mjs';
import { createHandler } from '../supabase/functions/portal/handler.mjs';
let db, owner, manager, visitor, alice, player, outsider, groupA, groupB, game;
const password = 'disposable-group-test';
async function api(action, body = {}, hash = owner, fresh = null) {
  if (['user.login','user.submission.create'].includes(action)) body = { terms_accepted:true, terms_version:'2026-10-08', rights_confirmed:'yes', ...body };
  return (await db.query('select public.portal_api($1,$2::jsonb,$3,$4) as result', [action,JSON.stringify(body),hash,fresh])).rows[0].result;
}
async function login(name, admin=false) {
  const hash=token(); const result=await api(admin?'admin.login':'user.login',{username:name,password},null,hash); assert.ok(!result.error,JSON.stringify(result)); return hash;
}
before(async()=>{
 db=new PGlite({extensions:{pgcrypto}}); await db.exec('create role anon;create role authenticated;create role service_role;');
 const dir=new URL('../supabase/migrations/',import.meta.url);
 for(const name of (await readdir(dir)).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 await db.query('select public.portal_bootstrap($1,$2)',['group_owner',password]);owner=await login('group_owner',true);
 const staff=await api('admin.admin.create',{username:'group_manager',password});manager=await login('group_manager',true);
 await api('admin.admin.create',{username:'group_visitor',password});visitor=await login('group_visitor',true);
 groupA=(await api('admin.group.create',{name:'Group A'})).group.id;groupB=(await api('admin.group.create',{name:'Group B'})).group.id;
 assert.equal((await api('admin.group.manager',{group_id:groupA,admin_id:staff.admin.id,operation:'add'})).ok,true);
 alice=(await api('admin.group.account.create',{group_id:groupA,username:'group_alice',password,role:'uploader'},manager)).user_id;
 player=(await api('admin.group.account.create',{group_id:groupA,username:'group_player',password,role:'player'},manager)).user_id;
 outsider=(await api('admin.group.account.create',{group_id:groupB,username:'group_outsider',password,role:'uploader'})).user_id;
});
after(async()=>{await db?.close();});
test('only assigned groups allow management; participation cannot grant rights',async()=>{
 assert.deepEqual((await api('admin.groups',{},manager)).groups.map(g=>g.id),[groupA]);
 assert.equal((await api('admin.group.detail',{group_id:groupB},manager)).error,'not_found');
 const changed=await api('admin.group.rename',{group_id:groupA,name:'Renamed A',description:'Private games'},manager);
 assert.equal(changed.ok,true);assert.equal(changed.group.description,'Private games');
 assert.equal((await api('admin.group.rename',{group_id:groupB,name:'Hacked'},manager)).error,'not_found');
 assert.equal((await api('admin.group.update',{group_id:groupA,name:'A',active:'true',restrict_sharing:'false'},manager)).error,'forbidden');
 for(const action of ['admin.users','admin.reports','admin.audit','admin.tag.create','admin.admin.create','admin.account.delete','admin.group.manager','admin.group.create'])assert.equal((await api(action,{},manager)).error,'forbidden',action);
 assert.equal((await api('admin.group.membership',{group_id:groupB,operation:'join'},manager)).ok,true);
 assert.equal((await api('admin.group.detail',{group_id:groupB},manager)).error,'not_found');
 assert.equal((await api('admin.group.directory',{},manager)).groups.find(g=>g.id===groupB).manages,false);
 assert.equal((await api('admin.group.account.create',{group_id:groupB,username:'illegal',password,role:'player'},manager)).error,'not_found');
 assert.equal((await api('admin.group.member',{group_id:groupA,user_id:outsider,operation:'add'},manager)).error,'forbidden');
 assert.equal((await api('admin.group.account.create',{group_id:groupA,username:'illegal',password,role:'super_admin'},manager)).error,'forbidden');
});
test('users cannot self-enroll; play-only accounts retain normal profile and play',async()=>{
 const session=await login('group_player');
 assert.deepEqual((await api('user.groups',{},session)).groups.map(g=>g.id),[groupA]);
 assert.equal((await api('admin.group.membership',{group_id:groupB,operation:'join'},session)).error,'forbidden');
 assert.equal((await api('user.submission.create',{title:'No upload',engine:'other',version:'1',visibility:'draft'},session)).error,'forbidden');
 assert.equal((await api('user.profile',{display_name:'Player',avatar_key:'gamepad'},session)).user.display_name,'Player');
});
test('group game authorization protects metadata, review, schedule and public URLs',async()=>{
 const session=await login('group_alice');
 const body={title:'Private group game',engine:'godot',version:'1',description:'',controls:'',visibility:'group',management_group_id:groupA,group_ids:[groupA],tag_ids:[]};
 game=(await api('user.submission.create',body,session)).submission;assert.ok(game,JSON.stringify(game));
 await api('user.submission.complete',{submission_id:game.id,drive_file_id:'mock-drive',package_name:'game.zip',package_size:'100',package_storage_key:`${game.id}.zip`},session);
 const approved=await api('admin.submission.complete',{submission_id:game.id,status:'approved',package_storage_key:`${game.id}.zip`},manager);assert.equal(approved.submission.status,'approved');
 const viewer=await login('group_player');assert.equal((await api('user.shared.game',{slug:game.public_slug},viewer)).game.title,body.title);
 assert.equal((await api('user.shared.game',{slug:game.public_slug},await login('group_outsider'))).error,'not_found');
 assert.equal((await db.query('select public.portal_public_game($1) as game',[game.public_slug])).rows[0].game,null);
 assert.equal((await db.query('select public.portal_catalog() as games')).rows[0].games.length,0);
 assert.equal((await api('admin.submission.prepare',{submission_id:game.id},visitor)).error,'not_found');
 assert.equal((await api('admin.submission.save',{...body,submission_id:game.id,title:'Managed edit'},manager)).submission.title,'Managed edit');
 for(const visibility of ['public','unlisted','shared'])assert.equal((await api('user.submission.visibility',{submission_id:game.id,visibility},session)).error,'group_private_required');
 assert.equal((await api('user.submission.visibility',{submission_id:game.id,visibility:'group',group_ids:[groupB]},session)).error,'invalid_groups');
 const future=new Date(Date.now()+86400000).toISOString();
 await api('user.submission.visibility',{submission_id:game.id,visibility:'group',group_ids:[groupA],published_at:future},session);
 assert.equal((await api('user.shared.game',{slug:game.public_slug},viewer)).error,'not_found');
 await api('user.submission.visibility',{submission_id:game.id,visibility:'group',group_ids:[groupA],published_at:''},session);
 await api('admin.group.membership',{group_id:groupA,operation:'join'},visitor);
 assert.equal((await api('admin.shared.game',{slug:game.public_slug},visitor)).game.title,'Managed edit');
 assert.equal((await api('admin.submission.prepare',{submission_id:game.id},visitor)).error,'not_found');
 await api('admin.group.membership',{group_id:groupA,operation:'leave'},visitor);
 assert.equal((await api('admin.shared.game',{slug:game.public_slug},visitor)).error,'not_found');
 await api('admin.ban',{user_id:player});assert.equal((await api('user.shared.game',{slug:game.public_slug},viewer)).error,'unauthorized');
});
test('shared HTTP endpoints authorize admin participation and independently protect package bytes',async()=>{
 const pepper='group-test-only-pepper-do-not-use';const hashes=new Map();
 for(const hash of [visitor,manager])hashes.set(await digest(hash,pepper),hash);
 let downloads=0;
 const handler=createHandler({url:'https://test.invalid',serviceKey:'test-only',pepper,allowedOrigins:'https://portal.test',fetcher:async(url,options)=>{
  if(url.includes('/storage/v1/')){downloads++;return new Response('test-package');}
  const args=JSON.parse(options.body);return Response.json(await api(args.p_action,args.p_body,hashes.get(args.p_token_hash)??null));
 }});
 const request=(path,hash)=>handler(new Request(`https://test.invalid/functions/v1/portal/${path}`,{method:'POST',headers:{'Content-Type':'application/json','X-Portal-Session':hash},body:JSON.stringify({slug:game.public_slug})}));
 assert.equal((await request('shared-package',visitor)).status,404);assert.equal(downloads,0);
 await api('admin.group.membership',{group_id:groupA,operation:'join'},visitor);
 const metadata=await (await request('shared-game',visitor)).json();assert.equal(metadata.game.title,'Managed edit');
 for(const key of ['package_storage_key','thumbnail_key','drive_file_id','group_ids','management_group_id'])assert.equal(metadata.game[key],undefined);
 assert.equal(await (await request('shared-package',visitor)).text(),'test-package');assert.equal(downloads,1);
 await api('admin.group.membership',{group_id:groupA,operation:'leave'},visitor);
 assert.equal((await request('shared-package',visitor)).status,404);assert.equal(downloads,1);
 assert.equal((await request('shared-package',manager)).status,404);assert.equal(downloads,1); // Assignment is not participation.
});
test('drafts are hidden from managers; removal revokes access and restores private owner editing',async()=>{
 const session=await login('group_alice');
 const draft=(await api('user.submission.create',{title:'Owner only',engine:'other',version:'1',visibility:'draft',management_group_id:groupA},session)).submission;
 assert.equal((await api('admin.submissions',{},manager)).submissions.some(s=>s.id===draft.id),false);
 assert.equal((await api('admin.submission.prepare',{submission_id:draft.id},manager)).error,'not_found');
 assert.equal((await api('admin.group.member',{group_id:groupA,user_id:alice,operation:'remove'},manager)).ok,true);
 assert.equal((await api('admin.shared.game',{slug:game.public_slug},manager)).error,'not_found');
 const own=(await api('user.submissions',{},session)).submissions.find(s=>s.id===game.id);assert.equal(own.visibility,'draft');assert.equal(own.management_group_id,null);
 assert.equal((await api('user.submission.save',{submission_id:game.id,title:'Detached',engine:'godot',version:'2',visibility:'draft',tag_ids:[]},session)).submission.title,'Detached');
});
test('revoked assignments and disabled groups remove management immediately',async()=>{
 const staff=(await api('admin.users')).users.find(u=>u.username==='group_manager');
 await api('admin.group.manager',{group_id:groupA,admin_id:staff.id,operation:'remove'});
 assert.equal((await api('admin.group.rename',{group_id:groupA,name:'No'},manager)).error,'not_found');
 await api('admin.group.update',{group_id:groupB,name:'B',active:'false',restrict_sharing:'true'});
 assert.equal((await api('admin.group.membership',{group_id:groupB,operation:'join'},visitor)).error,'not_found');
});
test('private group tables cannot be accessed directly even using service role',async()=>{
 for(const role of ['anon','authenticated','service_role']){
  await db.exec(`set role ${role}`);
  try{for(const table of ['groups','group_members','group_admins','group_admin_members','game_group_shares'])await assert.rejects(db.query(`select * from portal_private.${table}`),/permission denied/);}
  finally{await db.exec('reset role');}
 }
});
