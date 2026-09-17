import { digest, token, readBody, statusFor } from './security.mjs';
import { downloadPrivateZip, movePrivateZip, storePrivateZip } from './drive.mjs';

// Dependency injection keeps the actual HTTP boundary testable without deployed secrets.
export function createHandler({ url, serviceKey, pepper, allowedOrigins, googleServiceAccountJson = '', googlePendingFolderId = '', googleApprovedFolderId = '', googleRejectedFolderId = '', fetcher = fetch }) {
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
    const internalError = ({ response, result }) => !response.ok || result?.error
      ? reply({ error: result?.error ?? 'unavailable' }, statusFor(result?.error ?? 'unavailable')) : null;
    const privateJson = async () => {
      const length = Number(request.headers.get('content-length') ?? 0);
      if (length > 8192 || !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('invalid_request');
      const body = await request.json();
      if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('invalid_request');
      return body;
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
    // Review and download never expose a Drive ID to the browser. They invoke
    // internal RPC actions, which the JSON API allowlist does not accept.
    if (new URL(request.url).pathname.endsWith('/review')) {
      const supplied = request.headers.get('x-portal-session');
      if (!/^[a-f0-9]{64}$/.test(supplied ?? '')) return reply({ error: 'unauthorized' }, 401);
      if (!googleServiceAccountJson || !googlePendingFolderId || !googleApprovedFolderId || !googleRejectedFolderId) return reply({ error: 'unavailable' }, 503);
      try {
        const { submission_id: submissionId, decision, reason = '' } = await privateJson();
        if (typeof submissionId !== 'string' || !['approved', 'rejected'].includes(decision) || typeof reason !== 'string' || reason.length > 500) return reply({ error: 'invalid_request' }, 400);
        const prepared = await rpc('admin.submission.prepare', { submission_id: submissionId }, supplied);
        const failed = internalError(prepared); if (failed) return failed;
        const fileId = prepared.result.submission?.drive_file_id;
        if (typeof fileId !== 'string') return reply({ error: 'unavailable' }, 503);
        await movePrivateZip({ serviceAccountJson: googleServiceAccountJson, fileId, fromFolderId: googlePendingFolderId,
          toFolderId: decision === 'approved' ? googleApprovedFolderId : googleRejectedFolderId, fetcher });
        const completed = await rpc('admin.submission.complete', { submission_id: submissionId, status: decision, reason }, supplied);
        const completionError = internalError(completed); if (completionError) return completionError;
        return reply(completed.result);
      } catch (error) { return reply({ error: error?.message === 'invalid_request' ? 'invalid_request' : 'unavailable' }, error?.message === 'invalid_request' ? 400 : 503); }
    }
    if (new URL(request.url).pathname.endsWith('/download')) {
      const supplied = request.headers.get('x-portal-session');
      if (!/^[a-f0-9]{64}$/.test(supplied ?? '')) return reply({ error: 'unauthorized' }, 401);
      if (!googleServiceAccountJson) return reply({ error: 'unavailable' }, 503);
      try {
        const { submission_id: submissionId } = await privateJson();
        if (typeof submissionId !== 'string') return reply({ error: 'invalid_request' }, 400);
        const prepared = await rpc('admin.submission.download', { submission_id: submissionId }, supplied);
        const failed = internalError(prepared); if (failed) return failed;
        const submission = prepared.result.submission;
        const response = await downloadPrivateZip({ serviceAccountJson: googleServiceAccountJson, fileId: submission?.drive_file_id, fetcher });
        const safeName = String(submission?.package_name ?? 'submission.zip').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'submission.zip';
        return new Response(response.body, { status: 200, headers: { ...headers, 'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${safeName}"`, 'Access-Control-Expose-Headers': 'Content-Disposition' } });
      } catch (error) { return reply({ error: error?.message === 'invalid_request' ? 'invalid_request' : 'unavailable' }, error?.message === 'invalid_request' ? 400 : 503); }
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
