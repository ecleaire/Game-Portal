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
test('creator profiles show display settings and discoverable games without leaking private or unlisted works',async()=>{
 await api('user.profile',{display_name:'作者の表示名',avatar_key:'fox'},creator);
 const unlisted=await makeGame('Hidden unlisted title','unlisted');
 const result=await api('social.creator',{slug:game.public_slug},null);
 assert.deepEqual(result.creator,{name:'作者の表示名',avatar_key:'fox'});
 assert.deepEqual(result.games.map(g=>g.title),['Public game']);
 assert.equal(JSON.stringify(result).includes('library_author'),false);
 assert.equal(JSON.stringify(result).includes('Private title'),false);
 assert.equal(JSON.stringify(result).includes(unlisted.public_slug),false);
 const fromUnlisted=await api('social.creator',{slug:unlisted.public_slug},null);
 assert.deepEqual(fromUnlisted.games.map(g=>g.title),['Public game']);
 assert.equal((await api('social.creator',{slug:secret.public_slug},null)).error,'not_found');
 const own=await api('social.creator',{slug:secret.public_slug},creator);
 assert.equal(own.games.length,3);assert.ok(own.games.some(g=>g.own_preview_id===secret.id));
 const aliceId=(await api('user.me',{},alice)).user.id;
 await api('user.submission.visibility',{submission_id:secret.id,visibility:'shared',shared_user_ids:[aliceId]},creator);
 assert.ok((await api('social.creator',{slug:game.public_slug},alice)).games.some(g=>g.title==='Private title'));
 assert.equal((await api('social.creator',{slug:game.public_slug},bob)).games.length,1);
 await api('user.submission.visibility',{submission_id:secret.id,visibility:'draft'},creator);
 assert.equal((await api('social.creator',{slug:game.public_slug},alice)).games.length,1);
 assert.equal((await api('social.creator',{slug:secret.public_slug},alice)).error,'not_found');
});
test('profiles reject revoked sessions, invalid offsets, deleted anchors and anonymous private seeds',async()=>{
 assert.equal((await api('social.creator',{slug:game.public_slug,offset:'-1'},null)).error,'invalid_request');
 assert.equal((await api('social.creator',{slug:game.public_slug,offset:'25'},null)).games.length,0);
 assert.equal((await api('social.creator',{slug:game.public_slug},token())).error,'unauthorized');
 const creatorId=(await api('user.me',{},creator)).user.id;
 await api('admin.ban',{user_id:creatorId});
 assert.equal((await api('social.creator',{slug:game.public_slug},null)).error,'not_found');
 assert.equal((await api('social.creator',{slug:game.public_slug},creator)).error,'unauthorized');
});
