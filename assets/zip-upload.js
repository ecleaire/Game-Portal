// Multiple exported Web files can be dropped directly. A stored ZIP avoids
// changing Godot's generated filenames; server validation still runs afterward.
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
    names.add(name); entries.push({ filename, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  const output = new Uint8Array(size); const view = new DataView(output.buffer);
  let cursor = 0; const directory = [];
  for (const { filename, bytes } of entries) {
    const offset = cursor, checksum = crc32(bytes);
    view.setUint32(cursor, 0x04034b50, true); view.setUint16(cursor + 4, 20, true);
    view.setUint16(cursor + 6, 0x800, true); view.setUint32(cursor + 14, checksum, true);
    view.setUint32(cursor + 18, bytes.length, true); view.setUint32(cursor + 22, bytes.length, true);
    view.setUint16(cursor + 26, filename.length, true); cursor += 30;
    output.set(filename, cursor); cursor += filename.length; output.set(bytes, cursor); cursor += bytes.length;
    directory.push({ filename, bytes, checksum, offset });
  }
  const centralStart = cursor;
  for (const { filename, bytes, checksum, offset } of directory) {
    view.setUint32(cursor, 0x02014b50, true); view.setUint16(cursor + 4, 20, true);
    view.setUint16(cursor + 6, 20, true); view.setUint16(cursor + 8, 0x800, true);
    view.setUint32(cursor + 16, checksum, true); view.setUint32(cursor + 20, bytes.length, true);
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
