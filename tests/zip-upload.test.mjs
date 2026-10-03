import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packageWebFiles } from '../assets/zip-upload.js';
import { checkWebGameZip, unpackPrivateZip } from '../assets/private-preview.js';
import { validateZip } from '../supabase/functions/portal/drive.mjs';

test('multiple Web export files form a valid playable ZIP with original basenames', async () => {
  const packageFile = await packageWebFiles([
    new File(['<script src="jump.js"></script>'], 'jump.html'),
    new File(['game'], 'jump.js'), new File(['binary'], 'jump.pck'),
  ]);
  await checkWebGameZip(packageFile);
  validateZip(new Uint8Array(await packageFile.arrayBuffer()));
  const files = await unpackPrivateZip(await packageFile.arrayBuffer());
  assert.equal(new TextDecoder().decode(files.get('index.html')), '<script src="jump.js"></script>');
  assert.equal(new TextDecoder().decode(files.get('jump.pck')), 'binary');
});

test('large standalone HTML uses standard deflate and preserves the exact game contents', async () => {
  const html = '<!doctype html><html><body>' + 'game asset data '.repeat(10000) + '</body></html>';
  const file = await packageWebFiles([new File([html], 'my-game.html')]);
  const bytes = new Uint8Array(await file.arrayBuffer());
  assert.equal(new DataView(bytes.buffer).getUint16(8, true), 8);
  assert.ok(file.size < new TextEncoder().encode(html).length / 2);
  validateZip(bytes);
  const unpacked = await unpackPrivateZip(bytes.buffer);
  assert.equal(new TextDecoder().decode(unpacked.get('index.html')), html);
});
