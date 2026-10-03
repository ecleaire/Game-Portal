import { deletePrivateZip } from '../supabase/functions/portal/drive.mjs';

// Retry only work already authorized and recorded by a user's deletion.
const id = process.argv[2];
if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id ?? '')) throw new Error('Provide a deleted submission UUID');
for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}
const base = process.env.SUPABASE_URL.replace(/\/$/, '');
const headers = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
async function rpc(complete = false) {
  const response = await fetch(`${base}/rest/v1/rpc/portal_submission_cleanup`, {
    method: 'POST', headers, body: JSON.stringify({ p_id: id, p_complete: complete }), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Cleanup lookup failed (${response.status})`);
  return response.json();
}
const files = await rpc();
if (!files) { console.log('No pending cleanup for this submission.'); process.exit(0); }
for (const [bucket, key] of [['portal-packages', files.package_storage_key], ['portal-thumbnails', files.thumbnail_key]]) {
  if (!key) continue;
  const response = await fetch(`${base}/storage/v1/object/${bucket}`, {
    method: 'DELETE', headers, body: JSON.stringify({ prefixes: [key] }), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok && response.status !== 404) throw new Error(`Storage cleanup failed (${response.status}); pending work retained`);
}
if (files.drive_file_id) await deletePrivateZip({ serviceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '',
  oauthJson: process.env.GOOGLE_DRIVE_OAUTH_JSON ?? '', fileId: files.drive_file_id });
await rpc(true);
console.log('Deleted submission files removed.');
