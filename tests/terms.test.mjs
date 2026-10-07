import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { token, readBody } from '../supabase/functions/portal/security.mjs';
let db, admin, uid, version;
const password='terms-test-only-password';
async function api(action,body={},hash=null,fresh=null) {
 return (await db.query('select public.portal_api($1,$2::jsonb,$3,$4) as r',[action,JSON.stringify(body),hash,fresh])).rows[0].r;
}
async function login(extra={},name='terms_user') {const hash=token();return {hash,...await api('user.login',{username:name,password,...extra},null,hash)};}
before(async()=>{
 db=new PGlite({extensions:{pgcrypto}});await db.exec('create role anon;create role authenticated;create role service_role;');
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const file of (await readdir(dir)).sort())await db.exec(await readFile(new URL(file,dir),'utf8'));
 await db.query('select public.portal_bootstrap($1,$2)',['terms_owner',password]);admin=token();assert.ok((await api('admin.login',{username:'terms_owner',password},null,admin)).admin);
 uid=(await api('admin.create',{username:'terms_user',password,role:'uploader'},admin)).user.id;
 version=(await api('policy.current')).terms.version;
});
after(async()=>{await db?.close();});
test('user consent is mandatory, current and atomic; invalid credentials and BAN do not create evidence',async()=>{
 for(const extra of [{},{terms_accepted:false},{terms_accepted:'true'}])assert.equal((await login(extra)).error,'terms_required');
 assert.equal((await login({terms_accepted:true,terms_version:'old'})).error,'terms_outdated');
 assert.equal((await login({terms_accepted:true,terms_version:version,password:'invalid'})).error,'invalid_credentials');
 assert.equal((await login({terms_accepted:true,terms_version:version},'missing_user')).error,'invalid_credentials');
 assert.equal((await db.query('select count(*)::int as n from portal_private.terms_acceptances')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int as n from portal_private.sessions where user_id=$1',[uid])).rows[0].n,0);
 await api('admin.ban',{user_id:uid,reason:'test'},admin);
 assert.equal((await login({terms_accepted:true,terms_version:version})).error,'invalid_credentials');
 await api('admin.unban',{user_id:uid},admin);
 const first=await login({terms_accepted:true,terms_version:version});assert.ok(first.user);assert.equal(first.terms.version,version);
 const again=await login({terms_accepted:true,terms_version:version});assert.equal(again.terms.accepted_at,first.terms.accepted_at);
 assert.equal((await db.query('select count(*)::int as n from portal_private.terms_acceptances')).rows[0].n,1);
 const invalid=await api('user.submission.create',{title:'Test',engine:'other',version:'1',visibility:'draft',terms_version:version},first.hash);assert.equal(invalid.error,'terms_required');
 const created=await api('user.submission.create',{title:'Test',engine:'other',version:'1',visibility:'draft',terms_version:version,rights_confirmed:'yes'},first.hash);assert.ok(created.submission);
 assert.equal((await db.query('select terms_version from portal_private.submission_confirmations')).rows[0].terms_version,version);
 await db.exec("update portal_private.policy_versions set is_current=false;insert into portal_private.policy_versions values('terms','2027-04-01','2027-04-01',true);delete from portal_private.login_limits;");
 assert.ok((await api('user.me',{},first.hash)).user,'existing session stays valid');
 assert.equal((await login({terms_accepted:true,terms_version:version})).error,'terms_outdated');
 assert.ok((await login({terms_accepted:true,terms_version:'2027-04-01'})).user);
 assert.equal((await db.query('select count(*)::int as n from portal_private.terms_acceptances')).rows[0].n,2);
 assert.ok((await api('admin.login',{username:'terms_owner',password},null,token())).admin);
 await db.query('delete from portal_private.game_submissions where id=$1',[created.submission.id]);
 await db.query('delete from portal_private.sessions where user_id=$1',[uid]);
 await db.query('delete from portal_private.user_passwords where user_id=$1',[uid]);
 await db.query('delete from portal_private.users where id=$1',[uid]);
 assert.equal((await db.query('select count(*)::int as n from portal_private.terms_acceptances')).rows[0].n,0);
});
test('policy and evidence are private and the active policy is unique',async()=>{
 for(const role of ['anon','authenticated','service_role']) {
  await db.exec(`set role ${role}`);
  for(const table of ['policy_versions','terms_acceptances','submission_confirmations','game_reports']) await assert.rejects(db.query(`select * from portal_private.${table}`),/permission denied/);
  await assert.rejects(db.query("select public.portal_api_before_terms('user.login')"),/permission denied/);
  await db.exec('reset role');
 }
 await assert.rejects(db.exec("insert into portal_private.policy_versions values('terms','duplicate','2027-04-01',true)"),/unique/);
 const cols=(await db.query("select column_name from information_schema.columns where table_schema='portal_private' and table_name='terms_acceptances' order by ordinal_position")).rows.map(r=>r.column_name);
 assert.deepEqual(cols,['user_id','terms_version','accepted_at']);
});
test('reports validate targets and content, require admin for moderation and audit only response status',async()=>{
 const report=await api('report.create',{game_id:'scratch-demo',category:'rights',detail:'Test report'});assert.ok(report.report_id);
 assert.equal((await api('report.create',{game_id:'unknown',category:'rights',detail:'test'})).error,'not_found');
 assert.equal((await api('report.create',{game_id:'a'.repeat(36),category:'rights',detail:'test'})).error,'not_found');
 for(const body of [{category:'invalid',detail:'test'},{category:'rights',detail:''},{category:'rights',detail:'x'.repeat(1001)}])assert.equal((await api('report.create',{game_id:'scratch-demo',...body})).error,'invalid_request');
 assert.equal((await api('admin.reports')).error,'unauthorized');
 const list=await api('admin.reports',{},admin);assert.equal(list.reports[0].game_id,'scratch-demo');
 assert.ok((await api('admin.report.update',{report_id:report.report_id,status:'resolved'},admin)).ok);
 assert.equal((await api('admin.reports',{},admin)).reports.length,0);
 const audit=(await api('admin.audit',{},admin)).events.find(e=>e.action==='admin.report.update');assert.ok(audit);assert.ok(!JSON.stringify(audit).includes('Test report'));
});
test('HTTP body permits only the dedicated consent boolean',async()=>{
 const request=data=>new Request('https://test.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'user.login',data})});
 assert.equal((await readBody(request({terms_accepted:true}))).data.terms_accepted,true);
 await assert.rejects(readBody(request({is_admin:true})),/invalid_request/);
 await assert.rejects(readBody(request({terms_accepted:'true'})),/invalid_request/);
});

test('shared game reporting requires its existing sharing authorization and links the submission',async()=>{
 const current=(await api('policy.current')).terms.version;
 const user=(await api('admin.create',{username:'report_owner',password,role:'uploader'},admin)).user;
 const signed=await login({terms_accepted:true,terms_version:current},'report_owner');assert.ok(signed.user);
 assert.equal((await api('admin.reports',{},signed.hash)).error,'forbidden');
 const created=await api('user.submission.create',{title:'Report sharing',engine:'other',version:'1',visibility:'draft',terms_version:current,rights_confirmed:'yes'},signed.hash);
 const sid=created.submission.id;
 const slug=(await db.query('select public_slug from portal_private.game_submissions where id=$1',[sid])).rows[0].public_slug;
 const body={game_id:slug,category:'other',detail:'Shared report'};
 assert.equal((await api('report.create',body,signed.hash)).error,'not_found','draft is not reportable');
 await db.query("update portal_private.game_submissions set status='approved',visibility='shared',package_storage_key='test.zip' where id=$1",[sid]);
 assert.equal((await api('report.create',body)).error,'not_found');
 const report=await api('report.create',body,signed.hash);assert.ok(report.report_id);
 assert.equal((await db.query('select submission_id from portal_private.game_reports where id=$1',[report.report_id])).rows[0].submission_id,sid);
 await api('admin.kick',{user_id:user.id},admin);
 assert.equal((await api('report.create',body,signed.hash)).error,'not_found');
});
