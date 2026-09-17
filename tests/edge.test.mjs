import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/portal/handler.mjs';
import { digest, token } from '../supabase/functions/portal/security.mjs';
import { validateZip } from '../supabase/functions/portal/drive.mjs';

const settings = { url: 'https://example.supabase.co', serviceKey: 'server-test-key', pepper: 'test-only-pepper'.repeat(3), allowedOrigins: 'https://ecleaire.github.io' };
function zip(name = 'index.html', mode = 0) {
  const encoded = Buffer.from(name); const data = Buffer.from('<');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(1, 18); local.writeUInt32LE(1, 22); local.writeUInt16LE(encoded.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(1, 20); central.writeUInt32LE(1, 24); central.writeUInt16LE(encoded.length, 28); central.writeUInt32LE(mode, 38);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + encoded.length, 12); end.writeUInt32LE(local.length + encoded.length + data.length, 16);
  return new Uint8Array(Buffer.concat([local, encoded, data, central, encoded, end]));
}
function request(body, headers = {}, method = 'POST') {
  return new Request('https://example.supabase.co/functions/v1/portal', { method,
    headers: { origin: settings.allowedOrigins, 'content-type': 'application/json', ...headers },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
}
test('256-bit random tokens and keyed one-way digest', async () => {
  const first = token(); assert.match(first, /^[a-f0-9]{64}$/); assert.notEqual(first, token());
  const hashed = await digest(first, settings.pepper);
  assert.notEqual(hashed, first); assert.equal(hashed, await digest(first, settings.pepper));
  assert.notEqual(hashed, await digest(first, 'another-pepper'));
});
test('login sends only token hash to DB; server credential stays on server', async () => {
  let sent;
  const handler = createHandler({ ...settings, fetcher: async (_url, options) => {
    sent = JSON.parse(options.body); assert.equal(options.headers.apikey, settings.serviceKey);
    return Response.json({ user: { username: 'alice' }, expires_at: 'test' });
  } });
  const response = await handler(request({ action: 'user.login', data: { username: 'alice', password: 'test-only-password' } }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const result = await response.json();
  assert.equal(sent.p_new_token_hash, await digest(result.token, settings.pepper));
  assert.notEqual(sent.p_new_token_hash, result.token);
  assert.ok(!JSON.stringify(result).includes(settings.serviceKey));
});
test('CORS, methods, size, malformed input and missing sessions fail before database calls', async () => {
  let calls = 0;
  const handler = createHandler({ ...settings, fetcher: async () => { calls++; throw new Error(); } });
  assert.equal((await handler(request({}, { origin: 'https://evil.example' }))).status, 403);
  assert.equal((await handler(request(null, {}, 'OPTIONS'))).status, 204);
  assert.equal((await handler(request(null, {}, 'GET'))).status, 405);
  assert.equal((await handler(request('x'.repeat(8200)))).status, 413);
  for (const body of ['{', 'null', '[]', { action: 'bootstrap' }, { action: 'admin.users', data: [] }, { action: 'admin.users', data: { offset: -1 } }]) {
    assert.equal((await handler(request(body))).status, 400);
  }
  assert.equal((await handler(request({ action: 'user.submission.complete', data: {} }, { 'x-portal-session': token() }))).status, 400);
  assert.equal((await handler(request({ action: 'admin.submission.prepare', data: {} }, { 'x-portal-session': token() }))).status, 400);
  assert.equal((await handler(request({ action: 'admin.users' }))).status, 401);
  assert.equal(calls, 0);
});
test('ZIP validation permits a normal web archive and rejects traversal or symlinks', () => {
  assert.doesNotThrow(() => validateZip(zip()));
  assert.throws(() => validateZip(zip('../index.html')), /invalid_upload/);
  assert.throws(() => validateZip(zip('index.html', 0xa0000000)), /invalid_upload/);
});
test('private ZIP upload requires an authenticated session and server-only Drive configuration', async () => {
  const form = new FormData(); form.set('submission_id', crypto.randomUUID()); form.set('package', new Blob(['PK\x03\x04zip'], { type: 'application/zip' }), 'game.zip');
  const requestUpload = headers => new Request('https://example.supabase.co/functions/v1/portal/upload', { method: 'POST', headers: { origin: settings.allowedOrigins, ...headers }, body: form });
  const handler = createHandler({ ...settings, fetcher: async () => { throw new Error('must not call database'); } });
  assert.equal((await handler(requestUpload())).status, 401);
  assert.equal((await handler(requestUpload({ 'x-portal-session': token() }))).status, 503);
});
test('revoked sessions and DB errors are sanitized; secrets are never reflected', async () => {
  for (const [databaseResult, upstreamStatus, expected] of [
    [{ error: 'unauthorized' }, 200, 401], [{ error: 'rate_limited' }, 200, 429],
    [{ code: '23505', details: 'sensitive' }, 400, 409], [{ code: 'XX000', details: settings.serviceKey }, 500, 503],
  ]) {
    const handler = createHandler({ ...settings, fetcher: async () => Response.json(databaseResult, { status: upstreamStatus }) });
    const response = await handler(request({ action: 'admin.users' }, { 'x-portal-session': token() }));
    assert.equal(response.status, expected);
    const result = await response.json(); assert.deepEqual(Object.keys(result), ['error']);
  }
});
test('missing configuration fails closed and network failures return no internals', async () => {
  const noPepper = createHandler({ ...settings, pepper: '' });
  assert.equal((await noPepper(request({ action: 'user.login' }))).status, 503);
  const unavailable = createHandler({ ...settings, fetcher: async () => { throw new Error(settings.serviceKey); } });
  const response = await unavailable(request({ action: 'user.login' }));
  assert.deepEqual(await response.json(), { error: 'unavailable' });
});
