import { digest, token, readBody, statusFor } from './security.mjs';
import { checkPrivateFolders, deletePrivateZip, driveError, downloadPrivateZip, movePrivateZip, storePrivateZip, validateZip } from './drive.mjs';

// Dependency injection keeps the actual HTTP boundary testable without deployed secrets.
export function createHandler({ url, serviceKey, pepper, allowedOrigins, googleServiceAccountJson = '', googleDriveOAuthJson = '', googlePendingFolderId = '', googleApprovedFolderId = '', googleRejectedFolderId = '', fetcher = fetch }) {
  const origins = new Set(allowedOrigins.split(',').map(s => s.trim()).filter(Boolean));
  return async request => {
    const requestUrl = new URL(request.url);
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
    const publicRpc = async (name, body = {}) => {
      const response = await fetcher(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('unavailable');
      return response.json();
    };
    const storageUrl = (bucket, key) => `${url.replace(/\/$/, '')}/storage/v1/object/${bucket}/${encodeURIComponent(key)}`;
    const storeObject = async (bucket, key, bytes, contentType) => {
      const response = await fetcher(storageUrl(bucket, key), { method: 'POST',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': contentType, 'x-upsert': 'true' },
        body: bytes, signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error('storage_unavailable');
    };
    const mirrorDrivePackage = async (submissionId, fileId) => {
      const response = await downloadPrivateZip({ serviceAccountJson: googleServiceAccountJson,
        oauthJson: googleDriveOAuthJson, fileId, fetcher });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 52428800) throw new Error('invalid_upload');
      validateZip(bytes);
      const key = `${submissionId}.zip`;
      await storeObject('portal-packages', key, bytes, 'application/zip');
      return key;
    };
    const publicPath = requestUrl.pathname;
    if (publicPath.endsWith('/catalog')) {
      try { return reply({ games: await publicRpc('portal_catalog') }); }
      catch { return reply({ error: 'unavailable' }, 503); }
    }
    if (['/public-game','/public-package','/public-thumbnail'].some(path => publicPath.endsWith(path))) {
      try {
        const { slug } = await privateJson();
        if (typeof slug !== 'string' || !/^[a-f0-9]{36}$/.test(slug)) return reply({ error: 'not_found' }, 404);
        const game = await publicRpc('portal_public_game', { p_slug: slug });
        if (!game) return reply({ error: 'not_found' }, 404);
        if (publicPath.endsWith('/public-game')) {
          const { package_storage_key: _package, thumbnail_key: _thumbnail, ...metadata } = game;
          return reply({ game: { ...metadata, has_thumbnail: Boolean(_thumbnail) } });
        }
        const thumbnail = publicPath.endsWith('/public-thumbnail');
        const key = thumbnail ? game.thumbnail_key : game.package_storage_key;
        if (!key) return reply({ error: 'not_found' }, 404);
        const bucket = thumbnail ? 'portal-thumbnails' : 'portal-packages';
        const response = await fetcher(storageUrl(bucket, key), {
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, signal: AbortSignal.timeout(60000) });
        if (!response.ok || !response.body) throw new Error('storage_unavailable');
        return new Response(response.body, { headers: { ...headers,
          'Content-Type': thumbnail ? (response.headers.get('content-type') ?? 'image/png') : 'application/zip',
          'Content-Disposition': thumbnail ? 'inline' : 'attachment; filename="game.zip"' } });
      } catch (error) { return reply({ error: error?.message === 'invalid_request' ? 'invalid_request' : 'unavailable' }, 503); }
    }
    if (requestUrl.pathname.endsWith('/submission-thumbnail')) {
      const supplied = request.headers.get('x-portal-session');
      if (!/^[a-f0-9]{64}$/.test(supplied ?? '')) return reply({ error: 'unauthorized' }, 401);
      try {
        const { submission_id: submissionId, mode } = await privateJson();
        if (typeof submissionId !== 'string' || !['user','admin'].includes(mode)) return reply({ error: 'invalid_request' }, 400);
        const prepared = await rpc(`${mode}.submission.thumbnail`, { submission_id: submissionId }, supplied);
        const failed = internalError(prepared); if (failed) return failed;
        const response = await fetcher(storageUrl('portal-thumbnails', prepared.result.thumbnail_key), {
          headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, signal: AbortSignal.timeout(15000) });
        if (!response.ok || !response.body) throw new Error('storage_unavailable');
        return new Response(response.body, { headers: { ...headers,
          'Content-Type': response.headers.get('content-type') ?? 'image/png' } });
      } catch { return reply({ error: 'unavailable' }, 503); }
    }
    // ZIPs are accepted only through this authenticated server path. They are
    // stored in a Drive folder shared with the service account, never published.
    if (requestUrl.pathname.endsWith('/preview-package')) {
      const supplied = request.headers.get('x-portal-session');
      if (!/^[a-f0-9]{64}$/.test(supplied ?? '')) return reply({ error: 'unauthorized' }, 401);
      if (!(googleServiceAccountJson || googleDriveOAuthJson)) return reply({ error: 'drive_unavailable' }, 503);
      try {
        const { submission_id: submissionId } = await privateJson();
        if (typeof submissionId !== 'string') return reply({ error: 'invalid_request' }, 400);
        const prepared = await rpc('user.submission.preview', { submission_id: submissionId }, supplied);
        const failed = internalError(prepared); if (failed) return failed;
        const response = await downloadPrivateZip({ serviceAccountJson: googleServiceAccountJson, oauthJson: googleDriveOAuthJson,
          fileId: prepared.result.submission.drive_file_id, fetcher });
        return new Response(response.body, { headers: { ...headers, 'Content-Type': 'application/zip' } });
      } catch (error) { return reply({ error: error?.message === 'invalid_request' ? 'invalid_request' : 'unavailable' }, error?.message === 'invalid_request' ? 400 : 503); }
    }
    if (requestUrl.pathname.endsWith('/upload')) {
      const supplied = request.headers.get('x-portal-session');
      if (!/^[a-f0-9]{64}$/.test(supplied ?? '')) return reply({ error: 'unauthorized' }, 401);
      if (!(googleServiceAccountJson || googleDriveOAuthJson) || !googlePendingFolderId) return reply({ error: 'unavailable' }, 503);
      const length = Number(request.headers.get('content-length') ?? 0);
      if (length > 52428800 + 5242880 + 16384) return reply({ error: 'body_too_large' }, 413);
      try {
        const form = await request.formData();
        const submissionId = form.get('submission_id'); const file = form.get('package');
        if (typeof submissionId !== 'string' || !(file instanceof File)) return reply({ error: 'invalid_request' }, 400);
        const before = await rpc('user.submission.prepare', { submission_id: submissionId }, supplied);
        if (!before.response.ok || before.result?.error) return reply({ error: before.result?.error ?? 'unavailable' }, statusFor(before.result?.error ?? 'unavailable'));
        const thumbnail = form.get('thumbnail');
        const types = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
        if (thumbnail instanceof File && thumbnail.size && (!types[thumbnail.type] || thumbnail.size > 5242880))
          return reply({ error: 'invalid_thumbnail' }, 400);
        const bytes = new Uint8Array(await file.arrayBuffer()); validateZip(bytes);
        const packageKey = `${submissionId}.zip`;
        await storeObject('portal-packages', packageKey, bytes, 'application/zip');
        let thumbnailKey = '';
        if (thumbnail instanceof File && thumbnail.size) {
          thumbnailKey = `${submissionId}.${types[thumbnail.type]}`;
          await storeObject('portal-thumbnails', thumbnailKey, new Uint8Array(await thumbnail.arrayBuffer()), thumbnail.type);
        }
        const stored = await storePrivateZip({ serviceAccountJson: googleServiceAccountJson, oauthJson: googleDriveOAuthJson,
          pendingFolderId: googlePendingFolderId, submissionId, file, bytes, fetcher });
        const after = await rpc('user.submission.complete', { submission_id: submissionId, drive_file_id: stored.id,
          package_name: stored.name, package_size: String(stored.size), package_storage_key: packageKey, thumbnail_key: thumbnailKey }, supplied);
        if (!after.response.ok || after.result?.error) return reply({ error: after.result?.error ?? 'unavailable' }, statusFor(after.result?.error ?? 'unavailable'));
        return reply(after.result);
      } catch (error) {
        const name = error?.message;
        const uploadError = ['invalid_upload', 'web_export_required', 'storage_unavailable'].includes(name) ? name : name?.startsWith('drive_') ? driveError(error) : 'unavailable';
        return reply({ error: uploadError }, ['invalid_upload', 'web_export_required'].includes(uploadError) ? 400 : 503);
      }
    }
    if (requestUrl.pathname.endsWith('/storage-health')) {
      const supplied = request.headers.get('x-portal-session');
      if (!/^[a-f0-9]{64}$/.test(supplied ?? '')) return reply({ error: 'unauthorized' }, 401);
      try {
        const checked = await rpc('admin.me', {}, supplied);
        const failed = internalError(checked); if (failed) return failed;
        if (!(googleServiceAccountJson || googleDriveOAuthJson) || !googlePendingFolderId || !googleApprovedFolderId || !googleRejectedFolderId) return reply({ error: 'drive_unavailable' }, 503);
        await checkPrivateFolders({ serviceAccountJson: googleServiceAccountJson, oauthJson: googleDriveOAuthJson,
          folderIds: [googlePendingFolderId, googleApprovedFolderId, googleRejectedFolderId], fetcher });
        return reply({ ok: true });
      } catch (error) { return reply({ error: driveError(error) }, 503); }
    }
    if (requestUrl.pathname.endsWith('/publish-package')) {
      const supplied = request.headers.get('x-portal-session');
      if (!/^[a-f0-9]{64}$/.test(supplied ?? '')) return reply({ error: 'unauthorized' }, 401);
      if (!(googleServiceAccountJson || googleDriveOAuthJson)) return reply({ error: 'drive_unavailable' }, 503);
      try {
        const { submission_id: submissionId } = await privateJson();
        if (typeof submissionId !== 'string') return reply({ error: 'invalid_request' }, 400);
        const prepared = await rpc('admin.submission.repair', { submission_id: submissionId }, supplied);
        const failed = internalError(prepared); if (failed) return failed;
        const key = await mirrorDrivePackage(submissionId, prepared.result.submission.drive_file_id);
        const completed = await rpc('admin.submission.repair_complete', { submission_id: submissionId, package_storage_key: key }, supplied);
        const completionError = internalError(completed); if (completionError) return completionError;
        return reply(completed.result);
      } catch (error) { return reply({ error: ['invalid_upload','web_export_required','storage_unavailable'].includes(error?.message) ? error.message : 'unavailable' }, 503); }
    }
    // Review and download never expose a Drive ID to the browser. They invoke
    // internal RPC actions, which the JSON API allowlist does not accept.
    if (new URL(request.url).pathname.endsWith('/review')) {
      const supplied = request.headers.get('x-portal-session');
      if (!/^[a-f0-9]{64}$/.test(supplied ?? '')) return reply({ error: 'unauthorized' }, 401);
      if (!(googleServiceAccountJson || googleDriveOAuthJson) || !googlePendingFolderId || !googleApprovedFolderId || !googleRejectedFolderId) return reply({ error: 'unavailable' }, 503);
      try {
        const { submission_id: submissionId, decision, reason = '' } = await privateJson();
        if (typeof submissionId !== 'string' || !['approved', 'rejected'].includes(decision) || typeof reason !== 'string' || reason.length > 500) return reply({ error: 'invalid_request' }, 400);
        const prepared = await rpc('admin.submission.prepare', { submission_id: submissionId }, supplied);
        const failed = internalError(prepared); if (failed) return failed;
        const fileId = prepared.result.submission?.drive_file_id;
        if (typeof fileId !== 'string') return reply({ error: 'unavailable' }, 503);
        const packageKey = decision === 'approved'
          ? prepared.result.submission.package_storage_key || await mirrorDrivePackage(submissionId, fileId) : null;
        await movePrivateZip({ serviceAccountJson: googleServiceAccountJson, oauthJson: googleDriveOAuthJson, fileId, fromFolderId: googlePendingFolderId,
          toFolderId: decision === 'approved' ? googleApprovedFolderId : googleRejectedFolderId, fetcher });
        const completed = await rpc('admin.submission.complete', { submission_id: submissionId, status: decision, reason,
          package_storage_key: packageKey }, supplied);
        const completionError = internalError(completed); if (completionError) return completionError;
        return reply(completed.result);
      } catch (error) { return reply({ error: error?.message === 'invalid_request' ? 'invalid_request' : 'unavailable' }, error?.message === 'invalid_request' ? 400 : 503); }
    }
    if (new URL(request.url).pathname.endsWith('/download')) {
      const supplied = request.headers.get('x-portal-session');
      if (!/^[a-f0-9]{64}$/.test(supplied ?? '')) return reply({ error: 'unauthorized' }, 401);
      if (!(googleServiceAccountJson || googleDriveOAuthJson)) return reply({ error: 'unavailable' }, 503);
      try {
        const { submission_id: submissionId } = await privateJson();
        if (typeof submissionId !== 'string') return reply({ error: 'invalid_request' }, 400);
        const prepared = await rpc('admin.submission.download', { submission_id: submissionId }, supplied);
        const failed = internalError(prepared); if (failed) return failed;
        const submission = prepared.result.submission;
        const response = await downloadPrivateZip({ serviceAccountJson: googleServiceAccountJson, oauthJson: googleDriveOAuthJson, fileId: submission?.drive_file_id, fetcher });
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
      if (input.action === 'user.submission.delete' && result.deleted === true) {
        try {
          const files = await publicRpc('portal_submission_cleanup', { p_id: input.data.submission_id });
          if (files) {
            const removeObject = async (bucket, key) => {
              if (!key) return;
              const removed = await fetcher(`${url.replace(/\/$/, '')}/storage/v1/object/${bucket}`, {
                method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ prefixes: [key] }), signal: AbortSignal.timeout(15000),
              });
              if (!removed.ok && removed.status !== 404) throw new Error('storage_unavailable');
            };
            const removed = await Promise.allSettled([
              removeObject('portal-packages', files.package_storage_key),
              removeObject('portal-thumbnails', files.thumbnail_key),
              ...(files.drive_file_id ? [deletePrivateZip({ serviceAccountJson: googleServiceAccountJson,
                oauthJson: googleDriveOAuthJson, fileId: files.drive_file_id, fetcher })] : []),
            ]);
            if (removed.some(item => item.status === 'rejected')) throw new Error('cleanup_pending');
            await publicRpc('portal_submission_cleanup', { p_id: input.data.submission_id, p_complete: true });
          }
          return reply({ deleted: true, cleanup_pending: false });
        } catch { return reply({ deleted: true, cleanup_pending: true }); }
      }
      return reply(fresh ? { ...result, token: fresh } : result);
    } catch { return reply({ error: 'unavailable' }, 503); }
  };
}
