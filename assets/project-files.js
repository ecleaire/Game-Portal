// Project archives are stored as attachments, never extracted or executed here.
export const PROJECT_LIMIT = 50 * 1024 * 1024;
export function validateProjectArchive(bytes, name, engine) {
  const fail = () => { throw new Error('invalid_project'); };
  if (!/\.(zip|sb3)$/i.test(name ?? '') || !bytes.length || bytes.length > PROJECT_LIMIT) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = at => view.getUint16(at, true), u32 = at => view.getUint32(at, true);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) { end = at; break; }
  }
  if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) fail();
  const count = u16(end + 10), start = u32(end + 16), size = u32(end + 12);
  if (!count || count > 5000 || start + size !== end) fail();
  const names = new Set(), decoder = new TextDecoder('utf-8', { fatal: true });
  let at = start, total = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) fail();
    const flags = u16(at + 8), method = u16(at + 10), packed = u32(at + 20), unpacked = u32(at + 24);
    const length = u16(at + 28), next = at + 46 + length + u16(at + 30) + u16(at + 32), local = u32(at + 42);
    if (next > end || (flags & 1) || ![0, 8].includes(method) || u16(at + 34) || ((u32(at + 38) >>> 16) & 0xf000) === 0xa000) fail();
    let path; try { path = decoder.decode(bytes.subarray(at + 46, at + 46 + length)); } catch { fail(); }
    if (!path || /[\\\x00-\x1f\x7f:]/.test(path) || path.startsWith('/') || path.split('/').some(p => p === '..' || p === '.') || names.has(path)) fail();
    names.add(path); total += unpacked;
    if (total > 500 * 1024 * 1024 || local + 30 > start || u32(local) !== 0x04034b50) fail();
    const data = local + 30 + u16(local + 26) + u16(local + 28);
    if (data + packed > start || u16(local + 8) !== method || u16(local + 6) !== flags || u16(local + 26) !== length) fail();
    for (let i = 0; i < length; i++) if (bytes[local + 30 + i] !== bytes[at + 46 + i]) fail();
    at = next;
  }
  if (at !== end) fail();
  if (/\.sb3$/i.test(name)) { if (engine === 'godot' || !names.has('project.json')) fail(); }
  else if (engine === 'godot' && ![...names].some(path => /(^|\/)project\.godot$/.test(path))) fail();
  else if (engine === 'scratch' && ![...names].some(path => /(^|\/)project\.json$/.test(path) || /\.sb3$/i.test(path))) fail();
  return { count, expandedSize: total };
}
export async function checkProjectFile(file, engine) {
  if (!file || !file.size || file.size > PROJECT_LIMIT) throw new Error('invalid_project');
  return validateProjectArchive(new Uint8Array(await file.arrayBuffer()), file.name, engine);
}
