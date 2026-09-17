const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size';

function base64url(bytes) {
  let text = btoa(String.fromCharCode(...bytes));
  return text.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function pemBytes(pem) {
  const text = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replaceAll(/\s/g, '');
  const binary = atob(text);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
export async function accessToken(serviceAccountJson, fetcher = fetch) {
  let account;
  try { account = JSON.parse(serviceAccountJson); } catch { throw new Error('drive_unavailable'); }
  if (!account.client_email || !account.private_key) throw new Error('drive_unavailable');
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = base64url(new TextEncoder().encode(JSON.stringify({
    iss: account.client_email, scope: 'https://www.googleapis.com/auth/drive.file',
    aud: GOOGLE_TOKEN_URL, iat: now, exp: now + 300,
  })));
  let key;
  try { key = await crypto.subtle.importKey('pkcs8', pemBytes(account.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']); }
  catch { throw new Error('drive_unavailable'); }
  const signed = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  const assertion = `${header}.${claims}.${base64url(new Uint8Array(signed))}`;
  const response = await fetcher(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  const result = await response.json().catch(() => null);
  if (!response.ok || typeof result?.access_token !== 'string') throw new Error('drive_unavailable');
  return result.access_token;
}

const u16 = (bytes, at) => bytes[at] | (bytes[at + 1] << 8);
const u32 = (bytes, at) => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] * 0x1000000)) >>> 0;

// Parse the central directory without extracting files. This rejects zip-slip,
// symlinks, encrypted archives and decompression bombs before they reach Drive.
export function validateZip(bytes) {
  if (bytes.length < 22 || !(bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]) && [0x04, 0x06, 0x08].includes(bytes[3]))) throw new Error('invalid_upload');
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0 || u16(bytes, eocd + 4) !== 0 || u16(bytes, eocd + 6) !== 0) throw new Error('invalid_upload');
  const count = u16(bytes, eocd + 10); const directorySize = u32(bytes, eocd + 12); let at = u32(bytes, eocd + 16);
  if (count === 0 || count === 0xffff || directorySize === 0xffffffff || count > 5000 || at + directorySize > eocd) throw new Error('invalid_upload');
  const decoder = new TextDecoder('utf-8', { fatal: true }); let total = 0; let html = false;
  for (let entry = 0; entry < count; entry++) {
    if (at + 46 > eocd || u32(bytes, at) !== 0x02014b50) throw new Error('invalid_upload');
    const flags = u16(bytes, at + 8); const uncompressed = u32(bytes, at + 24); const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30); const commentLength = u16(bytes, at + 32); const external = u32(bytes, at + 38);
    const end = at + 46 + nameLength + extraLength + commentLength;
    if (end > eocd || (flags & 0x1) !== 0) throw new Error('invalid_upload');
    let name; try { name = decoder.decode(bytes.slice(at + 46, at + 46 + nameLength)); } catch { throw new Error('invalid_upload'); }
    const unixMode = external >>> 16;
    if (!name || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').includes('..') || (unixMode & 0xf000) === 0xa000) throw new Error('invalid_upload');
    if (/\.html?$/i.test(name)) html = true;
    total += uncompressed;
    if (!Number.isSafeInteger(total) || total > 209715200) throw new Error('invalid_upload');
    at = end;
  }
  if (at !== u32(bytes, eocd + 16) + directorySize || !html) throw new Error('invalid_upload');
}

export async function storePrivateZip({ serviceAccountJson, pendingFolderId, submissionId, file, fetcher = fetch }) {
  if (!pendingFolderId || !file || file.size < 1 || file.size > 52428800 || !/\.zip$/i.test(file.name)) throw new Error('invalid_upload');
  const bytes = new Uint8Array(await file.arrayBuffer());
  validateZip(bytes);
  const access = await accessToken(serviceAccountJson, fetcher);
  const boundary = `portal-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: `${submissionId}.zip`, parents: [pendingFolderId], mimeType: 'application/zip' });
  const prefix = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/zip\r\n\r\n`);
  const suffix = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(prefix.length + bytes.length + suffix.length);
  body.set(prefix); body.set(bytes, prefix.length); body.set(suffix, prefix.length + bytes.length);
  const response = await fetcher(DRIVE_UPLOAD_URL, { method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  const result = await response.json().catch(() => null);
  if (!response.ok || typeof result?.id !== 'string') throw new Error('drive_unavailable');
  return { id: result.id, name: file.name, size: file.size };
}

export async function movePrivateZip({ serviceAccountJson, fileId, fromFolderId, toFolderId, fetcher = fetch }) {
  if (!fileId || !fromFolderId || !toFolderId) throw new Error('drive_unavailable');
  const access = await accessToken(serviceAccountJson, fetcher);
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?addParents=${encodeURIComponent(toFolderId)}&removeParents=${encodeURIComponent(fromFolderId)}&fields=id`;
  const response = await fetcher(url, { method: 'PATCH', headers: { Authorization: `Bearer ${access}` } });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.id !== fileId) throw new Error('drive_unavailable');
}

export async function downloadPrivateZip({ serviceAccountJson, fileId, fetcher = fetch }) {
  if (!fileId) throw new Error('drive_unavailable');
  const access = await accessToken(serviceAccountJson, fetcher);
  const response = await fetcher(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok || !response.body) throw new Error('drive_unavailable');
  return response;
}
