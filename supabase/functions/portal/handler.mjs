import { digest, token, readBody, statusFor } from './security.mjs';
import { storePrivateZip } from './drive.mjs';

// Dependency injection keeps the actual HTTP boundary testable without deployed secrets.
export function createHandler({ url, serviceKey, pepper, allowedOrigins, googleServiceAccountJson = '', googlePendingFolderId = '', fetcher = fetch }) {
  const origins = new Set(allowedOrigins.split(',').map(s => s.trim()).filter(Boolean));
  return async request => {
    const origin = request.headers.get('origin');
    const headers = {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff',
    };
    const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
    if (origin && !origins.has(origin)) return reply({ error: 'forbidden' }, 403);
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'content-type, x-portal-session, apikey';
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);
    if (!url || !serviceKey || !pepper || pepper.length < 32 || origins.size === 0 || origins.has('*')) {
      return reply({ error: 'unavailable' }, 503);
    }
    const rpc = async (action, body, supplied, fresh = null) => {
      const response = await fetcher(`${url.replace(/\/$/, '')}/rest/v1/rpc/portal_api`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ p_action: action, p_body: body, p_token_hash: supplied ? await digest(supplied, pepper) : null,
          p_new_token_hash: fresh ? await digest(fresh, pepper) : null }), signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      return { response, result };
    };
    // ZIPs are accepted only through this authenticated server path. They are
    // stored in a Drive folder shared with the service account, never published.
    if (new URL(request.url).pathname.endsWith('/upload')) {
      const supplied = request.headers.get('x-portal-session');
      if (!/^[a-f0-9]{64}$/.test(supplied ?? '')) return reply({ error: 'unauthorized' }, 401);
      if (!googleServiceAccountJson || !googlePendingFolderId) return reply({ error: 'unavailable' }, 503);
      const length = Number(request.headers.get('content-length') ?? 0);
      if (length > 52428800 + 8192) return reply({ error: 'body_too_large' }, 413);
      try {
        const form = await request.formData();
        const submissionId = form.get('submission_id'); const file = form.get('package');
        if (typeof submissionId !== 'string' || !(file instanceof File)) return reply({ error: 'invalid_request' }, 400);
        const before = await rpc('user.submission.prepare', { submission_id: submissionId }, supplied);
        if (!before.response.ok || before.result?.error) return reply({ error: before.result?.error ?? 'unavailable' }, statusFor(before.result?.error ?? 'unavailable'));
        const stored = await storePrivateZip({ serviceAccountJson: googleServiceAccountJson, pendingFolderId: googlePendingFolderId, submissionId, file, fetcher });
        const after = await rpc('user.submission.complete', { submission_id: submissionId, drive_file_id: stored.id, package_name: stored.name, package_size: String(stored.size) }, supplied);
        if (!after.response.ok || after.result?.error) return reply({ error: after.result?.error ?? 'unavailable' }, statusFor(after.result?.error ?? 'unavailable'));
        return reply(after.result);
      } catch (error) {
        const name = error?.message;
        return reply({ error: name === 'invalid_upload' ? 'invalid_request' : 'unavailable' }, name === 'invalid_upload' ? 400 : 503);
      }
    }
    let input;
    try { input = await readBody(request); }
    catch (error) { return reply({ error: error.message }, error.message === 'body_too_large' ? 413 : 400); }
    const login = input.action === 'user.login' || input.action === 'admin.login';
    const supplied = request.headers.get('x-portal-session');
    if (!login && !/^[a-f0-9]{64}$/.test(supplied ?? '')) return reply({ error: 'unauthorized' }, 401);
    const fresh = login ? token() : null;
    try {
      const { response, result } = await rpc(input.action, input.data, login ? null : supplied, fresh);
      if (!response.ok) {
        // Never reflect PostgreSQL detail, queries, credentials or unexpected errors.
        const error = result.code === '23505' ? 'conflict'
          : ['22023', '22P02', '22007', '22008', '22003', '23514', '23502'].includes(result.code) ? 'invalid_request' : 'unavailable';
        return reply({ error }, statusFor(error));
      }
      if (!result || typeof result !== 'object') return reply({ error: 'unavailable' }, 503);
      if (result.error) return reply({ error: result.error }, statusFor(result.error));
      return reply(fresh ? { ...result, token: fresh } : result);
    } catch { return reply({ error: 'unavailable' }, 503); }
  };
}
