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
test('likes expose only a count and own state; player and admin histories remain private',async()=>{
 assert.equal((await api('social.like',{slug:game.public_slug,liked:'true'},null)).error,'unauthorized');
 for(let i=0;i<2;i++)assert.equal((await api('social.like',{slug:game.public_slug,liked:'true'},alice)).like_count,1);
 const anonymous=await api('social.game',{slug:game.public_slug},null);assert.equal(anonymous.like_count,1);assert.equal(anonymous.liked,false);
 assert.equal(JSON.stringify(anonymous).includes('library_alice'),false);assert.equal(anonymous.user_id,undefined);assert.equal(anonymous.likers,undefined);
 assert.equal((await api('social.likes',{},alice)).games.length,1);assert.equal((await api('social.likes',{},creator)).games.length,0);assert.equal((await api('social.likes')).games.length,0);
 assert.equal((await api('social.like',{slug:game.public_slug,liked:'true'})).like_count,2);assert.equal((await api('social.likes')).games.length,1);
 assert.ok((await api('admin.likers')).error);
});
test('lists default private, reject forged owners and share links never grant game access',async()=>{
 list=(await api('social.list.create',{name:'My games'},alice)).list;
 assert.equal((await api('social.lists',{},alice)).lists[0].share_token,null);
 assert.equal((await api('social.list.get',{list_id:list.id},bob)).error,'not_found');
 for(const action of ['social.list.update','social.list.delete','social.list.share','social.list.item','social.list.order'])assert.equal((await api(action,{list_id:list.id,name:'Hacked',operation:'enable',confirmation:'delete',entry_ids:[],user_id:'00000000-0000-0000-0000-000000000000'},bob)).error,'not_found');
 assert.equal((await api('social.list.item',{list_id:list.id,slug:secret.public_slug,operation:'add'},alice)).error,'not_found');
 for(let i=0;i<2;i++)assert.equal((await api('social.list.item',{list_id:list.id,slug:game.public_slug,operation:'add'},alice)).ok,true);
 const shared=(await api('social.list.share',{list_id:list.id,operation:'enable'},alice)).share_token;assert.match(shared,/^[a-f0-9]{48}$/);
 const view=(await api('social.list.shared',{share_token:shared},null)).list;assert.equal(view.games.length,1);assert.equal(view.games[0].title,game.title);assert.equal(view.share_token,undefined);assert.equal(view.games[0].entry_id,undefined);
 await api('user.submission.visibility',{submission_id:game.id,visibility:'draft'},creator);
 const hidden=(await api('social.list.shared',{share_token:shared},null)).list.games[0];assert.deepEqual(hidden,{unavailable:true});
 const likes=(await api('social.likes',{},alice)).games[0];assert.equal(likes.unavailable,true);assert.equal(likes.slug,undefined);
 await api('social.like',{like_id:likes.like_id,liked:'false'},alice);assert.equal((await api('social.likes',{},alice)).games.length,0);
 await api('social.list.share',{list_id:list.id,operation:'disable'},alice);assert.equal((await api('social.list.shared',{share_token:shared},null)).error,'not_found');
 const next=(await api('social.list.share',{list_id:list.id,operation:'enable'},alice)).share_token;assert.notEqual(next,shared);
 const entry=(await api('social.list.get',{list_id:list.id},alice)).list.games[0];await api('social.list.item',{list_id:list.id,entry_id:entry.entry_id,operation:'remove'},alice);assert.equal((await api('social.list.get',{list_id:list.id},alice)).list.games.length,0);
 await api('user.submission.visibility',{submission_id:game.id,visibility:'public'},creator);
});
test('ordering requires the exact owned entries and follows never expose followers',async()=>{
 await api('social.list.item',{list_id:list.id,slug:game.public_slug,operation:'add'},alice);
 const entry=(await api('social.list.get',{list_id:list.id},alice)).list.games[0];
 assert.equal((await api('social.list.order',{list_id:list.id,entry_ids:[]},alice)).error,'conflict');
 assert.equal((await api('social.list.order',{list_id:list.id,entry_ids:[entry.entry_id,entry.entry_id]},alice)).error,'conflict');
 assert.equal((await api('social.list.order',{list_id:list.id,entry_ids:[entry.entry_id]},alice)).ok,true);
 for(let i=0;i<2;i++)assert.equal((await api('social.follow',{slug:game.public_slug,followed:'true'},alice)).followed,true);
 assert.equal((await api('social.following',{},alice)).following.length,1);assert.equal((await api('social.following',{},creator)).following.length,0);assert.equal((await api('social.following')).following.length,0);
 assert.equal((await api('social.follow',{slug:game.public_slug,followed:'true'},creator)).error,'invalid_request');
 const followed=(await api('social.following',{},alice)).following[0];assert.equal(followed.games.length,1);assert.equal(JSON.stringify(followed).includes('Private title'),false);
 await api('social.follow',{follow_id:followed.follow_id,followed:'false'},bob);assert.equal((await api('social.following',{},alice)).following.length,1);
 await api('social.follow',{follow_id:followed.follow_id,followed:'false'},alice);assert.equal((await api('social.following',{},alice)).following.length,0);
});
test('session revocation and BAN stop personal APIs and owner sharing; deletion cascades',async()=>{
 const share=(await api('social.list.share',{list_id:list.id,operation:'enable'},alice)).share_token;
 const user=(await api('user.me',{},alice)).user;
 await api('admin.ban',{user_id:user.id});assert.equal((await api('social.likes',{},alice)).error,'unauthorized');assert.equal((await api('social.list.shared',{share_token:share},null)).error,'not_found');
 await api('admin.unban',{user_id:user.id});assert.equal((await api('social.lists',{},alice)).error,'unauthorized');alice=await login('library_alice');
 assert.equal((await api('social.list.shared',{share_token:share},null)).list.name,'My games');
 await api('social.like',{slug:game.public_slug,liked:'true'},alice);await api('social.follow',{slug:game.public_slug,followed:'true'},alice);
 assert.equal((await api('user.submission.delete',{submission_id:game.id,title:game.title,confirmation:'delete'},creator)).deleted,true);
 assert.equal((await api('social.likes',{},alice)).games.length,0);
 for(const role of ['anon','authenticated','service_role']){await db.exec(`set role ${role}`);for(const table of ['game_likes','game_playlists','playlist_items','creator_follows'])await assert.rejects(db.query(`select * from portal_private.${table}`));await db.exec('reset role');}
});
test('private authors can save their own game; shared URLs never reveal it to another viewer',async()=>{
 const own=(await api('social.list.create',{name:'Private work'},creator)).list;
 await api('social.list.item',{list_id:own.id,slug:secret.public_slug,operation:'add'},creator);
 const detail=(await api('social.list.get',{list_id:own.id},creator)).list.games[0];assert.equal(detail.own_preview_id,secret.id);
 const share=(await api('social.list.share',{list_id:own.id,operation:'enable'},creator)).share_token;
 assert.deepEqual((await api('social.list.shared',{share_token:share},bob)).list.games,[{unavailable:true}]);
 const aliceId=(await api('user.me',{},alice)).user.id;
 assert.ok(!(await api('user.submission.visibility',{submission_id:secret.id,visibility:'shared',shared_user_ids:[aliceId]},creator)).error);
 assert.equal((await api('social.list.shared',{share_token:share},alice)).list.games[0].title,secret.title);
 assert.deepEqual((await api('social.list.shared',{share_token:share},null)).list.games,[{unavailable:true}]);
 await api('user.submission.visibility',{submission_id:secret.id,visibility:'draft'},creator);
 assert.deepEqual((await api('social.list.shared',{share_token:share},alice)).list.games,[{unavailable:true}]);
});
test('group-only games in shared lists still require current group membership',async()=>{
 const userId=(await api('user.me',{},alice)).user.id;const authorId=(await api('user.me',{},creator)).user.id;
 const group=(await api('admin.group.create',{name:'Library private group'})).group.id;
 for(const user_id of [userId,authorId])await api('admin.group.member',{group_id:group,user_id,operation:'add'});
 const s=(await api('user.submission.create',{title:'Group secret',engine:'other',version:'1',visibility:'group',group_ids:[group],management_group_id:group,terms_accepted:true,terms_version:'2026-10-08',rights_confirmed:'yes'},creator)).submission;
 assert.ok(s);await api('user.submission.complete',{submission_id:s.id,drive_file_id:`group-${s.id}`,package_name:'test.zip',package_size:'123',package_storage_key:`${s.id}.zip`},creator);
 await api('social.list.item',{list_id:list.id,slug:s.public_slug,operation:'add'},alice);
 const key=(await api('social.list.share',{list_id:list.id,operation:'enable'},alice)).share_token;
 assert.equal((await api('social.list.shared',{share_token:key},alice)).list.games.some(g=>g.title==='Group secret'),true);
 assert.equal(JSON.stringify(await api('social.list.shared',{share_token:key},null)).includes('Group secret'),false);
 await api('admin.group.member',{group_id:group,user_id:userId,operation:'remove'});
 assert.equal(JSON.stringify(await api('social.list.shared',{share_token:key},alice)).includes('Group secret'),false);
 assert.equal((await api('social.like',{slug:s.public_slug,liked:'true'},alice)).error,'not_found');
});
test('list limits are enforced in SQL and deleting an account removes its personal data',async()=>{
 const id=(await api('user.me',{},bob)).user.id;
 await db.query("insert into portal_private.game_playlists(user_id,name) select $1,'List '||n from generate_series(1,50) n",[id]);
 assert.equal((await api('social.list.create',{name:'Over limit'},bob)).error,'limit_reached');
 const actual=(await api('social.lists',{},bob)).lists[0];
 assert.equal((await api('social.list.item',{list_id:actual.id,slug:secret.public_slug,operation:'add'},creator)).error,'not_found');
 const creatorId=(await api('user.me',{},creator)).user.id;
 const fixtures=(await db.query("insert into portal_private.game_submissions(user_id,title,engine,description,version,controls,status,visibility,package_storage_key) select $1,'Cap fixture '||n,'other','','1','','approved','public','cap-fixture.zip' from generate_series(1,1001) n returning id,public_slug",[creatorId])).rows;
 await db.query('insert into portal_private.playlist_items(playlist_id,game_id) select $1,unnest($2::uuid[])',[actual.id,fixtures.slice(0,500).map(g=>g.id)]);
 assert.equal((await api('social.list.item',{list_id:actual.id,slug:fixtures[500].public_slug,operation:'add'},bob)).error,'limit_reached');
 assert.equal((await api('social.list.item',{list_id:actual.id,slug:fixtures[0].public_slug,operation:'add'},bob)).ok,true);
 await db.query('insert into portal_private.game_likes(user_id,game_id) select $1,unnest($2::uuid[])',[id,fixtures.slice(0,1000).map(g=>g.id)]);
 assert.equal((await api('social.like',{slug:fixtures[1000].public_slug,liked:'true'},bob)).error,'limit_reached');
 assert.equal((await api('social.like',{slug:fixtures[0].public_slug,liked:'true'},bob)).liked,true);
 const adminId=(await api('admin.me')).admin.id;
 await db.query('insert into portal_private.creator_follows(creator_id,admin_id) values($1,$2)',[id,adminId]);
 // Exercise the existing complete deletion path, including its durable cleanup.
 const deleted=await api('admin.account.delete',{user_id:id,confirmation:'delete',username:'library_bob'});assert.equal(deleted.deleted,true);
 for(const table of ['game_likes','game_playlists','creator_follows'])assert.equal((await db.query(`select count(*)::integer n from portal_private.${table} where user_id=$1`,[id])).rows[0].n,0);
 assert.equal((await db.query('select count(*)::integer n from portal_private.creator_follows where creator_id=$1',[id])).rows[0].n,0);
 assert.equal((await db.query('select count(*)::integer n from portal_private.playlist_items where playlist_id=$1',[actual.id])).rows[0].n,0);
});
test('HTTP boundary accepts only anonymous public reads and validates order arrays',async()=>{
 const pepper='library-test-pepper-never-for-production';const hashes=new Map([[await digest(bob,pepper),bob]]);
 const handler=createHandler({url:'https://test.invalid',serviceKey:'test-only',pepper,allowedOrigins:'https://portal.test',fetcher:async(_url,options)=>{const p=JSON.parse(options.body);return Response.json(await api(p.p_action,p.p_body,hashes.get(p.p_token_hash)??(p.p_token_hash?token():null)));}});
 const request=(action,data={},session)=>handler(new Request('https://test.invalid/functions/v1/portal',{method:'POST',headers:{'Content-Type':'application/json',...(session?{'X-Portal-Session':session}:{})},body:JSON.stringify({action,data})}));
 assert.equal((await request('social.likes')).status,401);assert.equal((await request('social.list.shared',{share_token:'a'.repeat(48)})).status,404);assert.equal((await request('social.game',{slug:secret.public_slug},'invalid')).status,401);
 const parse=ids=>readBody(new Request('https://test.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'social.list.order',data:{entry_ids:ids}})}));
 await assert.rejects(parse(['bad']));await assert.rejects(parse(Array(501).fill('00000000-0000-0000-0000-000000000000')));assert.deepEqual((await parse([])).data.entry_ids,[]);
});
