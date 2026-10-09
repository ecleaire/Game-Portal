import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { token, readBody } from '../supabase/functions/portal/security.mjs';
import { avatars, avatarGlyph } from '../assets/avatars.js';
let db,owner,user,other,admin,game;
const password='fuck-password-test-only'; // Passwords are deliberately never moderated.
async function api(action,body={},hash=owner,fresh=null){return (await db.query('select public.portal_api($1,$2::jsonb,$3,$4) result',[action,JSON.stringify(body),hash,fresh])).rows[0].result;}
async function login(username,administrator=false){const hash=token();const result=await api(administrator?'admin.login':'user.login',{username,password,terms_accepted:true,terms_version:'2026-10-08'},null,hash);assert.ok(!result.error,JSON.stringify(result));return hash;}
before(async()=>{
 db=new PGlite({extensions:{pgcrypto}});await db.exec('create role anon;create role authenticated;create role service_role;');
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of (await readdir(dir)).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 await db.query('select public.portal_bootstrap($1,$2)',['moderation_owner',password]);owner=await login('moderation_owner',true);
 for(const username of ['moderation_author','moderation_other'])assert.ok(!(await api('admin.create',{username,password,role:'trusted_uploader'})).error);
 assert.ok(!(await api('admin.admin.create',{username:'moderation_admin',password})).error);
 user=await login('moderation_author');other=await login('moderation_other');admin=await login('moderation_admin',true);
 game=(await api('user.submission.create',{title:'Safe game',engine:'other',version:'1.0.0',visibility:'draft',rights_confirmed:'yes',terms_accepted:true,terms_version:'2026-10-08'},user)).submission;
 assert.ok(game);
});
after(async()=>await db?.close());
test('rules are super-admin-only and deny direct browser and service role access',async()=>{
 for(const hash of [user,other,admin])assert.equal((await api('admin.moderation.list',{},hash)).error,'forbidden');
 assert.equal((await api('admin.moderation.list',{},null)).error,'unauthorized');
 for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',[role,'portal_private.content_rules','SELECT'])).rows[0].allowed,false);
 assert.ok((await api('admin.moderation.list')).rules.length>=10);
 assert.equal((await api('admin.moderation.create',{term:'x',match_mode:'word',category:'custom',is_active:null})).error,'invalid_rule');
});
test('public fields reject normalized banned terms and links without saving partial changes',async()=>{
 for(const text of ['死ね','死 ね','死\u200bね','ＦＵＣＫ','hello_fuck']){
  const result=await api('user.profile',{display_name:text,avatar_key:'cat'},user);assert.equal(result.error,'content_blocked',text);assert.equal(result.field,'display_name');assert.ok(!JSON.stringify(result).includes(text));
 }
 for(const text of ['https://example.com','ＨＴＴＰＳ：／／example.com','www.example.com','example.jp','a@example.com','http : //example.com','127.0.0.1/test'])assert.equal((await api('user.profile',{display_name:text,avatar_key:'cat'},user)).error,'url_not_allowed',text);
 for(const text of ['Scunthorpe','Sussex','ゲームをつくる'])assert.ok(!(await api('user.profile',{display_name:text,avatar_key:'cat'},user)).error,text);
 const body={submission_id:game.id,title:'Safe changed',engine:'other',version:'1.0.0',description:'',controls:'',credits:'https://example.com/credits',visibility:'draft'};
 assert.equal((await api('user.submission.save',{...body,description:'example.com'},user)).error,'url_not_allowed');
 assert.equal((await api('user.submission.save',{...body,credits:'死ね'},user)).error,'content_blocked');
 const current=(await api('user.submissions',{},user)).submissions.find(s=>s.id===game.id);assert.equal(current.title,'Safe game');assert.equal(current.credits,'');
 assert.equal((await api('user.submission.save',{...body,controls:'index.html / game.js / .wasm / .pck'},user)).submission.credits,body.credits);
 assert.equal((await api('user.submission.save',{...body,credits:'https://example.com'},other)).error,'not_found');
 assert.equal((await api('admin.create',{username:'fuck',password,role:'player'})).error,'content_blocked');
 assert.equal((await api('admin.group.create',{name:'死ね',description:'',restrict_sharing:'true'})).error,'content_blocked');
});
test('super admin can add, edit and disable literal rules; audit never stores rejected content',async()=>{
 const body={term:'テスト禁止語',match_mode:'substring',category:'custom',is_active:'true'};
 const created=await api('admin.moderation.create',body);assert.ok(created.rule);
 assert.equal((await api('admin.moderation.create',body)).error,'rule_conflict');
 assert.equal((await api('admin.moderation.create',{...body,role:'super_admin'},admin)).error,'forbidden');
 assert.equal((await api('user.profile',{display_name:'テスト禁止語',avatar_key:'cat'},user)).error,'content_blocked');
 assert.ok(!(await api('admin.moderation.update',{...body,rule_id:created.rule.id,is_active:'false'})).error);
 assert.ok(!(await api('user.profile',{display_name:'テスト禁止語',avatar_key:'cat'},user)).error);
 const events=(await api('admin.audit')).events.filter(e=>e.target_id===created.rule.id);assert.equal(events.length,2);assert.ok(events.every(e=>!JSON.stringify(e.metadata).includes(body.term)));
 const n=(await api('admin.moderation.list')).rules.length;
 // The seed is idempotent, without re-enabling a rule disabled by the owner.
 const sql=await readFile(new URL('../supabase/migrations/202610100027_content_moderation.sql',import.meta.url),'utf8');
 await db.exec(sql.slice(sql.indexOf('insert into portal_private.content_rules'),sql.indexOf('create function portal_private.check_content')));
 assert.equal((await api('admin.moderation.list')).rules.length,n);
});
test('AI declaration validates types, preserves legacy unknown state and respects game ownership',async()=>{
 assert.equal(game.ai_used,null);assert.deepEqual(game.ai_types,[]);
 const body={submission_id:game.id,title:'AI game',engine:'other',version:'1',visibility:'draft',ai_used:true,ai_types:['image','code']};
 assert.deepEqual((await api('user.submission.save',body,user)).submission.ai_types,['image','code']);
 for(const fields of [{ai_used:true,ai_types:[]},{ai_used:false,ai_types:['code']},{ai_used:true,ai_types:['fake']},{ai_used:true,ai_types:['code','code']},{ai_used:'true',ai_types:['code']},{ai_types:['code']}])assert.equal((await api('user.submission.save',{...body,...fields,ai_used:Object.hasOwn(fields,'ai_used')?fields.ai_used:undefined},user)).error,'invalid_ai');
 assert.equal((await api('user.submission.save',{...body,ai_used:false,ai_types:[]},other)).error,'not_found');
 const {ai_used,ai_types,...legacy}=body;assert.equal((await api('user.submission.save',legacy,user)).submission.ai_used,true);
 const saved=(await api('user.submission.save',{...body,ai_used:false,ai_types:[]},user)).submission;assert.equal(saved.ai_used,false);assert.deepEqual(saved.ai_types,[]);
 assert.equal((await api('admin.submissions')).submissions.find(s=>s.id===game.id).ai_used,false);
 const published=(await api('user.submission.create',{title:'AI public',engine:'other',version:'1',visibility:'public',rights_confirmed:'yes',terms_accepted:true,terms_version:'2026-10-08',ai_used:true,ai_types:['audio','text']},user)).submission;
 assert.ok(published);
 const completed=await api('user.submission.complete',{submission_id:published.id,drive_file_id:'test-ai-file',package_name:'test.zip',package_size:'123',package_storage_key:`${published.id}.zip`},user);
 assert.equal(completed.submission.status,'approved');
 const visible=(await db.query('select public.portal_public_game($1) result',[published.public_slug])).rows[0].result;assert.equal(visible.ai_used,true);assert.deepEqual(visible.ai_types,['audio','text']);
 await api('user.submission.visibility',{submission_id:published.id,visibility:'draft'},user);
 assert.equal((await db.query('select public.portal_public_game($1) result',[published.public_slug])).rows[0].result,null);
});
test('AI JSON inputs validate at the Edge; all additional icons are allowed by the database',async()=>{
 const request=data=>new Request('https://test.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'user.submission.save',data})});
 assert.deepEqual((await readBody(request({ai_used:true,ai_types:['audio','text']}))).data.ai_types,['audio','text']);
 await assert.rejects(readBody(request({ai_used:true,ai_types:['bad']})),/invalid_ai/);
 await assert.rejects(readBody(request({ai_used:'true',ai_types:[]})),/invalid_request/);
 assert.equal(avatars.length,36);
 for(const [key] of avatars)assert.equal((await db.query('select portal_private.avatar_key($1) key',[key])).rows[0].key,key);
 const saved=await api('user.profile',{display_name:'Author',avatar_key:'penguin'},user);assert.equal(saved.user.avatar_key,'penguin');assert.equal(avatarGlyph('penguin'),'🐧');
 await assert.rejects(api('user.profile',{display_name:'Author',avatar_key:'external-url'},user),/invalid avatar key/);
});
