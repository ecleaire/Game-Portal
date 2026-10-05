import test from 'node:test';
import assert from 'node:assert/strict';
import { sendUpload, uploadWithRecovery } from '../assets/upload-request.js';

function fakeRequest(send) {
  return { upload: {}, open() {}, setRequestHeader() {}, abort() { this.aborted = true; this.onabort?.(); }, send() { send?.(this); } };
}
test('upload distinguishes transfer progress from successful server completion', async () => {
  const progress = [];
  const result = await sendUpload('https://example.invalid/upload', {
    body: '', headers: {}, onProgress: value => progress.push(value), createRequest: () => fakeRequest(request => {
      request.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 });
      request.upload.onload();
      request.status = 200; request.responseText = JSON.stringify({ submission: { id: 'game' } }); request.onload();
    }),
  });
  assert.deepEqual(progress, [50, 100]); assert.equal(result.submission.id, 'game');
});
test('a stalled upload ends, aborts the connection and permits a retry', async () => {
  const request = fakeRequest();
  await assert.rejects(sendUpload('https://example.invalid/upload', { body: '', headers: {}, timeout: 10, createRequest: () => request }), /upload_timeout/);
  assert.equal(request.aborted, true);
});
test('invalid server responses and network failures do not claim success', async () => {
  for (const mode of ['invalid', 'network', 'drive']) {
    await assert.rejects(sendUpload('https://example.invalid/upload', { body: '', headers: {}, createRequest: () => fakeRequest(request => {
      if (mode === 'network') return request.onerror();
      request.status = mode === 'drive' ? 503 : 200;
      request.responseText = mode === 'invalid' ? '<html>gateway failure</html>' : '{"error":"drive_reconnect_required"}'; request.onload();
    }) }), new RegExp(mode === 'invalid' ? 'upload_response' : mode === 'network' ? 'upload_network' : 'drive_reconnect_required'));
  }
});
test('a lost success response is recovered only for the exact completed submission', async () => {
  const send = async () => { throw new Error('upload_timeout'); };
  const saved = { id: 'game', package_ready: true, status: 'draft' };
  assert.deepEqual(await uploadWithRecovery(send, async () => ({ submissions: [saved] }), 'game'), saved);
  for (const submissions of [[{ ...saved, id: 'other' }], [{ ...saved, status: 'uploading' }], [{ ...saved, package_ready: false }]]) {
    await assert.rejects(uploadWithRecovery(send, async () => ({ submissions }), 'game'), /upload_timeout/);
  }
  await assert.rejects(uploadWithRecovery(send, async () => { throw new Error('unavailable'); }, 'game'), /upload_timeout/);
});

test('replacement recovery requires the new revision, never the old ready package', async()=>{
 const send=async()=>{throw new Error('upload_timeout')};const old={id:'game',package_ready:true,status:'approved',package_revision:'old'};
 await assert.rejects(uploadWithRecovery(send,async()=>({submissions:[old]}),'game','new'),/upload_timeout/);
 const saved={...old,package_revision:'new',status:'pending'};
 assert.deepEqual(await uploadWithRecovery(send,async()=>({submissions:[saved]}),'game','new'),saved);
});
