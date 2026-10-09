import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { token, digest, readBody } from '../supabase/functions/portal/security.mjs';
import { createHandler } from '../supabase/functions/portal/handler.mjs';
let db, owner, alice, bob, creator, game, secret, list;
const password='library-disposable-only';
async function api(action,body={},hash=owner,fresh=null){return (await db.query('select public.portal_api($1,$2::jsonb,$3,$4) result',[action,JSON.stringify(body),hash,fresh])).rows[0].result;}
async function login(name,admin=false){const hash=token();const result=await api(admin?'admin.login':'user.login',{username:name,password,terms_accepted:true,terms_version:'2026-10-08'},null,hash);assert.ok(!result.error,JSON.stringify(result));return hash;}
async function makeGame(title,visibility){const s=(await api('user.submission.create',{title,engine:'other',version:'1',visibility,rights_confirmed:'yes',terms_accepted:true,terms_version:'2026-10-08'},creator)).submission;assert.ok(s);await api('user.submission.complete',{submission_id:s.id,drive_file_id:`test-${s.id}`,package_name:'test.zip',package_size:'123',package_storage_key:`${s.id}.zip`},creator);return s;}
before(async()=>{
 db=new PGlite({extensions:{pgcrypto}});await db.exec('create role anon;create role authenticated;create role service_role;');
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const name of (await readdir(dir)).sort())await db.exec(await readFile(new URL(name,dir),'utf8'));
 await db.query('select public.portal_bootstrap($1,$2)',['library_owner',password]);owner=await login('library_owner',true);
 for(const [username,role] of [['library_alice','player'],['library_bob','player'],['library_author','trusted_uploader']])assert.ok(!(await api('admin.create',{username,password,role})).error);
 alice=await login('library_alice');bob=await login('library_bob');creator=await login('library_author');game=await makeGame('Public game','public');secret=await makeGame('Private title','draft');
});
after(async()=>await db?.close());
test('credits are optional plain text, editable by owners and scoped to game access',async()=>{
 const credits='音楽: Test Author\nhttps://example.com/music\nCC BY 4.0\n<script>not executable</script>';
 const body={submission_id:game.id,title:game.title,engine:'other',version:'1',description:'',controls:'',visibility:'public',credits};
 assert.equal((await api('user.submission.save',body,creator)).submission.credits,credits);
 assert.equal((await db.query('select public.portal_public_game($1) result',[game.public_slug])).rows[0].result.credits,credits);
 assert.equal((await api('user.submission.save',{...body,credits:'forged'},alice)).error,'not_found');
 assert.equal((await api('user.submission.save',{...body,title:'changed',credits:'x'.repeat(8001)},creator)).error,'invalid_request');
 assert.equal((await api('user.submission.save',{...body,credits:[]},creator)).error,'invalid_request');
 const saved=(await api('user.submissions',{},creator)).submissions.find(s=>s.id===game.id);assert.equal(saved.title,game.title);assert.equal(saved.credits,credits);
 assert.ok((await api('admin.submissions')).submissions.some(s=>s.id===game.id&&s.credits===credits));
 await api('user.submission.visibility',{submission_id:game.id,visibility:'draft'},creator);
 assert.equal((await db.query('select public.portal_public_game($1) result',[game.public_slug])).rows[0].result,null);
 assert.equal((await api('user.shared.game',{slug:game.public_slug},alice)).error,'not_found');
 assert.equal((await api('user.submission.update',{...body,credits:''},creator)).submission.credits,'');
 const newGame=(await api('user.submission.create',{title:'Credits at creation',engine:'other',version:'1',visibility:'draft',credits,rights_confirmed:'yes',terms_accepted:true,terms_version:'2026-10-08'},creator)).submission;
 assert.equal(newGame.credits,credits);
});
