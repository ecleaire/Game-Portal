export const actions = new Set([
  'user.login', 'admin.login', 'logout', 'user.me', 'user.rename', 'user.password',
  'admin.me', 'admin.users', 'admin.audit', 'admin.create', 'admin.rename', 'admin.role',
  'admin.passwords', 'admin.password.add', 'admin.password.revoke', 'admin.kick',
  'admin.ban', 'admin.unban', 'admin.disable', 'admin.enable',
  'user.submissions', 'user.submission.create', 'user.submission.prepare',
]);

export function token() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
}

export async function digest(value, pepper) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export async function readBody(request, maximum = 8192) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('content_type');
  if (!request.body) throw new Error('invalid_request');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new Error('body_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('invalid_request'); }
  if (!body || Array.isArray(body) || typeof body !== 'object' || !actions.has(body.action)) throw new Error('invalid_request');
  if (body.data !== undefined && (!body.data || Array.isArray(body.data) || typeof body.data !== 'object')) throw new Error('invalid_request');
  const data = body.data ?? {};
  for (const [name, value] of Object.entries(data)) {
    if (name === 'offset' || name === 'before_id') {
      if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_request');
    } else if (value !== null && typeof value !== 'string') throw new Error('invalid_request');
  }
  return { action: body.action, data };
}

export const statusFor = error => ({ unauthorized: 401, forbidden: 403, not_found: 404,
  rate_limited: 429, conflict: 409, unavailable: 503 }[error] ?? 400);
