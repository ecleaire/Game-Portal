// TEST ONLY: actual Edge handler + actual SQL, replacing PostgREST transport with PGlite.
// No real credentials, no external connections, no test bypass in production code.
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHandler } from '../../supabase/functions/portal/handler.mjs';

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec('create role anon; create role authenticated; create role service_role;');
const dir = new URL('../../supabase/migrations/', import.meta.url);
for (const name of (await readdir(dir)).sort()) await db.exec(await readFile(new URL(name, dir), 'utf8'));
await db.query('select public.portal_bootstrap($1,$2)', ['browser_owner', 'browser-test-admin-only']);
// Independent fixture identity keeps review tests inside the real login limit.
await db.query("insert into portal_private.admin_users(username,password_hash,role) values($1,portal_private.password_hash($2),'super_admin')", ['browser_review_owner','browser-review-admin-only']);
const imageObjects = new Map();
const driveObjects = new Map();
const handler = createHandler({
  url: 'http://127.0.0.1:54321', serviceKey: 'browser-test-server-only',
  pepper: 'browser-test-only-pepper-not-for-production', allowedOrigins: 'http://127.0.0.1:4173',
  googleDriveOAuthJson: JSON.stringify({client_id:'test-only',client_secret:'test-only',refresh_token:'test-only'}),
  googlePendingFolderId: 'test-pending',
  fetcher: async (_url, options) => {
    if (_url === 'https://oauth2.googleapis.com/token') return Response.json({access_token:'test-only',expires_in:3600});
    if (_url.startsWith('https://www.googleapis.com/upload/drive/')) {
      const body = Buffer.from(options.body);
      const marker = Buffer.from('Content-Type: application/zip\r\n\r\n');
      const boundary = options.headers['Content-Type'].split('boundary=')[1];
      const start = body.indexOf(marker) + marker.length;
      const end = body.lastIndexOf(Buffer.from(`\r\n--${boundary}--`));
      const id = crypto.randomUUID();
      driveObjects.set(id, body.subarray(start, end));
      return Response.json({id});
    }
    if (_url.startsWith('https://www.googleapis.com/drive/v3/files/')) {
      const id = new URL(_url).pathname.split('/').pop();
      if (options.method === 'DELETE') { driveObjects.delete(id); return new Response(null,{status:204}); }
      if (options.method === 'PATCH') return Response.json({id});
      const bytes = driveObjects.get(id);
      return bytes ? new Response(bytes,{headers:{'Content-Type':'application/zip'}}) : new Response(null,{status:404});
    }
    if (_url.includes('/storage/v1/object/portal-packages')) {
      if (options.method === 'DELETE') { for (const key of JSON.parse(options.body).prefixes) imageObjects.delete(key); return Response.json({}); }
      const key=decodeURIComponent(_url.split('/portal-packages/')[1]);
      if (options.method === 'POST') { imageObjects.set(key,{bytes:options.body,type:'application/zip'});return Response.json({}); }
      const file=imageObjects.get(key);return file?new Response(file.bytes,{headers:{'Content-Type':file.type}}):new Response(null,{status:404});
    }
    if (_url.includes('/storage/v1/object/portal-thumbnails')) {
      if (options.method === 'DELETE') { for (const key of JSON.parse(options.body).prefixes) imageObjects.delete(key); return Response.json({}); }
      const key = decodeURIComponent(_url.split('/portal-thumbnails/')[1]);
      if (options.method === 'POST') { imageObjects.set(key, { bytes: options.body, type: options.headers['Content-Type'] }); return Response.json({}); }
      const file = imageObjects.get(key); return file ? new Response(file.bytes, { headers: { 'Content-Type': file.type } }) : new Response(null, { status: 404 });
    }
    const p = JSON.parse(options.body);
    try {
      if(_url.endsWith('/rpc/portal_public_game')) {
        const {rows}=await db.query('select public.portal_public_game($1) as result',[p.p_slug]);return Response.json(rows[0].result);
      }
      if (_url.endsWith('/rpc/portal_tags') || _url.endsWith('/rpc/portal_catalog')) {
        const fn = _url.endsWith('/portal_tags') ? 'portal_tags' : 'portal_catalog';
        const { rows } = await db.query(`select public.${fn}() as result`);
        return Response.json(rows[0].result);
      }
      const { rows } = await db.query('select public.portal_api($1,$2::jsonb,$3,$4) as result',
        [p.p_action, JSON.stringify(p.p_body), p.p_token_hash, p.p_new_token_hash]);
      return Response.json(rows[0].result);
    } catch (error) { return Response.json({ code: error.code }, { status: 400 }); }
  },
});
createServer(async (req, res) => {
  if (req.url === '/health') { res.writeHead(200).end('ready'); return; }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const response = await handler(new Request(`http://127.0.0.1:54321${req.url}`, {
    method: req.method, headers: req.headers,
    ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
  }));
  res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
}).listen(54321, '127.0.0.1', () => console.log('Test database ready'));
