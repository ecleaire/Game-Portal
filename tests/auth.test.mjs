import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { token } from '../supabase/functions/portal/security.mjs';

// Run the actual SQL migrations and bcrypt implementation, not a mocked repository.
let db, adminToken, uid, userToken;
const original = 'test-only-user-password';
const alternative = 'test-only-alternative';
const adminPassword = 'test-only-admin-password';
async function api(action, body = {}, hash = null, fresh = null) {
  const { rows } = await db.query('select public.portal_api($1,$2::jsonb,$3,$4) as result', [action, JSON.stringify(body), hash, fresh]);
  return rows[0].result;
}
async function login(username = 'alice', password = original, admin = false) {
  const hash = token();
  const result = await api(admin ? 'admin.login' : 'user.login', { username, password }, null, hash);
  return { hash, ...result };
}
async function manage(action, body = {}) { return api(action, { user_id: uid, ...body }, adminToken); }
before(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec('create role anon; create role authenticated; create role service_role;');
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
  await db.query('select public.portal_bootstrap($1,$2)', ['owner', adminPassword]);
  const admin = await login('owner', adminPassword, true);
  assert.ok(admin.admin); adminToken = admin.hash;
  const created = await api('admin.create', { username: ' Alice ', password: original, role: 'uploader' }, adminToken);
  uid = created.user.id;
});
after(async () => { await db?.close(); });

test('bootstrap is one-time and logs no credentials', async () => {
  await assert.rejects(db.query('select public.portal_bootstrap($1,$2)', ['second', adminPassword]), /already exists/);
  const log = await api('admin.audit', {}, adminToken);
  assert.ok(log.events.some(e => e.action === 'admin.bootstrap'));
  assert.ok(!JSON.stringify(log).includes(adminPassword));
});
test('anonymous and Supabase authenticated roles cannot call auth RPC or read private data', async () => {
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(api('admin.users'), /permission denied/);
      await assert.rejects(db.query('select public.portal_bootstrap($1,$2)', ['evil', adminPassword]), /permission denied/);
      await assert.rejects(db.query('select * from portal_private.users'), /permission denied/);
    } finally { await db.exec('reset role'); }
  }
  await db.exec('set role service_role');
  try {
    assert.ok((await api('admin.me', {}, adminToken)).admin);
    await assert.rejects(db.query('select * from portal_private.user_passwords'), /permission denied/);
  } finally { await db.exec('reset role'); }
});
test('normalization, login domains, generic failures, and hash-only storage', async () => {
  const user = await login(' ALICE ');
  assert.equal(user.user.username, 'alice'); userToken = user.hash;
  assert.equal((await login('owner', adminPassword)).error, 'invalid_credentials');
  assert.equal((await login('alice', original, true)).error, 'invalid_credentials');
  assert.equal((await login('missing', 'wrong')).error, 'invalid_credentials');
  assert.equal((await login('alice', 'wrong')).error, 'invalid_credentials');
  const { rows } = await db.query('select password_hash from portal_private.user_passwords');
  assert.match(rows[0].password_hash, /^\$2a\$12\$/);
  assert.ok(!rows[0].password_hash.includes(original));
  assert.ok(!JSON.stringify(user).includes('password_hash'));
});
test('user/admin sessions cannot cross authorization boundaries or spoof privileges', async () => {
  assert.equal((await api('admin.create', { role: 'super_admin' }, userToken)).error, 'forbidden');
  assert.equal((await api('user.me', {}, adminToken)).error, 'forbidden');
  assert.equal((await api('admin.users', { role: 'super_admin', admin_id: uid }, token())).error, 'unauthorized');
  await assert.rejects(manage('admin.role', { role: 'super_admin' }), /check constraint/);
  assert.equal((await api('user.me', {}, userToken)).user.role, 'uploader');
  const users = await api('admin.users', {}, adminToken);
  assert.equal(users.users[0].id, uid);
});
test('password validation, atomic failed creation and case-insensitive username uniqueness', async () => {
  await assert.rejects(api('admin.create', { username: 'bob', password: 'four' }, adminToken), /password/);
  assert.equal((await api('admin.users', {}, adminToken)).users.length, 1);
  const minimum = await api('admin.create', { username: 'five', password: 'short' }, adminToken);
  assert.equal(minimum.user.username, 'five');
  await assert.rejects(api('admin.create', { username: 'ALICE', password: original }, adminToken), /unique/);
  await assert.rejects(manage('admin.password.add', { password: 'あ'.repeat(25) }), /72/);
});
test('alternate passwords are admin-only metadata, and revocation kills their sessions', async () => {
  await manage('admin.password.add', { password: alternative, label: 'support' });
  const altLogin = await login('alice', alternative); assert.ok(altLogin.user);
  const own = await api('user.me', {}, altLogin.hash);
  assert.deepEqual(Object.keys(own), ['user']);
  assert.ok(!JSON.stringify(own).includes('support'));
  assert.equal((await api('admin.passwords', { user_id: uid }, altLogin.hash)).error, 'forbidden');
  const { passwords } = await manage('admin.passwords');
  assert.deepEqual(Object.keys(passwords[0]).sort(), ['created_at','id','label']);
  await manage('admin.password.revoke', { password_id: passwords[0].id });
  assert.equal((await api('user.me', {}, altLogin.hash)).error, 'unauthorized');
  assert.equal((await login('alice', alternative)).error, 'invalid_credentials');
  assert.ok((await api('user.me', {}, userToken)).user);
});
test('own password change preserves alternates, requires original password, revokes all sessions', async () => {
  await db.exec('delete from portal_private.login_limits');
  await manage('admin.password.add', { password: alternative });
  const alt = await login('alice', alternative);
  const changed = 'test-only-new-user-password';
  assert.equal((await api('user.password', { current_password: alternative, password: changed }, alt.hash)).error, 'invalid_credentials');
  assert.ok((await api('user.password', { current_password: original, password: changed }, userToken)).reauthenticate);
  assert.equal((await api('user.me', {}, userToken)).error, 'unauthorized');
  assert.equal((await api('user.me', {}, alt.hash)).error, 'unauthorized');
  assert.equal((await login()).error, 'invalid_credentials');
  const next = await login('alice', changed); assert.ok(next.user); userToken = next.hash;
  assert.ok((await login('alice', alternative)).user);
  const { rows } = await db.query("select count(*)::integer as n from portal_private.user_passwords where user_id=$1 and type='user' and revoked_at is null", [uid]);
  assert.equal(rows[0].n, 1);
});
test('KICK revokes every current session but allows a fresh login', async () => {
  await manage('admin.kick');
  assert.equal((await api('user.me', {}, userToken)).error, 'unauthorized');
  const next = await login('alice', alternative); assert.ok(next.user); userToken = next.hash;
});
test('permanent BAN blocks alternate login and old sessions remain invalid after unban', async () => {
  await manage('admin.ban', { reason: 'test moderation' });
  assert.equal((await api('user.rename', { username: 'bypass' }, userToken)).error, 'unauthorized');
  assert.equal((await login('alice', alternative)).error, 'invalid_credentials');
  await manage('admin.unban');
  assert.equal((await api('user.me', {}, userToken)).error, 'unauthorized');
  const next = await login('alice', alternative); assert.ok(next.user); userToken = next.hash;
});
test('temporary BAN expires without restoring old sessions; disable is independent', async () => {
  await db.exec('delete from portal_private.login_limits');
  await manage('admin.ban', { banned_until: new Date(Date.now() + 3600000).toISOString(), reason: 'temporary' });
  assert.equal((await login('alice', alternative)).error, 'invalid_credentials');
  // Advance moderation state in the fixture without waiting a real hour.
  await db.query("update portal_private.users set banned_until = now()-interval '1 second' where id=$1", [uid]);
  const next = await login('alice', alternative); assert.ok(next.user);
  assert.equal((await api('user.me', {}, userToken)).error, 'unauthorized');
  await manage('admin.disable');
  assert.equal((await api('user.me', {}, next.hash)).error, 'unauthorized');
  await manage('admin.unban');
  assert.equal((await login('alice', alternative)).error, 'invalid_credentials');
  await manage('admin.enable');
  assert.ok((await login('alice', alternative)).user);
  await assert.rejects(manage('admin.ban', { banned_until: '2000-01-01' }), /future/);
});
test('enable does not remove a permanent BAN', async () => {
  await manage('admin.ban'); await manage('admin.disable'); await manage('admin.enable');
  assert.equal((await login('alice', alternative)).error, 'invalid_credentials');
  await manage('admin.unban');
});
test('username change, expiry and logout', async () => {
  const next = await login('alice', alternative);
  await api('user.rename', { username: ' ALICE_2 ' }, next.hash);
  assert.equal((await api('user.me', {}, next.hash)).user.username, 'alice_2');
  await manage('admin.rename', { username: 'alice' });
  await db.query("update portal_private.sessions set expires_at=now()-interval '1 second' where token_hash=$1", [next.hash]);
  assert.equal((await api('user.me', {}, next.hash)).error, 'unauthorized');
  const logged = await login('alice', alternative);
  assert.ok((await api('logout', {}, logged.hash)).ok);
  assert.equal((await api('user.me', {}, logged.hash)).error, 'unauthorized');
});
test('failed login rate limits persist and expire', async () => {
  await db.exec('delete from portal_private.login_limits');
  await db.query("insert into portal_private.login_limits values('user.login:alice',now(),9)");
  assert.equal((await login('alice', 'bad')).error, 'invalid_credentials');
  assert.equal((await login('alice', alternative)).error, 'rate_limited');
  await db.exec("update portal_private.login_limits set window_start=now()-interval '16 minutes'");
  assert.ok((await login('alice', alternative)).user);
  await db.exec("update portal_private.login_limits set attempts=100 where key='user.login:global'");
  assert.equal((await login('nonexistent', 'bad')).error, 'rate_limited');
});
test('audit is append-only, mutations are attributed, never contains password inputs', async () => {
  const { events } = await api('admin.audit', {}, adminToken);
  for (const action of ['admin.create','admin.kick','admin.ban','admin.unban','admin.password.add','admin.password.revoke']) {
    assert.ok(events.some(event => event.action === action && event.target_id === uid && event.admin_id));
  }
  const log = JSON.stringify(events);
  for (const secret of [original, alternative, adminPassword, 'password_hash', '$2a$']) assert.ok(!log.includes(secret));
  await assert.rejects(db.exec('delete from portal_private.admin_audit_log'), /append-only/);
  await assert.rejects(db.exec("update portal_private.admin_audit_log set action='fake'"), /append-only/);
  await assert.rejects(db.exec('truncate portal_private.admin_audit_log'), /append-only/);
});

test('alternate cap, owner scoping and user-password deletion protection', async () => {
  const other = await api('admin.create', { username: 'other_user', password: original }, adminToken);
  const ownRow = (await db.query("select id from portal_private.user_passwords where user_id=$1 and type='user' and revoked_at is null", [uid])).rows[0];
  assert.equal((await manage('admin.password.revoke', { password_id: ownRow.id })).error, 'not_found');
  const altRow = (await manage('admin.passwords')).passwords[0];
  assert.equal((await api('admin.password.revoke', { user_id: other.user.id, password_id: altRow.id }, adminToken)).error, 'not_found');
  for (let i = 0; i < 4; i++) await manage('admin.password.add', { password: `test-extra-password-${i}` });
  assert.equal((await manage('admin.password.add', { password: 'test-extra-over-limit' })).error, 'password_limit');
  assert.equal((await manage('admin.passwords')).passwords.length, 5);
});

test('expired and deactivated admin sessions cannot perform management', async () => {
  const next = await login('owner', adminPassword, true);
  await db.query("update portal_private.sessions set expires_at=now()-interval '1 second' where token_hash=$1", [next.hash]);
  assert.equal((await api('admin.users', {}, next.hash)).error, 'unauthorized');
  await db.exec('update portal_private.admin_users set active=false');
  assert.equal((await api('admin.users', {}, adminToken)).error, 'unauthorized');
  assert.equal((await login('owner', adminPassword, true)).error, 'invalid_credentials');
});
