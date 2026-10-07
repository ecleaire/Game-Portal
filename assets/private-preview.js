// A private ZIP is unpacked in the owner's browser. Supabase Edge Functions
// deliberately serve HTML as text/plain, so they cannot host the preview.
const MAX_ZIP = 50 * 1024 * 1024;
const MAX_UNPACKED = 200 * 1024 * 1024;
const MAX_ENTRIES = 500;
const decoder = new TextDecoder();
const mimeTypes = { html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css',
  wasm: 'application/wasm', pck: 'application/octet-stream', json: 'application/json', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', gif: 'image/gif', mp3: 'audio/mpeg', ogg: 'audio/ogg',
  wav: 'audio/wav', mp4: 'video/mp4', woff: 'font/woff', woff2: 'font/woff2' };
const mime = name => mimeTypes[name.split('.').pop().toLowerCase()] ?? 'application/octet-stream';

// A Web export may use any HTML basename and may be wrapped in one folder.
// Keep that basename intact: Godot expects the matching .js/.wasm/.pck names.
export function webArchiveLayout(names) {
  const files = names.filter(name => !name.endsWith('/'));
  const root = files.length && files.every(name => name.includes('/') && name.startsWith(files[0].split('/')[0] + '/'))
    ? files[0].split('/')[0] + '/' : '';
  const paths = files.map(name => root ? name.slice(root.length) : name);
  const html = paths.filter(name => !name.includes('/') && /\.html?$/i.test(name));
  const entry = html.find(name => name.toLowerCase() === 'index.html') ?? (html.length === 1 ? html[0] : null);
  return entry ? { root, entry } : null;
}

// Validate the Web export before creating a database submission.
export async function checkWebGameZip(file) {
  if (!file || !/\.zip$/i.test(file.name) || file.size < 22 || file.size > MAX_ZIP) throw new Error('invalid_upload');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const u16 = at => view.getUint16(at, true);
  const u32 = at => view.getUint32(at, true);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (u32(at) === 0x06054b50) { end = at; break; }
  }
  if (end < 0 || u16(end + 4) || u16(end + 6)) throw new Error('invalid_upload');
  const count = u16(end + 10), size = u32(end + 12), start = u32(end + 16);
  if (!count || count > MAX_ENTRIES || start + size > end) throw new Error('invalid_upload');
  let at = start; const names = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) throw new Error('invalid_upload');
    const nameLength = u16(at + 28), extraLength = u16(at + 30), commentLength = u16(at + 32);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > end) throw new Error('invalid_upload');
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || name.includes(':')) throw new Error('invalid_upload');
    names.push(name);
    at = next;
  }
  if (at !== start + size) throw new Error('invalid_upload');
  if (!webArchiveLayout(names)) throw new Error('web_export_required');
}

async function inflate(raw, expected) {
  if (typeof DecompressionStream !== 'function') throw new Error('preview_unsupported');
  const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > expected || size > MAX_UNPACKED) throw new Error('invalid_preview');
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (size !== expected) throw new Error('invalid_preview');
  if (chunks.length === 1) return chunks[0];
  const result = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; }
  return result;
}

export async function unpackPrivateZip(buffer) {
  const data = new Uint8Array(buffer);
  if (data.length > MAX_ZIP || data.length < 22) throw new Error('invalid_preview');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = at => view.getUint16(at, true);
  const u32 = at => view.getUint32(at, true);
  let end = -1;
  for (let at = data.length - 22; at >= Math.max(0, data.length - 65557); at--) {
    if (u32(at) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) throw new Error('invalid_preview');
  const count = u16(end + 10), centralSize = u32(end + 12), centralOffset = u32(end + 16);
  if (count > MAX_ENTRIES || centralOffset + centralSize > end) throw new Error('invalid_preview');
  const entries = []; const names = new Set(); let at = centralOffset, total = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) throw new Error('invalid_preview');
    const flags = u16(at + 8), method = u16(at + 10), packed = u32(at + 20), size = u32(at + 24);
    const nameLength = u16(at + 28), extraLength = u16(at + 30), commentLength = u16(at + 32), local = u32(at + 42);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > end || flags & 1 || ![0, 8].includes(method)) throw new Error('invalid_preview');
    const name = decoder.decode(data.subarray(at + 46, at + 46 + nameLength));
    at = next;
    if (name.endsWith('/')) continue;
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || name.includes(':') || names.has(name)) throw new Error('invalid_preview');
    names.add(name);
    total += size; if (total > MAX_UNPACKED || local + 30 > centralOffset || u32(local) !== 0x04034b50) throw new Error('invalid_preview');
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    if (start + packed > centralOffset) throw new Error('invalid_preview');
    if (method === 0 && packed !== size) throw new Error('invalid_preview');
    entries.push({ name, method, size, start, packed });
  }
  const layout = webArchiveLayout(entries.map(entry => entry.name));
  if (!layout) throw new Error('invalid_preview');
  // Validate the entire directory and size budget before starting any work.
  // Bound concurrent inflation so large exports do not open hundreds of streams.
  const contents = new Array(entries.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
    while (cursor < entries.length) {
      const index = cursor++, entry = entries[index];
      const raw = data.subarray(entry.start, entry.start + entry.packed);
      contents[index] = entry.method === 0 ? raw : await inflate(raw, entry.size);
    }
  }));
  const normalized = new Map(entries.map((entry, index) => [entry.name.slice(layout.root.length), contents[index]]));
  normalized.set('index.html', normalized.get(layout.entry));
  return normalized;
}

function dataUrl(bytes, type) {
  const parts = [];
  for (let at = 0; at < bytes.length; at += 0x8000) parts.push(String.fromCharCode(...bytes.subarray(at, at + 0x8000)));
  return `data:${type};base64,${btoa(parts.join(''))}`;
}

export function privatePreviewDocument(files) {
  const resource = new Map();
  for (const [name, bytes] of files) if (!name.endsWith('.css') && name !== 'index.html') resource.set(name, dataUrl(bytes, mime(name)));
  const local = (value, base = '') => {
    if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) return null;
    const path = `${base}${value.split(/[?#]/)[0]}`;
    const parts = [];
    for (const part of path.split('/')) {
      if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part);
    }
    return parts.join('/');
  };
  for (const [name, bytes] of files) if (name.endsWith('.css')) {
    const base = name.includes('/') ? name.slice(0, name.lastIndexOf('/') + 1) : '';
    const css = decoder.decode(bytes).replace(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi,
      (match, _quote, value) => resource.get(local(value, base)) ? `url("${resource.get(local(value, base))}")` : match);
    resource.set(name, dataUrl(new TextEncoder().encode(css), 'text/css'));
  }
  const doc = new DOMParser().parseFromString(decoder.decode(files.get('index.html')), 'text/html');
  doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"],base').forEach(node => node.remove());
  for (const node of doc.querySelectorAll('[src],[href],[poster],[data]')) {
    for (const attr of ['src', 'href', 'poster', 'data']) {
      const value = node.getAttribute(attr), replacement = resource.get(local(value));
      if (replacement) node.setAttribute(attr, replacement);
    }
  }
  const csp = doc.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy';
  csp.content = "default-src 'none'; script-src 'unsafe-inline' data: blob: 'wasm-unsafe-eval'; connect-src data: blob:; img-src data: blob:; style-src 'unsafe-inline' data: blob:; font-src data: blob:; media-src data: blob:; worker-src blob:";
  const shim = doc.createElement('script');
  const manifest = JSON.stringify(Object.fromEntries(resource)).replaceAll('<', '\\u003c');
  shim.textContent = `const portalFiles=${manifest}; const portalFetch=window.fetch.bind(window); window.fetch=(input,init)=>{const raw=typeof input==='string'?input:input.url; if(/^(data:|blob:)/.test(raw))return portalFetch(input,init); try{const base=new URL(document.baseURI),url=new URL(raw,base); if(url.origin!==base.origin)throw 0; const directory=base.pathname.endsWith('/')?base.pathname:base.pathname.slice(0,base.pathname.lastIndexOf('/')+1); let path=decodeURIComponent(url.pathname); path=path.startsWith(directory)?path.slice(directory.length):path.replace(/^\\/+/, ''); if(portalFiles[path])return portalFetch(portalFiles[path],init);}catch{} return Promise.reject(new TypeError('Game resource unavailable'));};`;
  doc.head.prepend(csp, shim);
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}
