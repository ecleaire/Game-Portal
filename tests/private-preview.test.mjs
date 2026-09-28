import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { unpackPrivateZip } from '../assets/private-preview.js';

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
  await assert.rejects(unpackPrivateZip(archive('other.html', '<h1>bad</h1>')), /invalid_preview/);
});
