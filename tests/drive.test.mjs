import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessToken, checkPrivateFolders, movePrivateZip, downloadPrivateZip, storePrivateZip, driveError } from '../supabase/functions/portal/drive.mjs';
import { createHandler } from '../supabase/functions/portal/handler.mjs';
import { token } from '../supabase/functions/portal/security.mjs';

const oauthJson = JSON.stringify({ client_id: 'test-client', client_secret: 'test-secret', refresh_token: 'test-refresh' });
const folderIds = ['pending-test', 'approved-test', 'rejected-test'];
const folderResult = (extra = {}) => ({ mimeType: 'application/vnd.google-apps.folder', capabilities: { canAddChildren: true, canRemoveChildren: true }, ...extra });
function zip() {
  const name = Buffer.from('index.html');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt32LE(1, 18); local.writeUInt32LE(1, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt32LE(1, 20); central.writeUInt32LE(1, 24); central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + 1, 16);
  return new File([local, name, '<', central, name, end], 'test.zip');
}

test('owner OAuth refresh takes precedence and does not fall back after revocation', async () => {
  const access = await accessToken('invalid-service-account', async (url, options) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(options.body.get('grant_type'), 'refresh_token');
    assert.equal(options.body.get('refresh_token'), 'test-refresh');
    return Response.json({ access_token: 'short-lived-test' });
  }, oauthJson);
  assert.equal(access, 'short-lived-test');
  await assert.rejects(accessToken('{}', async () => Response.json({ error: 'invalid_grant', detail: 'do not reflect' }, { status: 400 }), oauthJson), /drive_reconnect_required/);
});

test('folder health accepts owner My Drive but rejects write denial and mixed shared drives', async () => {
  const fetcher = extra => async url => url.includes('oauth2.googleapis.com')
    ? Response.json({ access_token: 'test-access' }) : Response.json(folderResult(extra));
  await checkPrivateFolders({ oauthJson, folderIds, fetcher: fetcher({}) });
  await assert.rejects(checkPrivateFolders({ oauthJson, folderIds, fetcher: fetcher({ capabilities: { canAddChildren: false } }) }), /drive_permission_denied/);
  await assert.rejects(checkPrivateFolders({ oauthJson, folderIds: ['duplicate', 'duplicate', 'third'], fetcher: fetcher({}) }), /drive_unavailable/);
  await assert.rejects(checkPrivateFolders({ oauthJson, folderIds, fetcher: async url => {
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'test-access' });
    return Response.json(folderResult({ driveId: url.includes('pending-test') ? 'first-drive' : 'second-drive' }));
  } }), /drive_unavailable/);
});

test('service account folder health detects unsupported My Drive rather than claiming upload works', async () => {
  const key = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const private_key = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await crypto.subtle.exportKey('pkcs8', key.privateKey)).toString('base64')}\n-----END PRIVATE KEY-----`;
  const serviceAccountJson = JSON.stringify({ client_email: 'test@example.invalid', private_key });
  const fetcher = driveId => async url => url.includes('oauth2.googleapis.com')
    ? Response.json({ access_token: 'test-access' }) : Response.json(folderResult({ ...(driveId ? { driveId } : {}) }));
  await assert.rejects(checkPrivateFolders({ serviceAccountJson, folderIds, fetcher: fetcher() }), /drive_shared_drive_required/);
  await checkPrivateFolders({ serviceAccountJson, folderIds, fetcher: fetcher('same-drive') });
});

test('upload, review move and download support shared drives; errors expose stable codes only', async () => {
  let operation;
  const fetcher = async (url, options) => {
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'test-access' });
    assert.equal(new URL(url).searchParams.get('supportsAllDrives'), 'true');
    assert.equal(options.headers.Authorization, 'Bearer test-access');
    assert.ok(options.signal instanceof AbortSignal);
    operation = { url, options };
    return new URL(url).searchParams.has('alt') ? new Response('zip-content') : Response.json({ id: 'private-test-id' });
  };
  const stored = await storePrivateZip({ oauthJson, pendingFolderId: folderIds[0], submissionId: 'test-submission', file: zip(), fetcher });
  assert.equal(stored.id, 'private-test-id');
  assert.equal(operation.options.method, 'POST');
  await movePrivateZip({ oauthJson, fileId: stored.id, fromFolderId: folderIds[0], toFolderId: folderIds[1], fetcher });
  assert.equal(operation.options.method, 'PATCH');
  assert.equal(await (await downloadPrivateZip({ oauthJson, fileId: stored.id, fetcher })).text(), 'zip-content');
  await assert.rejects(storePrivateZip({ oauthJson, pendingFolderId: folderIds[0], submissionId: 'test', file: zip(), fetcher: async url => url.includes('oauth2.googleapis.com')
    ? Response.json({ access_token: 'test-access' }) : Response.json({ error: { errors: [{ reason: 'storageQuotaExceeded' }], message: 'secret-detail' } }, { status: 403 }) }), /drive_quota_exceeded/);
  assert.equal(driveError(new Error('secret-detail')), 'drive_unavailable');
});

test('production upload boundary completes a trusted upload using server-only owner OAuth', async () => {
  const calls = [];
  const handler = createHandler({ url: 'https://test.supabase.co', serviceKey: 'server-test', pepper: 'test-pepper'.repeat(4), allowedOrigins: 'https://ecleaire.github.io',
    googleDriveOAuthJson: oauthJson, googlePendingFolderId: folderIds[0], fetcher: async (url, options) => {
      if (url.includes('/rpc/')) {
        const action = JSON.parse(options.body).p_action; calls.push(action);
        return Response.json(action === 'user.submission.complete' ? { submission: { status: 'approved' } } : { ok: true });
      }
      if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'test-access' });
      return Response.json({ id: 'private-test-id' });
    } });
  const form = new FormData(); form.set('submission_id', crypto.randomUUID()); form.set('package', zip());
  const result = await handler(new Request('https://test.supabase.co/functions/v1/portal/upload', { method: 'POST', headers: { origin: 'https://ecleaire.github.io', 'x-portal-session': token() }, body: form }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { submission: { status: 'approved' } });
  assert.deepEqual(calls, ['user.submission.prepare', 'user.submission.complete']);
});
