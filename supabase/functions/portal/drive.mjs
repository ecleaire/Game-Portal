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
async function accessToken(serviceAccountJson, fetcher = fetch) {
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

export async function storePrivateZip({ serviceAccountJson, pendingFolderId, submissionId, file, fetcher = fetch }) {
  if (!pendingFolderId || !file || file.size < 1 || file.size > 52428800 || !/\.zip$/i.test(file.name)) throw new Error('invalid_upload');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]) && [0x04, 0x06, 0x08].includes(bytes[3]))) throw new Error('invalid_upload');
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
