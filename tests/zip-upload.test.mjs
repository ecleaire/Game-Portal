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
