import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { token } from '../supabase/functions/portal/security.mjs';
let db,owner,author,other,game,group;
const password='disposable-release-test';
async function api(action,body={},hash=owner,fresh=null) {
 return (await db.query('select public.portal_api($1,$2::jsonb,$3,$4) result',[action,JSON.stringify(body),hash,fresh])).rows[0].result;
}
async function login(name,admin=false) {
 const hash=token();const result=await api(admin?'admin.login':'user.login',{username:name,password,terms_accepted:true,terms_version:'2026-10-08'},null,hash);assert.ok(!result.error,JSON.stringify(result));return hash;
}
before(async()=>{
 db=new PGlite({extensions:{pgcrypto}});await db.exec('create role anon;create role authenticated;create role service_role;');
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of (await readdir(dir)).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 await db.query('select public.portal_bootstrap($1,$2)',['release_owner',password]);owner=await login('release_owner',true);
 for(const username of ['release_author','release_other'])assert.ok(!(await api('admin.create',{username,password,role:'uploader'})).error);
 author=await login('release_author');other=await login('release_other');
 const result=await api('user.submission.create',{title:'Review release',engine:'other',version:'1',visibility:'public',release_notes:'First version',rights_confirmed:'yes',terms_version:'2026-10-08'},author);
 assert.ok(result.submission,JSON.stringify(result));game=result.submission;
 await api('user.submission.complete',{submission_id:game.id,drive_file_id:'test-drive',package_name:'game.zip',package_size:'100',package_storage_key:`${game.id}.zip`},author);
});
after(async()=>await db?.close());
test('review notices are persistent and only the owner can read or mark them read',async()=>{
 assert.equal((await api('user.submissions',{},author)).notifications.length,0);
 assert.equal((await api('admin.submission.complete',{submission_id:game.id,status:'rejected',reason:'Please revise'})).submission.status,'rejected');
 let notices=(await api('user.submissions',{},author)).notifications;
 assert.equal(notices.length,1);assert.equal(notices[0].status,'rejected');assert.equal(notices[0].reason,'Please revise');assert.equal(notices[0].read_at,null);
 assert.equal((await api('user.submissions',{read_notification_id:notices[0].id},other)).notifications.length,0);
 assert.equal((await api('user.submissions',{},author)).notifications[0].read_at,null);
 assert.ok((await api('user.submissions',{read_notification_id:notices[0].id},author)).notifications[0].read_at);
 assert.equal((await api('user.submissions',{},null)).error,'unauthorized');
});
test('release notes are moderated atomically and approved versions alone enter public history',async()=>{
 const body={submission_id:game.id,title:game.title,engine:'other',version:'2',visibility:'public',release_notes:'Second version'};
 assert.ok(!(await api('user.submission.save',body,author)).error);
 assert.equal((await api('user.submissions',{},author)).submissions[0].releases.length,0);
 assert.equal((await api('admin.submission.complete',{submission_id:game.id,status:'approved',package_storage_key:`${game.id}.zip`})).submission.status,'approved');
 let publicGame=(await db.query('select public.portal_public_game($1) game',[game.public_slug])).rows[0].game;
 assert.deepEqual(publicGame.releases.map(r=>[r.version,r.notes]),[['2','Second version']]);
 const rejected=await api('user.submission.save',{...body,title:'Must roll back',release_notes:'https://example.com'},author);
 assert.equal(rejected.error,'url_not_allowed');assert.equal((await api('user.submissions',{},author)).submissions[0].title,game.title);
 assert.equal((await api('user.submission.save',{...body,release_notes:'死ね'},author)).error,'content_blocked');
 assert.equal((await api('user.submission.save',{...body,release_notes:'forged'},other)).error,'not_found');
 await api('user.submission.save',{...body,release_notes:'Corrected second version'},author);
 await api('user.submission.save',{...body,version:'3',release_notes:'Third version'},author);
 publicGame=(await db.query('select public.portal_public_game($1) game',[game.public_slug])).rows[0].game;
 assert.equal(publicGame.releases.length,2);assert.ok(publicGame.releases.some(r=>r.version==='2'&&r.notes==='Corrected second version'));
 await db.query("update portal_private.game_submissions set status='pending',release_notes='Unapproved notes' where id=$1",[game.id]);
 assert.equal(JSON.stringify((await api('user.submissions',{},author)).submissions[0].releases).includes('Unapproved notes'),false);
 assert.equal((await db.query('select public.portal_public_game($1) game',[game.public_slug])).rows[0].game,null);
});
test('group catalog verifies live membership and publication instead of trusting the group ID',async()=>{
 group=(await api('admin.group.create',{name:'Catalog group'})).group.id;
 const authorId=(await api('user.me',{},author)).user.id;const otherId=(await api('user.me',{},other)).user.id;
 for(const user_id of [authorId,otherId])await api('admin.group.member',{group_id:group,user_id,operation:'add'});
 await api('user.submission.visibility',{submission_id:game.id,visibility:'group',management_group_id:group,group_ids:[group]},author);
 await api('admin.submission.complete',{submission_id:game.id,status:'approved',package_storage_key:`${game.id}.zip`});
 let catalog=await api('user.shared.games',{group_id:group},other);assert.equal(catalog.games.length,1);assert.equal(catalog.games[0].group_ids,undefined);
 await db.query('update portal_private.game_submissions set published_at=now()+interval \'1 day\' where id=$1',[game.id]);
 assert.equal((await api('user.shared.games',{group_id:group},other)).games.length,0);
 await api('admin.group.member',{group_id:group,user_id:otherId,operation:'remove'});
 assert.equal((await api('user.shared.games',{group_id:group},other)).error,'not_found');
 assert.equal((await api('user.shared.games',{group_id:'not-a-group'},author)).error,'not_found');
});
test('notification and release storage and helpers cannot be read directly by client roles',async()=>{
 for(const role of ['anon','authenticated','service_role']) {
  for(const table of ['review_notifications','game_releases'])assert.equal((await db.query('select has_table_privilege($1,$2,\'SELECT\') allowed',[role,`portal_private.${table}`])).rows[0].allowed,false);
  assert.equal((await db.query("select has_function_privilege($1,'portal_private.release_history(uuid)','EXECUTE') allowed",[role])).rows[0].allowed,false);
 }
});
