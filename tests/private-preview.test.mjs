import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { checkWebGameZip, unpackPrivateZip } from '../assets/private-preview.js';

function archive(name, content, compress = false) {
  const filename = Buffer.from(name), body = Buffer.from(content), packed = compress ? deflateRawSync(body) : body;
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
  local.writeUInt16LE(compress ? 8 : 0, 8); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6); central.writeUInt16LE(compress ? 8 : 0, 10);
  central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(body.length, 24); central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12);
  end.writeUInt32LE(local.length + filename.length + packed.length, 16);
  return Buffer.concat([local, filename, packed, central, filename, end]);
}

test('private ZIP preview unpacks stored and deflated HTML with size checks', async () => {
  for (const compressed of [false, true]) {
    const files = await unpackPrivateZip(archive('index.html', '<h1>Private game</h1>', compressed));
    assert.equal(new TextDecoder().decode(files.get('index.html')), '<h1>Private game</h1>');
  }
  await assert.rejects(unpackPrivateZip(archive('../index.html', '<h1>bad</h1>')), /invalid_preview/);
  const named = await unpackPrivateZip(archive('test1/jump.html', '<h1>Game</h1>'));
  assert.equal(new TextDecoder().decode(named.get('index.html')), '<h1>Game</h1>');
});

test('submission rejects Godot PCK/ZIP exports before creating a record', async () => {
  const packageOnly = new File([archive('jumpmaster.pck', 'game')], 'jumpmaster.zip');
  await assert.rejects(checkWebGameZip(packageOnly), /web_export_required/);
  const webExport = new File([archive('index.html', '<h1>Game</h1>')], 'jumpmaster-web.zip');
  await assert.doesNotReject(checkWebGameZip(webExport));
  const customName = new File([archive('test1/jump.html', '<h1>Game</h1>')], 'test1.zip');
  await assert.doesNotReject(checkWebGameZip(customName));
});

function multiArchive(entries) {
  const locals = [], directory = []; let offset = 0;
  for (const [name, content, compressed] of entries) {
    const zip = archive(name, content, compressed);
    const start = zip.readUInt32LE(zip.length - 6);
    const local = zip.subarray(0, start);
    const central = Buffer.from(zip.subarray(start, zip.length - 22));
    central.writeUInt32LE(offset, 42); offset += local.length;
    locals.push(local); directory.push(central);
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

test('bounded parallel ZIP extraction preserves mixed file contents and rejects invalid entries', async () => {
  const entries = [['web/jump.html', '<h1>Game</h1>', true],
    ...Array.from({length: 9}, (_, i) => [`web/asset${i}.pck`, `binary-${i}-`.repeat(4096), i % 2 === 0])];
  const files = await unpackPrivateZip(multiArchive(entries));
  for (const [name, content] of entries) assert.equal(new TextDecoder().decode(files.get(name.slice(4))), content);
  assert.equal(files.get('index.html'), files.get('jump.html'));
  await assert.rejects(unpackPrivateZip(multiArchive([...entries, entries[1]])), /invalid_preview/);
  await assert.rejects(unpackPrivateZip(multiArchive([...entries, ['../bad.js', 'bad', true]])), /invalid_preview/);
  const mismatched = multiArchive([['index.html', '<h1>Game</h1>', false]]);
  const central = mismatched.readUInt32LE(mismatched.length - 6);
  mismatched.writeUInt32LE(1, central + 24);
  await assert.rejects(unpackPrivateZip(mismatched), /invalid_preview/);
});
