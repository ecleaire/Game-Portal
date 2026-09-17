import { digest, token, readBody, statusFor } from './security.mjs';
import { downloadPrivateZip, movePrivateZip, storePrivateZip } from './drive.mjs';

const bytes = value => new TextEncoder().encode(value);
const b64url = value => btoa(String.fromCharCode(...value)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const unb64url = value => Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/').padEnd(Math.ceil(value.length / 4) * 4, '=')), char => char.charCodeAt(0));
async function previewKey(pepper) { return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', bytes(pepper)), 'AES-GCM', false, ['encrypt','decrypt']); }
async function sealPreview(value, pepper) { const iv=crypto.getRandomValues(new Uint8Array(12)); const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await previewKey(pepper),bytes(JSON.stringify(value))); return `${b64url(iv)}.${b64url(new Uint8Array(encrypted))}`; }
async function openPreview(value, pepper) { const [iv,cipher,...rest]=value.split('.'); if (!iv || !cipher || rest.length) throw new Error('invalid_preview'); return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64url(iv)},await previewKey(pepper),unb64url(cipher)))); }
function zipEntry(data, requested) { const view=new DataView(data.buffer,data.byteOffset,data.byteLength); const u16=i=>view.getUint16(i,true),u32=i=>view.getUint32(i,true); let end=-1; for(let i=data.length-22;i>=Math.max(0,data.length-65557);i--) if(u32(i)===0x06054b50){end=i;break;} if(end<0) throw new Error('invalid_preview'); let at=u32(end+16); const count=u16(end+10); for(let n=0;n<count;n++){ if(u32(at)!==0x02014b50) throw new Error('invalid_preview'); const method=u16(at+10),size=u32(at+20),nameLength=u16(at+28),extra=u16(at+30),comment=u16(at+32),local=u32(at+42); const name=new TextDecoder().decode(data.slice(at+46,at+46+nameLength)); if(name===requested){ if(u32(local)!==0x04034b50 || size>52428800) throw new Error('invalid_preview'); const start=local+30+u16(local+26)+u16(local+28), raw=data.slice(start,start+size); return {method,name,raw}; } at+=46+nameLength+extra+comment; } throw new Error('not_found'); }
async function unpack(entry) { if(entry.method===0) return entry.raw; if(entry.method===8) return new Uint8Array(await new Response(new Blob([entry.raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); throw new Error('invalid_preview'); }
const mime = path => ({html:'text/html; charset=utf-8',htm:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',mjs:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',wasm:'application/wasm',json:'application/json',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',mp3:'audio/mpeg',ogg:'audio/ogg',wav:'audio/wav'}[path.split('.').pop().toLowerCase()] ?? 'application/octet-stream');

// Dependency injection keeps the actual HTTP boundary testable without deployed secrets.
export function createHandler({ url, serviceKey, pepper, allowedOrigins, googleServiceAccountJson = '', googlePendingFolderId = '', googleApprovedFolderId = '', googleRejectedFolderId = '', fetcher = fetch }) {
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
    if (requestUrl.pathname.includes('/preview/')) {
      try { const [token, ...parts]=requestUrl.pathname.split('/preview/')[1].split('/'); const preview=await openPreview(token,pepper); if (!preview?.fileId || !Number.isFinite(preview.exp) || preview.exp<Date.now()) throw new Error('invalid_preview'); const path=decodeURIComponent(parts.join('/') || 'index.html'); if (!path || path.includes('..') || path.includes('\\')) throw new Error('invalid_preview'); const zip=await downloadPrivateZip({serviceAccountJson:googleServiceAccountJson,fileId:preview.fileId,fetcher}); const entry=zipEntry(new Uint8Array(await new Response(zip.body).arrayBuffer()),path); return new Response(await unpack(entry),{headers:{'Content-Type':mime(path),'Cache-Control':'no-store','Content-Security-Policy':"sandbox allow-scripts; default-src 'self' data: blob:; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline';"}}); } catch { return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store'}}); }
    }
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
    if (requestUrl.pathname.endsWith('/preview')) {
      const supplied=request.headers.get('x-portal-session'); if (!/^[a-f0-9]{64}$/.test(supplied ?? '') || !googleServiceAccountJson) return reply({error:'unauthorized'},401);
      try { const {submission_id:submissionId}=await privateJson(); if(typeof submissionId!=='string') return reply({error:'invalid_request'},400); const prepared=await rpc('user.submission.preview',{submission_id:submissionId},supplied); const failed=internalError(prepared); if(failed)return failed; const token=await sealPreview({fileId:prepared.result.submission.drive_file_id,exp:Date.now()+5*60*1000},pepper); return reply({url:`${url.replace(/\/$/,'')}/functions/v1/portal/preview/${token}/index.html`}); } catch { return reply({error:'unavailable'},503); }
    }
    if (requestUrl.pathname.endsWith('/upload')) {
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
        const uploadError = name === 'invalid_upload' ? 'invalid_request' : name === 'drive_unavailable' ? 'drive_unavailable' : 'unavailable';
        return reply({ error: uploadError }, uploadError === 'invalid_request' ? 400 : 503);
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
