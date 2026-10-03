// Preserve exported filenames in a standard ZIP. Deflate reduces HTML/JS transfer
// size; server archive validation and isolated playback still run afterward.
const encoder = new TextEncoder();
const MAX_BYTES = 50 * 1024 * 1024;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let n = value;
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export async function packageWebFiles(files) {
  const selected = [...files];
  if (!selected.length || selected.length > 500) throw new Error('invalid_upload');
  if (selected.length === 1 && /\.zip$/i.test(selected[0].name)) return selected[0];
  if (selected.some(file => /\.zip$/i.test(file.name))) throw new Error('invalid_upload');
  const entries = [], names = new Set(); let size = 22;
  for (const file of selected) {
    const name = file.webkitRelativePath || file.name;
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(part => !part || part === '..' || part === '.') || names.has(name)) throw new Error('invalid_upload');
    const filename = encoder.encode(name);
    if (filename.length > 65535 || file.size > MAX_BYTES) throw new Error('invalid_upload');
    size += 30 + filename.length + file.size + 46 + filename.length;
    if (size > MAX_BYTES) throw new Error('invalid_upload');
    names.add(name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let packed = bytes, method = 0;
    if (bytes.length >= 256 && typeof CompressionStream === 'function') {
      // CompressionStream('deflate') includes a zlib header and Adler-32 trailer.
      // ZIP method 8 stores the raw deflate stream between them.
      const compressed = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
      if (compressed.length - 6 < bytes.length) { packed = compressed.subarray(2, compressed.length - 4); method = 8; }
    }
    entries.push({ filename, bytes, packed, method });
  }
  size = 22 + entries.reduce((sum, entry) => sum + 76 + entry.filename.length * 2 + entry.packed.length, 0);
  const output = new Uint8Array(size); const view = new DataView(output.buffer);
  let cursor = 0; const directory = [];
  for (const { filename, bytes, packed, method } of entries) {
    const offset = cursor, checksum = crc32(bytes);
    view.setUint32(cursor, 0x04034b50, true); view.setUint16(cursor + 4, 20, true);
    view.setUint16(cursor + 6, 0x800, true); view.setUint32(cursor + 14, checksum, true);
    view.setUint16(cursor + 8, method, true);
    view.setUint32(cursor + 18, packed.length, true); view.setUint32(cursor + 22, bytes.length, true);
    view.setUint16(cursor + 26, filename.length, true); cursor += 30;
    output.set(filename, cursor); cursor += filename.length; output.set(packed, cursor); cursor += packed.length;
    directory.push({ filename, bytes, packed, method, checksum, offset });
  }
  const centralStart = cursor;
  for (const { filename, bytes, packed, method, checksum, offset } of directory) {
    view.setUint32(cursor, 0x02014b50, true); view.setUint16(cursor + 4, 20, true);
    view.setUint16(cursor + 6, 20, true); view.setUint16(cursor + 8, 0x800, true);
    view.setUint16(cursor + 10, method, true);
    view.setUint32(cursor + 16, checksum, true); view.setUint32(cursor + 20, packed.length, true);
    view.setUint32(cursor + 24, bytes.length, true); view.setUint16(cursor + 28, filename.length, true);
    view.setUint32(cursor + 42, offset, true); cursor += 46;
    output.set(filename, cursor); cursor += filename.length;
  }
  const centralSize = cursor - centralStart;
  view.setUint32(cursor, 0x06054b50, true); view.setUint16(cursor + 8, entries.length, true);
  view.setUint16(cursor + 10, entries.length, true); view.setUint32(cursor + 12, centralSize, true);
  view.setUint32(cursor + 16, centralStart, true);
  return new File([output], 'web-game.zip', { type: 'application/zip' });
}
