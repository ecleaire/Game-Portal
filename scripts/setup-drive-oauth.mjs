// Owner-only setup. Never deploy this script to GitHub Pages or an Edge Function.
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { readFile, open } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

async function main() {
  const [clientFile, outputFile] = process.argv.slice(2);
  if (!clientFile || !outputFile) throw new Error('Usage: node scripts/setup-drive-oauth.mjs CLIENT_JSON OUTPUT_ENV (both files outside the repository)');
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  for (const file of [clientFile, outputFile]) {
    const path = resolve(file).toLowerCase();
    if (path === repo.toLowerCase() || path.startsWith(`${repo.toLowerCase()}\\`) || path.startsWith(`${repo.toLowerCase()}/`)) throw new Error('Keep credentials outside the repository.');
  }
  let client;
  try { client = JSON.parse(await readFile(clientFile, 'utf8')).installed; } catch { throw new Error('Cannot read desktop OAuth client JSON.'); }
  if (!client?.client_id || !client?.client_secret) throw new Error('Download a Desktop app OAuth client JSON from Google Cloud Console.');
  // Fail before consent when the output already exists; never overwrite credentials.
  const output = await open(outputFile, 'wx', 0o600);
  try {
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    let redirect;
    let server;
    const codePromise = new Promise((resolveCode, rejectCode) => {
      server = createServer((req, res) => {
        const url = new URL(req.url, redirect);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Security-Policy', "default-src 'none'");
        if (req.method !== 'GET' || url.pathname !== '/callback' || url.searchParams.get('state') !== state) {
          res.writeHead(400).end('Invalid callback.'); return;
        }
        if (url.searchParams.has('error') || !url.searchParams.get('code')) {
          res.writeHead(400).end('Authorization not completed.'); rejectCode(new Error('Google authorization was not completed.')); return;
        }
        res.end('Authorization received. Return to PowerShell; do not share this URL.');
        resolveCode(url.searchParams.get('code'));
      });
      server.on('error', () => rejectCode(new Error('Cannot start local callback server.')));
    });
    // Prevent an unhandled rejection while waiting for the listener to start.
    codePromise.catch(() => {});
    await new Promise((ready, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ready); });
    redirect = `http://127.0.0.1:${server.address().port}/callback`;
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect,
      response_type: 'code', scope: 'https://www.googleapis.com/auth/drive.file',
      access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    console.log('Open this URL in a browser on this computer and authorize the storage owner account:');
    console.log(auth.href);
    let timeout;
    let code;
    try {
      code = await Promise.race([codePromise, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Authorization timed out. Run setup again with a new output path.')), 10 * 60 * 1000);
      })]);
    } finally { clearTimeout(timeout); server.closeAllConnections(); server.close(); }
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret,
        code, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }),
      signal: AbortSignal.timeout(15000) });
    const token = await tokenResponse.json().catch(() => null);
    if (!tokenResponse.ok || !token?.access_token || !token?.refresh_token) throw new Error('Google token exchange failed; no credentials were printed.');
    const granted = new Set((token.scope ?? '').split(' '));
    if (!granted.has('https://www.googleapis.com/auth/drive.file')) throw new Error('Drive file permission was not granted.');
    const credentials = JSON.stringify({ client_id: client.client_id, client_secret: client.client_secret, refresh_token: token.refresh_token });
    // Save the credential first so a folder-creation failure can be recovered.
    await output.write(`GOOGLE_DRIVE_OAUTH_JSON=${credentials}\n`);
    const folder = async (name, parent) => {
      const response = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST',
        headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) }),
        signal: AbortSignal.timeout(15000) });
      const result = await response.json().catch(() => null);
      if (!response.ok || typeof result?.id !== 'string') throw new Error('Folder creation failed. OAuth credentials remain in the output file; check Drive API and owner storage.');
      return result.id;
    };
    // Newly created private folders are accessible under drive.file. Existing
    // manually-created folders are not automatically accessible with this scope.
    const parent = await folder('Game-Portal submissions (private)');
    for (const name of ['pending', 'approved', 'rejected']) {
      const id = await folder(name, parent);
      await output.write(`GOOGLE_DRIVE_${name.toUpperCase()}_FOLDER_ID=${id}\n`);
    }
    console.log('Setup completed. Secrets and folder IDs were saved to the requested file.');
    console.log('Set its four values in Supabase Edge Function Secrets. Never commit or share the file.');
  } finally { await output.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
