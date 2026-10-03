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
test('users can update only their own safe display profile', async () => {
  const changed = await api('user.profile', { display_name: 'Alice Player', avatar_key: 'rocket' }, userToken);
  assert.equal(changed.user.display_name, 'Alice Player');
  assert.equal(changed.user.avatar_key, 'rocket');
  assert.equal((await api('user.me', {}, userToken)).user.display_name, 'Alice Player');
  await assert.rejects(api('user.profile', { display_name: '   ', avatar_key: 'rocket' }, userToken), /display name/);
  await assert.rejects(api('user.profile', { display_name: 'Alice', avatar_key: 'https://example.test/icon.png' }, userToken), /avatar key/);
  assert.equal((await api('user.profile', { display_name: 'Alice', avatar_key: 'star' }, adminToken)).error, 'forbidden');
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

test('private game submission metadata hides Drive identifiers from users', async () => {
  const created = await api('admin.create', { username: 'submitter', password: 'submitter-password', role: 'uploader' }, adminToken);
  await db.exec("update portal_private.login_limits set window_start=now()-interval '16 minutes' where key='user.login:global'");
  const session = await login('submitter', 'submitter-password');
  const made = await api('user.submission.create', { title: 'Private ZIP', engine: 'godot', description: 'test', version: '1.0', controls: '' }, session.hash);
  assert.equal(made.submission.status, 'uploading');
  assert.equal((await api('user.submission.prepare', { submission_id: made.submission.id }, session.hash)).submission_id, made.submission.id);
  const completed = await api('user.submission.complete', { submission_id: made.submission.id, drive_file_id: 'private-drive-file-id', package_name: 'game.zip', package_size: '100' }, session.hash);
  assert.equal(completed.submission.status, 'pending');
  const adminList = await api('admin.submissions', {}, adminToken);
  assert.equal(adminList.submissions.find(item => item.id === made.submission.id).drive_file_id, undefined);
  const prepared = await api('admin.submission.prepare', { submission_id: made.submission.id }, adminToken);
  assert.equal(prepared.submission.drive_file_id, 'private-drive-file-id');
  const reviewed = await api('admin.submission.complete', { submission_id: made.submission.id, status: 'approved', reason: 'checked', package_storage_key: 'test.zip' }, adminToken);
  assert.equal(reviewed.submission.status, 'approved');
  const metadata = await api('user.submission.update', { submission_id: made.submission.id, title: 'Updated after approval', engine: 'godot', description: 'new text', version: '1.1', controls: 'arrows' }, session.hash);
  assert.equal(metadata.submission.status, 'approved');
  assert.equal(metadata.submission.title, 'Updated after approval');
  assert.equal(metadata.submission.package_ready, true);
  const listed = await api('user.submissions', {}, session.hash);
  assert.equal(listed.submissions[0].drive_file_id, undefined);
  const { rows } = await db.query('select drive_file_id from portal_private.game_submissions where id=$1', [made.submission.id]);
  assert.equal(rows[0].drive_file_id, 'private-drive-file-id');
  assert.notEqual(created.user.id, uid);
});

test('submitters can manage only their own pending and rejected game metadata', async () => {
  const created = await api('admin.create', { username: 'manager_user', password: 'manager-password', role: 'uploader' }, adminToken);
  const owner = await login('manager_user', 'manager-password');
  const made = await api('user.submission.create', { title: 'Original', engine: 'godot', description: '', version: '1.0.0', controls: '' }, owner.hash);
  const updated = await api('user.submission.update', { submission_id: made.submission.id, title: 'Updated', engine: 'scratch', description: 'edited', version: '1.0.1', controls: 'keys' }, owner.hash);
  assert.equal(updated.submission.title, 'Updated');
  assert.equal(updated.submission.engine, 'scratch');
  await api('admin.create', { username: 'manager_other', password: 'other-manager-password', role: 'uploader' }, adminToken);
  const other = await login('manager_other', 'other-manager-password');
  assert.equal((await api('user.submission.update', { submission_id: made.submission.id, title: 'Nope', engine: 'other', description: '', version: '2', controls: '' }, other.hash)).error, 'not_found');
  await db.query("update portal_private.game_submissions set status='rejected', drive_file_id='manager-file' where id=$1", [made.submission.id]);
  const resubmitted = await api('user.submission.update', { submission_id: made.submission.id, title: 'Fixed', engine: 'godot', description: '', version: '1.0.2', controls: '' }, owner.hash);
  assert.equal(resubmitted.submission.status, 'pending');
  const withdrawn = await api('user.submission.withdraw', { submission_id: made.submission.id }, owner.hash);
  assert.equal(withdrawn.submission.status, 'unpublished');
  assert.equal((await api('user.submission.update', { submission_id: made.submission.id, title: 'Again', engine: 'godot', description: '', version: '3', controls: '' }, owner.hash)).error, 'conflict');
  assert.notEqual(created.user.id, uid);
});
test('super admins can create review admins and trusted uploaders skip only the review queue', async () => {
  const reviewer = await api('admin.admin.create', { username: 'reviewer', password: 'reviewer-password' }, adminToken);
  assert.equal(reviewer.admin.role, 'admin');
  const reviewerSession = await login('reviewer', 'reviewer-password', true);
  assert.equal(reviewerSession.admin.role, 'admin');
  assert.equal((await api('admin.admin.create', { username: 'forbidden_admin', password: 'forbidden-password' }, reviewerSession.hash)).error, 'forbidden');
  const trusted = await api('admin.create', { username: 'trusted_submitter', password: 'trusted-password', role: 'trusted_uploader' }, adminToken);
  const trustedSession = await login('trusted_submitter', 'trusted-password');
  const made = await api('user.submission.create', { title: 'Trusted game', engine: 'godot', description: '', version: '1.0.0', controls: '' }, trustedSession.hash);
  const complete = await api('user.submission.complete', { submission_id: made.submission.id, drive_file_id: 'trusted-file', package_name: 'trusted.zip', package_size: '100' }, trustedSession.hash);
  assert.equal(complete.submission.status, 'approved');
  assert.equal((await api('admin.role', { user_id: trusted.user.id, role: 'trusted_uploader' }, reviewerSession.hash)).error, 'forbidden');
});
test('drafts bypass review, unlisted links stay out of catalog, and future releases are gated', async () => {
  await api('admin.create', { username: 'publisher', password: 'publisher-password', role: 'uploader' }, adminToken);
  const owner = await login('publisher', 'publisher-password');
  const made = await api('user.submission.create', { title: 'Scheduled game', engine: 'godot', version: '1.0', visibility: 'draft' }, owner.hash);
  const id = made.submission.id, slug = made.submission.public_slug;
  const completed = await api('user.submission.complete', { submission_id: id, drive_file_id: 'draft-drive', package_name: 'game.zip', package_size: '100', package_storage_key: `${id}.zip` }, owner.hash);
  assert.equal(completed.submission.status, 'draft');
  assert.equal((await api('admin.submissions', {}, adminToken)).submissions.some(item => item.id === id), false);
  assert.equal((await api('user.submission.preview', { submission_id: id }, owner.hash)).submission.drive_file_id, 'draft-drive');
  const future = new Date(Date.now() + 86400000).toISOString();
  const unlisted = await api('user.submission.visibility', { submission_id: id, visibility: 'unlisted', published_at: future }, owner.hash);
  assert.equal(unlisted.submission.status, 'pending');
  const reviewed = await api('admin.submission.complete', { submission_id: id, status: 'approved', package_storage_key: `${id}.zip` }, adminToken);
  assert.equal(reviewed.submission.status, 'approved');
  assert.equal((await db.query('select public.portal_public_game($1) as game', [slug])).rows[0].game, null);
  await api('user.submission.visibility', { submission_id: id, visibility: 'public', published_at: '' }, owner.hash);
  const publicGame = (await db.query('select public.portal_public_game($1) as game', [slug])).rows[0].game;
  assert.equal(publicGame.title, 'Scheduled game');
  assert.ok((await db.query('select public.portal_catalog() as games')).rows[0].games.some(game => game.slug === slug));
  await api('user.submission.visibility', { submission_id: id, visibility: 'unlisted', published_at: '' }, owner.hash);
  assert.equal((await db.query('select public.portal_catalog() as games')).rows[0].games.some(game => game.slug === slug), false);
  assert.equal((await db.query('select public.portal_public_game($1) as game', [slug])).rows[0].game.slug, slug);
  await api('user.submission.visibility', { submission_id: id, visibility: 'draft', published_at: '' }, owner.hash);
  assert.equal((await db.query('select public.portal_public_game($1) as game', [slug])).rows[0].game, null);
  await api('user.submission.visibility', { submission_id: id, visibility: 'public', published_at: '' }, owner.hash);
  assert.equal((await api('admin.submission.unpublish', { submission_id: id, reason: 'moderation' }, adminToken)).submission.status, 'unpublished');
  assert.equal((await db.query('select public.portal_public_game($1) as game', [slug])).rows[0].game, null);
});
test('only an active owner can delete a game; deletion removes every listing and preserves cleanup work', async () => {
  await api('admin.create', { username: 'delete_owner', password: 'delete-password', role: 'uploader' }, adminToken);
  const owner = await login('delete_owner', 'delete-password');
  const other = await login('manager_other', 'other-manager-password');
  for (const status of ['uploading','draft','pending','approved','rejected','unpublished']) {
    const made = await api('user.submission.create', { title: `Delete ${status}`, engine: 'other', version: '1' }, owner.hash);
    const id = made.submission.id;
    await db.query('update portal_private.game_submissions set status=$2,package_storage_key=$3,drive_file_id=$4 where id=$1', [id,status,`${id}.zip`,`${id}-drive`]);
    const data = { submission_id: id, title: made.submission.title, confirmation: 'delete' };
    assert.equal((await api('user.submission.delete', data, other.hash)).error, 'not_found');
    assert.equal((await api('user.submission.delete', { ...data, confirmation: '' }, owner.hash)).error, 'invalid_request');
    assert.equal((await api('user.submission.delete', { ...data, title: 'stale title' }, owner.hash)).error, 'conflict');
    assert.deepEqual(await api('user.submission.delete', data, owner.hash), { deleted: true });
    assert.equal((await api('user.submissions', {}, owner.hash)).submissions.some(s => s.id === id), false);
    assert.equal((await api('admin.submissions', {}, adminToken)).submissions.some(s => s.id === id), false);
    assert.equal((await db.query('select public.portal_public_game($1) as game', [made.submission.public_slug])).rows[0].game, null);
    assert.equal((await db.query('select public.portal_catalog() as games')).rows[0].games.some(g => g.slug === made.submission.public_slug), false);
    assert.equal((await api('user.submission.preview', { submission_id: id }, owner.hash)).error, 'not_found');
    assert.deepEqual(await api('user.submission.delete', data, owner.hash), { deleted: true });
    const cleanup = (await db.query('select public.portal_submission_cleanup($1) as files', [id])).rows[0].files;
    assert.equal(cleanup.drive_file_id, `${id}-drive`);
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      try { await assert.rejects(db.query('select public.portal_submission_cleanup($1)', [id]), /permission denied/); }
      finally { await db.exec('reset role'); }
    }
    await db.query('select public.portal_submission_cleanup($1,true)', [id]);
    assert.equal((await api('user.submission.delete', data, owner.hash)).error, 'not_found');
  }
  const made = await api('user.submission.create', { title: 'Keep banned game', engine: 'other', version: '1' }, owner.hash);
  await api('admin.ban', { user_id: owner.user.id, reason: 'test' }, adminToken);
  assert.equal((await api('user.submission.delete', { submission_id: made.submission.id, title: made.submission.title, confirmation: 'delete' }, owner.hash)).error, 'unauthorized');
  assert.equal((await db.query('select id from portal_private.game_submissions where id=$1', [made.submission.id])).rows.length, 1);
});

test('expired and deactivated admin sessions cannot perform management', async () => {
  const next = await login('owner', adminPassword, true);
  await db.query("update portal_private.sessions set expires_at=now()-interval '1 second' where token_hash=$1", [next.hash]);
  assert.equal((await api('admin.users', {}, next.hash)).error, 'unauthorized');
  await db.exec('update portal_private.admin_users set active=false');
  assert.equal((await api('admin.users', {}, adminToken)).error, 'unauthorized');
  assert.equal((await login('owner', adminPassword, true)).error, 'invalid_credentials');
});
